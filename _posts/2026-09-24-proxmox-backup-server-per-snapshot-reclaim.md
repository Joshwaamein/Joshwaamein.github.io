---
title: "Reading Proxmox Backup Server Index Files to Find What Deleting a Snapshot Actually Frees"
description: "Proxmox Backup Server shows a snapshot's logical size, so ten backups of one guest each look full size. Deduplication means deleting one can free almost nothing. I parsed the chunk index files directly to get the real reclaim figure per snapshot, and hit three parser bugs, an SSH forced-command trap, and a verification method that lied to me for half an hour."
date: 2026-09-24 14:30:00 +0100
categories: [Homelab, DevOps]
tags: [proxmox, python, sql, automation, monitoring, grafana, ansible]
---

My backup server holds a few terabytes of guest backups and its web interface
cannot answer the one question I care about before deleting anything:

> If I delete this snapshot, how much disk space do I get back?

The interface shows each snapshot at its logical size. Back up a 100 GB virtual
machine ten times and you see ten entries of roughly 100 GB each, even though
the real cost on disk might be 105 GB in total. The server splits every backup
into roughly 4 MB chunks, hashes them, and stores each unique chunk once.
Snapshots that share data share chunks.

The displayed number is accurate for what it measures. It is just answering a
different question than the one I am asking.
Delete that 100 GB snapshot and you might reclaim a few megabytes, because
almost every chunk in it is still referenced by the snapshot either side of it.
The only place the software shows true on-disk usage is the whole-datastore
summary, which tells you nothing about which guest is responsible.

I wanted a per-snapshot reclaim figure on a dashboard. The finished thing takes
20 seconds to scan roughly 1.5 million chunk files and gave me a single
actionable line: one snapshot would free 111 GB at 100% uniqueness, while another
the interface showed as 287 GB would free only 24 GB.

## Why I Wrote My Own Collector

There is a well-known community tool for this. It is a good piece of work, it
independently confirmed my understanding of the file format, and it is the right
choice for an interactive one-off look. I wrote a separate collector for three
reasons, none of which are faults in that tool.

Its unique-versus-shared calculation is scoped to the object you select, so a
chunk shared with a completely different guest counts as reclaimable when it is
not. That is correct for the question it answers; it is the wrong basis for the
question I was asking.

Its output is aimed at a terminal or a CSV file, so a scheduled collector would
be parsing semicolon-separated text on every run.

And it carries a self-update feature. To be fair to it, I read the source before
writing this: the update is gated behind an explicit flag or a menu choice, it
prompts for confirmation, it verifies a published checksum when one exists, and
running with the silent flag returns before it even checks for a new version. It
cannot fire during an unattended run. I still prefer that a program on the host
holding my backups has no code path that replaces its own file, because the thing
I am protecting against is my own future carelessness rather than the tool.

If you want the number once, use the community tool. What follows is what it
takes to put the number on a dashboard.

## The File Format, Verified Rather Than Assumed

Each backup archive has an index file listing the chunks it references, in
order. Fixed-size images use one format, variable-size archives another. Both
start with a 4096-byte header.

I did not want to trust a format description I had read somewhere, so I dumped
the first 64 bytes of a real index and worked out the layout:

```bash
od -An -t x1 -N 64 /path/to/datastore/vm/<id>/<timestamp>/drive-scsi0.img.fidx
```

That gave me a magic number, then a UUID, a creation timestamp, a checksum, and
two 64-bit values. Interpreting those two as the archive size and the chunk size
produced 68719476736 and 4194304, which are exactly 64 GiB and 4 MiB. Promising,
but still a guess.

The server ships a debug tool that can inspect an index file, so I ran it
against the same file and compared:

```bash
proxmox-backup-debug inspect file drive-scsi0.img.fidx
```

It reported `size: 68719476736` and the same chunk size. Two independent
readings agreeing on one file is the point at which I was willing to write a
parser.

```python
FIXED_MAGIC = bytes.fromhex("2f7f41ed91fd0fcd")
DYNAMIC_MAGIC = bytes.fromhex("1c914ea519bab3cd")
HEADER_LEN = 4096
```

After the header, the fixed-size format is a flat array of 32-byte digests. The
variable-size format uses 40-byte entries: a 64-bit end offset followed by the
digest. That end offset is useful, because the difference between consecutive
offsets gives each chunk's logical size without touching the chunk itself.

The check that mattered came at the end of the first full run: **7,435,509 chunk
references resolved, zero unresolved.** If my stride or offset had been wrong,
digests would have failed to match files on disk and that number would have been
enormous. Zero missing across 7.4 million lookups is a parser that works.

## Unique Against the Whole Datastore, Not Within a Group

The scan is three passes. Walk the chunk store once, recording the on-disk size
of every chunk against its digest. Parse every index file, building a per
snapshot set of chunk references. Then count how many snapshots reference each
chunk, and classify.

The definition is the entire point, so it is worth being precise:

| Figure | Meaning |
|---|---|
| Unique | Bytes of chunks referenced by **exactly one** snapshot in the whole datastore. This is what deleting it alone frees. |
| Shared | Bytes of chunks also referenced by at least one other snapshot. |
| Total | Unique plus shared, which is what the interface shows. |

Scoping that reference count to the whole datastore rather than to the guest is
what makes the number honest. Two different virtual machines running the same
operating system share a lot of chunks. If I count only within one guest's own
history, those cross-guest chunks look reclaimable, and the dashboard promises
space that deletion will not return.

Refcounting is a flat array indexed by chunk ID rather than a dictionary of
digests, which keeps a 1.5 million chunk datastore inside a few hundred
megabytes of memory:

```python
snapshot_refcount = array("I", bytes(4 * len(sizes)))
for refs in snapshots.values():
    for chunk_id in refs:
        snapshot_refcount[chunk_id] += 1
```

Peak memory came out at 438 MB for the whole datastore, and total wall time at
20 seconds on an idle host. For a question I previously could not answer at all,
that is cheap.

## What the Numbers Showed

The top of the sorted output made the case for building it. These are real rows
with the guests generalised:

| Snapshot | Frees | Interface shows | Unique |
|---|---|---|---|
| A single snapshot of a decommissioned guest | 111 GB | 111 GB | 100% |
| An old one-off image backup | 27 GB | 28 GB | 99% |
| One snapshot from a long-running series | 24 GB | 287 GB | 8% |

The first row is an orphan: one snapshot of a guest that no longer exists,
sharing nothing with anything. Delete it and you get all 111 GB.

The third row is the whole problem in one line. The interface shows 287 GB.
Deleting it frees 24 GB. The other 263 GB lives on in its sibling snapshots.

That distinction changes what you do. High uniqueness means delete the single
snapshot. Low uniqueness means individual deletions are almost pointless and the
real lever is retention policy, because you have to remove the whole series
before the shared chunks drop to a refcount of zero.

The general point is that a backup store has two different kinds of space in it.
Some is held by exactly one snapshot and comes back the moment you remove that
snapshot. The rest is held collectively by a series, and no individual deletion
touches it. Until you measure the split, every deletion is a guess, and a
retention policy is being tuned without knowing which of the two kinds of space
it governs.

The dashboard therefore leads with the percentage-unique column rather than
size, because that is the column that tells you which of the two actions to take.

## Three Bugs in My Own Parser, Found the Same Way

The first version crashed with `TypeError: cannot unpack non-iterable NoneType
object`. The cause was mine and it was embarrassing: while editing, an anchored
replacement had consumed the final `return` statement of a function. The
function still parsed, still ran, and returned `None` to a caller expecting a
tuple.

I fixed it, re-ran, and got the identical error from a different function. Fixed
that, re-ran, and a third function had lost its `return` the same way.

At that point the pattern was the bug, not the instances, so I stopped fixing and
wrote a check that walks the syntax tree and reports any function containing
`return <value>` statements whose body does not end in a return or a raise:

```python
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef):
        returns = [n for n in ast.walk(node)
                   if isinstance(n, ast.Return) and n.value is not None]
        last = node.body[-1]
        if returns and not isinstance(last, (ast.Return, ast.Raise)):
            print(f"falls through: {node.name}")
```

It immediately found the third one I had not reached yet, in a different file. A
linter would have caught this, and the honest lesson is that an edit which
anchors on a function's last line deserves a check that the function still
returns. Two failures of the same shape mean stop and generalise.

## A Login Shell of nologin Breaks a Forced Command

The scan has to run on the backup host, because it reads local files. The
database lives on a separate host, and its database does not accept connections
from the network. So that host pulls the result over a restricted key.

The security model is a forced command. The key can only run one wrapper script,
and the wrapper validates its single argument against an allowlist before
execution:

```text
restrict,command="/usr/local/lib/<tool>/wrapper.sh" ssh-ed25519 <public-key>
```

`restrict` disables port forwarding, agent forwarding, X11 and terminal
allocation. The wrapper rejects any datastore name that is not a bare
alphanumeric string, then checks it against the allowlist, so a path traversal
attempt is refused before anything runs. My deployment asserts that refusal on
every run, because a forced command tested only on its happy path is a claim
rather than a control.

Creating the scanner account, I set its shell to `/usr/sbin/nologin`, which felt
obviously correct for a service account that should never log in.

Every connection then failed with:

```text
This account is currently not available.
```

That message comes from `nologin` itself. **The daemon executes a forced command
through the account's login shell**, so `nologin` refuses the session before the
forced command ever runs. The confinement in this design comes from the key
restrictions, not from the shell, and a service account set up this way needs a
shell that can execute the command. Obvious in hindsight, invisible beforehand.

Two smaller traps followed from hardening the collector's service unit with
`ProtectSystem=strict`. The client wanted to write a hashed host entry back to
its known-hosts file on a read-only filesystem, which fails with
`hostfile_replace_entries: Read-only file system` **even though the host key
verified correctly**. The fix is to disable that update and manage the
known-hosts file from configuration management instead. Targeting a short
hostname rather than a fully qualified one is what triggered the write.

The last one was a permissions question with a design answer. The scanner runs
unprivileged, but the server's configuration directory is mode 700, so it cannot
read the file that maps a datastore name to its path. I could have loosened that
directory. Instead the deployment resolves the paths as root at install time and
writes them into the generated wrapper, so the unprivileged account never needs
access to the configuration at all. Widening permissions on a backup server to
suit a reporting tool is the wrong trade.

## An Idle Scan Is 20 Seconds and a Busy One Is 321

While I was testing, snapshots were being deleted on that server. The next scan
took 321 seconds instead of 20.

Nothing was broken. The process showed state `D` in `wait_on_buffer` with
input/output pressure around 59%, having consumed only 23 seconds of processor
time in five minutes of wall clock. It was waiting for disk, and waiting
politely, because everything runs at the lowest priority:

```bash
nice -n 19 ionice -c3 python3 scan.py --datastore <name>
```

The idle input/output class means the scan yields to backups, garbage collection
and verification rather than competing with them. On a machine holding backups, a
report that takes sixteen times longer under load is exactly the behaviour I
want. It does mean the service timeout has to accommodate the slow case, and that
a reporting job should be scheduled outside maintenance windows rather than
relying on input/output priority alone.

If a run looks slow, the first check is whether the server is doing real work,
not whether the scanner is stuck:

```bash
cat /proc/pressure/io
```

## Recording Failures So Silence Cannot Look Healthy

A collector that only writes a row when it succeeds cannot be distinguished from
one that has stopped running. Both look like data that has not changed. The
dashboard keeps displaying the last good numbers as though they were current, and
nothing on screen indicates otherwise.

So this collector writes a row for every attempt, including failures:

```sql
CREATE TABLE footprint_scans (
    collected_at    timestamptz NOT NULL,
    datastore       text        NOT NULL,
    status          text        NOT NULL,
    snapshot_count  integer,
    scan_seconds    double precision,
    error_text      text,
    PRIMARY KEY (datastore, collected_at)
);
```

It also exits non-zero when any target fails, so the service manager marks the
unit failed rather than successful. The dashboard reads that table, not the
measurement tables, for its health panel, and shows stale when the newest row is
more than 26 hours old. A collector that stops silently is indistinguishable from
a collector whose data has not changed, and the only cure is to make the absence
of data into a visible row.

## My Verification Method Lied to Me for Half an Hour

The deployment finished green. Then I checked whether the dashboard had
registered, and concluded it had not.

I was wrong, and the way I was wrong is the most useful thing in this post.

I queried the dashboard table in the application's database. The dashboard was
absent. I checked permissions, the provisioning path, the log output, the
configuration file, and the service environment. Everything was correct.
Provisioning logged `starting to provision dashboards` and then `finished to
provision dashboards`, with no error, no count and no name. I documented the
failure and said it needed a manual import.

Three things had gone wrong, all mine.

**The table I queried is legacy.** The version I run stores dashboards elsewhere.
The old table still exists, still has rows, and is stale: it was missing both my
new dashboard and another one I could watch being viewed in the log at that
moment. It looks authoritative and is not.

**My query against the correct table used a function that does not exist there.**
I had been quoting string literals through `chr()` calls to survive several
layers of shell escaping. That works in the database the measurements live in.
The dashboard application uses SQLite, which has no `chr()`, so the query
errored.

**And I had attached `2>/dev/null` to that command**, to stop a non-zero exit
from tripping my own tooling. So the error vanished and the query returned
nothing, which I read as an empty table confirming the dashboard was missing.

The correct check takes one command, and the dashboard was there all along, in
the folder the provisioner created, with all nine panels and annotations proving
it came from provisioning:

```bash
sqlite3 /var/lib/<app>/<app>.db <<'SQL'
SELECT name, folder FROM resource WHERE resource = "dashboards" ORDER BY name;
SQL
```

Suppressing standard error converted a loud failure into a quiet false negative,
and then I built a conclusion on it. The rule I have taken away: never discard
error output from a command whose empty result you intend to interpret as
evidence. "No rows" and "your query was invalid" must not look the same.

The second rule is about storage migrations. When a platform moves where it keeps
something, the old location usually survives as readable, plausible and wrong.
Confirm which one is authoritative before treating either as truth.

## What I Would Tell Someone Starting This

Parse the index files, verify the format against the vendor's own debug tool on a
real file, and check that unresolved references come out at zero. That single
number validates the whole parser.

Define unique against the entire datastore, not within the object you selected,
or the figure you publish will overstate what deletion returns.

Run at idle priority on a backup host and accept that scans get slower under
load, because the alternative is a reporting tool competing with the backups it
is reporting on.

Record every attempt including failures, and have the dashboard read that record
rather than assuming data on screen is current.

And when something you deployed appears not to have worked, check how you are
checking before you conclude anything. I spent half an hour diagnosing a
non-existent problem because I had silenced the error that would have told me my
question was malformed.
