---
title: "How I Steer Cline With a Tiered Rules System, a Persona, and a Pre-Commit Hook That Stops Me Leaking My Homelab"
description: "A 700-line steering layer for Cline split into always-on rules and on-demand reference docs, a banned-words list that kills the AI smell, opsec rules that keep internal hostnames out of public commits, a single canonical config folder with five symlinks back into the OS, and a bash pre-commit hook that greps the staged diff for known secrets and refuses to let the commit through."
date: 2026-06-06 19:00:00 +0100
categories: [AI, DevOps]
tags: [cline, claude, llm, agents, mcp, ai, automation, opsec, bash]
---

I have been using [Cline](https://cline.bot) (the open-source coding agent that drives Claude or any Bedrock-backed model) for most of my homelab work for the last few months. Out of the box it is good. With steering rules it is genuinely useful. Without them it confidently writes code that ignores half my conventions, drops em dashes into every paragraph of my blog drafts, and occasionally pastes one of my internal hostnames into a public commit message because it doesn't know any better.

So I built a steering layer. ~700 lines of markdown, split across two tiers, with a persona, a banned-words list, an opsec policy, a per-repo git style guide, and a bash pre-commit hook that physically blocks me from pushing a secret. This post walks through the whole thing: the architecture, the actual rule files, the symlink layout, the secret scanner, and what each piece exists to prevent.

It is also a worked example of how to keep an LLM agent useful as your project grows past the point where one prompt can hold all your conventions in its head.

## The Problem: An Agent With No Memory of How You Work

If you have used a coding agent for more than a week, you already know the failure modes:

- It writes code that doesn't match the rest of the file. Different naming, different error-handling style, a different testing convention.
- It uses words you would never use in writing. "Robust", "leverage", "delve", "seamless", "cutting-edge". Every blog draft comes back with the AI smell baked in.
- It cheerfully includes things in commits that should never have left the machine. Real internal hostnames, an IP from your LAN, the name of a private VM.
- For tasks that touch infrastructure, it reasons about a generic homelab instead of yours. The advice is fine. It is also wrong, because your homelab has constraints and load-bearing decisions the agent has no idea exist.

Single-shot prompts patch this for one task. They don't survive the next session. Project-level `.clinerules/` files help, but a lot of my conventions are not project-specific: how I write commits, which words I will never use in prose, where my filesystem actually lives, what counts as a secret. That stuff belongs at the user level, applied to every project.

That is what the rules folder is for.

## The Two-Tier Architecture

Cline reads global rules from `~/Documents/Cline/Rules/` on every turn. Anything in that folder gets injected into the system prompt. Which is great, until you realise the prompt is finite. Stuffing a full homelab inventory plus a per-language coding style guide plus a fleet topology diagram into the always-on layer is a fast way to burn 10,000 tokens of context budget before the agent has even read the user's question.

So I split the steering layer in two:

```
~/Documents/Cline-Config/
├── rules/         Always-on. Injected every turn.
│   ├── cline-rules.md          Persona, banned words, coding/git/security
│   ├── filesystem-locations.md Where things actually live on disk
│   ├── github-commits.md       Commit-message conventions per repo
│   ├── homelab-credentials.md  (chmod 600)
│   ├── homelab-pointers.md     Thin pointers; full doc is in reference/
│   └── opsec-redaction.md      What must never leak
└── reference/     On-demand. Read with read_file when needed.
    ├── blog-publishing.md      Jekyll site, deploy pipeline, post conventions
    ├── coding-style.md         Per-language style (Python/JS/Shell/Rust/Go)
    ├── homelab-architecture.md Full fleet map: sites, hosts, networks, SSL
    └── hosts/                  One markdown file per host (~30 of them)
        ├── <reverse-proxy>.md
        ├── <pbs-1>.md, <pbs-2>.md, <pbs-3>.md
        ├── <ai-host>.md, <storage-host>.md
        ├── <docker-host>.md
        └── ...
```

Each host file is small, 100 to 350 lines, and answers the questions Cline ends up asking on a homelab task: what does this host run, what depends on it, what's its backup target, what's the SSH alias, what are the gotchas, what's the last incident I had with it. The full fleet map in `homelab-architecture.md` says how the hosts fit together; the per-host files in `hosts/` say what each individual one is. Cline reads the relevant `hosts/<name>.md` whenever a task touches that machine, with no cost to always-on context.

The `rules/` tier is the steering layer proper: persona, banned words, opsec policy, git conventions, filesystem layout. Every file in there is in the system prompt every turn. Budget is roughly 700 lines or 25 KB total. If a file in `rules/` grows past about 150 lines or starts looking like a wall of operational facts, that is the signal it belongs in `reference/` instead, with a thin pointer left behind.

The `reference/` tier is the deep stuff. The full homelab architecture map is about 60 KB. The per-language coding style guide is another 40 KB. Both belong somewhere, but they do not need to be in the prompt for every task. They live in `reference/` and the agent reads them with its own `read_file` tool when a task touches them. The pointers in `rules/` say things like:

> For any non-trivial homelab question, read `reference/homelab-architecture.md` before answering.

That trades one extra `read_file` call (sometimes) for ~8000 tokens of always-on context budget every turn. Worth it.

## The Persona and the Banned-Words List

`cline-rules.md` is the file that does the most work, because it is the one Cline behaves the most like a person in.

The first section is the persona. Mine is light: address me as "master", refer to yourself as "Jeeves", do not lay it on thick. The persona is a salutation, not a character to perform. That last sentence matters. Without it, Claude will start every turn with "Of course, master, I would be delighted to..." and it gets old fast.

There's a second-order use for the persona that I didn't design for and only noticed after a few weeks: it's a free context-loss canary. If the agent is still calling me "master" at the start of a reply, the system prompt is intact and the rules are still loaded. The day a reply opens with "Hi! How can I help?" or "Sure, I can do that for you", I know the context window has rolled over, the steering layer has been evicted, and whatever the agent does next is going to be steered by training-data defaults rather than by my rules. That's the cue to start a fresh session, not to push through. Costs me nothing to add, and saves me from quietly accepting an answer from an agent that has forgotten everything it was told to be.

The second section is the banned-words list. This is the bit I would put first in any rules file you write, and it is the bit that will save you the most editorial pain. Mine has three groups:

```markdown
## 2. Banned words and phrases

**Buzzwords:** delve, landscape, realm, tapestry, leverage, utilize, robust,
seamless, cutting-edge, holistic, game-changer.

**Filler phrases:** "It's important to note that...", "In today's rapidly
evolving...", "Let's dive in", "This is a great question", "I'd be happy to
help", "Here's the thing", "At the end of the day", "When it comes to",
"It's worth noting".

**False dichotomy framework:** Do not use "It's not X, it's Y" structures
(e.g. "It's not about working harder, it's about working smarter", or
"This isn't a problem, it's an opportunity").
```

Three notes on this list:

1. The buzzwords are the ones I personally find most aggravating. Yours might be different. The point isn't the specific words, it is having a list at all so the agent has something concrete to suppress.
2. The filler phrases group is the one with the highest impact on tone. "It's important to note that" is the giveaway sentence opener of an LLM trying to sound authoritative without saying anything. Banning it forces the agent to either say the thing or not.
3. The false-dichotomy ban is the one I added most recently and have come to like the most. Models love the "It's not X, it's Y" rhetorical structure because it sounds insightful. It almost never is.

Two more rules in the same file matter for prose quality:

```markdown
- Do not use `--` (double hyphen) or em dashes (`—`) in messages or output.
  Use periods, commas, colons, or parentheses instead.

- If it sounds like a corporate FAQ page, rewrite it.
- Use real details and specifics. "528% purchase rate increase" beats
  "significant improvement". AI defaults to vague. Specifics signal a
  human was involved.
- Do not over-format. Not everything needs bullet points, headers, and a
  five-item list. Sometimes a paragraph is the right answer.
```

The em-dash ban is the one I see having the largest single effect on whether a draft "reads like AI" to me. Older posts on this blog have em dashes in them because I used to use them. New ones don't, and the rule is enforced at the source rather than at the editor.

## Opsec and Redaction

`opsec-redaction.md` is the second-largest file in `rules/` and the one I would write next if I were starting fresh. It defines what must be sanitised before anything leaves the machine. Categories:

- **Network and infrastructure.** Internal subnets, MAC addresses, DNS records, firewall rules, VPN endpoints, cert details. Replace with `192.0.2.0/24` (the RFC 5737 documentation range), `your-hostname.example`, `internal.example`.
- **Authentication and secrets.** API keys, bearer tokens, SSH keys (private *or* public), `/etc/shadow` lines, database connection strings, `.env*` of any flavour, AWS/GCP/Hetzner access keys.
- **System details.** OS versions and patch levels, exact filesystem paths that reveal layout, container and VM names that reveal topology, hardware model numbers, package lists with exact versions, cron jobs (timing reveals operational patterns, paths reveal layout).
- **Personal and organisational.** Physical address, ISP, cloud provider account IDs, license keys, internal project codenames.
- **Blog and public-content specifics.** EXIF in images, terminal output in screenshots, log pastes with real IPs, code comments that reference internal services by their real names.

The behavioural rule at the end of that file is the one that matters most:

> When in doubt, ask. Defaulting to "I'll redact it" is always safer than defaulting to "I'll publish it".

There is also a worked example I learned the hard way: when you commit a redaction (e.g. you scrub real hostnames out of a file and replace them with placeholders), do not name the specific identifiers being redacted in the commit message body. The commit message is itself a public surface. A commit body that says "Replaces real hostnames `server-foo`, `server-bar` and Tailscale IPs `100.x.x.x`, `100.y.y.y` with placeholders" leaks every value you just spent the diff hiding. Use generic descriptors: "Replaces internal hostnames, Tailscale IPs and the real notification domain with placeholders". That one cost me a force-push.

## Filesystem Pointers and Per-Repo Git Style

Two more files in `rules/` are about ground truth, not behaviour.

`filesystem-locations.md` is a flat document that tells Cline where things actually live on my machine. Which directories are synced to which cloud, which folders are off-limits (the entire personal documents tree, the credentials folder of the Obsidian vault, anything under `~/.ssh`/`~/.aws`/`~/.gnupg`), what the date-prefix convention is for new dated folders (`YYYY-MM-DD-topic-context`), where the canonical clone of the blog repo lives versus the stale chirpy clone I keep accidentally `cd`-ing into.

This file exists because every project I work on lives at a specific path and the agent will otherwise guess. Telling it "the canonical local clone of the blog is at `~/Documents/Projects/<dated-folder>/repos/Joshwaamein.github.io/`, the stale one is at `~/Documents/Projects/<old-folder>/`, stop and confirm if you find yourself in the stale one" saves the same paragraph being typed into 20 different sessions.

`github-commits.md` is the per-repo git style guide. It says: read the recent history of a repo before committing anything, match the existing style instead of imposing one. Some of my repos use Conventional Commits with a scope (`fix(search): disable assets.self_host`). Others use sentence-case subjects for cross-cutting changes (`Add post: Automating Nextcloud AIO updates with bash and cron`). Both are fine. The rule is to look at `git log --oneline -20` first and match what's already there.

It also lists the things that should never happen without me explicitly asking: `git push --force` (use `--force-with-lease`), `git rebase -i` on a pushed branch, `git filter-branch` on anything, deleting a remote branch, committing from `~/.ssh`, `~/.aws`, `~/.gnupg`, or any `.env*` file. The pre-commit hook below enforces the secret-scanning half of that list at the actual commit boundary.

## Cline-Config: One Folder, Five Symlinks

The rules folder is useful. The rules folder being canonically stored somewhere that gets backed up nightly is what makes it durable.

So the actual files don't live at `~/Documents/Cline/Rules/`. They live in a single canonical folder under my Nextcloud sync root:

```
~/Documents/Cline-Config/
├── rules/
├── reference/
├── mcp-settings/
│   └── cline_mcp_settings.json
├── mcp-servers/
│   ├── proxmox-mcp/config.json
│   └── searxng/{docker-compose.yml,settings.yml}
├── runbooks/
├── hooks/
│   └── pre-commit-secret-scan
└── public-share-allowlist.md
```

`Cline-Config/` is bidirectionally synced by the Nextcloud client to the AIO instance running on a Docker host inside my homelab. That VM is captured in nightly Proxmox Backup Server snapshots, sent to two different PBS hosts. End-to-end: edit a rule on my workstation, sync to the AIO server, nightly snapshot, restorable from any host on the tailnet. Five years of rules edits with full version history without me thinking about it.

Five symlinks point from the locations Cline (and its MCP servers) expect, back into this canonical folder:

| Real file (in Cline-Config) | Symlink in OS |
|---|---|
| `rules/` | `~/Documents/Cline/Rules/` |
| `mcp-settings/cline_mcp_settings.json` | `~/.cline/data/settings/cline_mcp_settings.json` |
| `mcp-servers/proxmox-mcp/config.json` | `~/Applications/ProxmoxMCP/proxmox-config/config.json` |
| `mcp-servers/searxng/docker-compose.yml` | `~/Applications/searxng/docker-compose.yml` |
| `mcp-servers/searxng/settings.yml` | `~/Applications/searxng/settings.yml` |

To rebuild the layout on a fresh machine after restoring `Cline-Config/` from backup:

```bash
NCROOT=$HOME/Documents/Cline-Config

mkdir -p $HOME/Documents/Cline \
         $HOME/.cline/data/settings \
         $HOME/Applications/searxng

ln -sf $NCROOT/rules \
       $HOME/Documents/Cline/Rules

ln -sf $NCROOT/mcp-settings/cline_mcp_settings.json \
       $HOME/.cline/data/settings/cline_mcp_settings.json

ln -sf $NCROOT/mcp-servers/proxmox-mcp/config.json \
       $HOME/Applications/ProxmoxMCP/proxmox-config/config.json

ln -sf $NCROOT/mcp-servers/searxng/docker-compose.yml \
       $HOME/Applications/searxng/docker-compose.yml

ln -sf $NCROOT/mcp-servers/searxng/settings.yml \
       $HOME/Applications/searxng/settings.yml
```

Five `ln -sf` lines and the new machine has the same Cline brain as the old one. No copy-paste of bearer tokens, no rewriting MCP configs, no losing the banned-words list because it was sitting in a folder I forgot existed.

## The Pre-Commit Secret Scan Hook

`hooks/pre-commit-secret-scan` is the bit I am most quietly proud of. It is a 110-line bash script that hooks into `git commit` and refuses to let the commit through if the staged diff contains anything that looks like a secret.

Three categories of pattern:

**1. Literal danger strings extracted from my private credentials file.** The script reads `rules/homelab-credentials.md` (which is `chmod 600` and never leaves disk) and pulls every UUID-shaped string and every long hex token out of it:

```bash
DANGERS=$(
  grep -hEo '[a-f0-9]{32,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
    "$CRED_FILE" | sort -u
  grep -hE '^- \*\*Password:\*\*' "$CRED_FILE" \
    | sed -E 's/.*`([^`]+)`.*/\1/' | sort -u
)
```

Then for each one, it does a literal `grep -F` against the staged diff. If a real bearer token from my MCP config or a Proxmox API token from the credentials file ever ends up in a staged diff, the commit is blocked with a redacted-out matched-string for traceability.

**2. Generic regex patterns for common secret shapes.** Independent of what is in my credentials file, the script also pattern-matches against the diff:

```bash
PATTERNS=(
  'AKIA[0-9A-Z]{16}'              # AWS access key
  'sk-[A-Za-z0-9]{20,}'           # OpenAI / Anthropic style
  'ghp_[A-Za-z0-9]{30,}'          # GitHub personal access token
  'gho_[A-Za-z0-9]{30,}'          # GitHub OAuth
  'github_pat_[A-Za-z0-9_]{50,}'  # GitHub fine-grained PAT
  'xoxb-[A-Za-z0-9-]{20,}'        # Slack bot token
  '-----BEGIN [A-Z ]+PRIVATE KEY-----'
  'PVEAPIToken=[^[:space:]]+'     # Proxmox API token literal
  'Bearer [A-Za-z0-9_-]{32,}'     # Generic bearer token
)
```

These catch things that aren't in my credentials file but still shouldn't end up in a public repo: someone else's GitHub PAT, an OpenAI key from a script I pasted in, the AWS access key I am about to swap into a `.env`. Each match is reported with the same prefix-suffix redaction.

**3. Internal hostnames in *added* lines.** The third pass is the topology check. The script has an array of internal hostnames (the homelab uses about 20 of them) and refuses any commit that adds one of those names to a tracked file:

```bash
ADDED=$(awk '/^\+\+\+/ {next} /^\+/ {print}' <<<"$DIFF")

for h in "${INTERNAL_HOSTS[@]}"; do
  if grep -F -q -w -- "$h" <<<"$ADDED"; then
    echo "pre-commit: WARNING - staged diff references internal hostname '$h'" >&2
    FOUND=1
  fi
done
```

That `awk` line is there because my first version used `grep '^+' | grep -v '^+++'` and on this system the chained-grep pipe was eating *both* the file-header lines (`+++ b/path`) and the actual added lines, which made the hostname check a silent no-op. `awk` parses the diff format properly: skip any line starting with `+++` (the file headers), keep any other line starting with `+` (the additions). One filter, no pipe weirdness. The same job, less subtle.

Installing the hook on a repo is one line:

```bash
ln -sf ~/Documents/Cline-Config/hooks/pre-commit-secret-scan \
       <repo>/.git/hooks/pre-commit
```

It is currently installed on this blog's repo. Bypassing it when I genuinely need to (the rare case where I'm publishing a redacted snippet that happens to share a long-enough prefix with a banned string, like a worked example of a hook regex that contains `Bearer ` followed by a placeholder) is `git commit --no-verify`. I have used it twice in two months.

## The Public-Share Allowlist

The last piece of the steering layer is the one that exists for the day I actually open-source the rules folder. `public-share-allowlist.md` is the *policy* layer that maps every file in `Cline-Config/` to one of three classifications:

- **Ship as-is.** Generic content, no internal infrastructure detail, no secrets. The persona file, the banned-words list, the github-commits style guide, the blog publishing reference. These can go to a public repo verbatim.
- **Ship with redactions.** Useful as a public template once internal values are swapped for placeholders. The filesystem-locations file, the homelab pointers, every runbook that mentions a host by name.
- **Never ship.** Plaintext credentials, the live MCP config with bearer tokens in it, the full homelab architecture map, the AWS shared-credentials file.

The companion to the policy layer is the substitution table: a one-to-one mapping from real value to placeholder, so a redaction is consistent across files. `host-1` in one file and `homelab-host-1` in another is itself a leak; the substitution table forces a single placeholder vocabulary across the whole tree.

A few representative rows:

| Real value | Placeholder |
|---|---|
| Internal Proxmox hosts | `<homelab-host-1>`, `<homelab-host-2>`, etc. |
| Backup server hostnames | `<pbs-1>`, `<pbs-2>`, `<pbs-laptop>` |
| Reverse-proxy host | `<reverse-proxy>` |
| Tailnet domain (e.g. `tail<8hex>.ts.net`) | `<your-tailnet>.ts.net` |
| Public IPv4s | `<wan-ip-A>`, `<wan-ip-B>` |
| LAN ranges | `192.0.2.0/24` (RFC 5737) |
| Real apex domain | `example.com` |
| Hardware specifics (model numbers, asset tags) | `<host hardware>` (one-liner) |

The risk model behind this is correlation, not just secrets. A leaked hostname plus a leaked WAN IP plus a leaked Ryzen model is enough to identify the homelab even if every individual fact is otherwise public somewhere. The substitution table breaks that correlation.

There is also a per-pre-publish checklist at the bottom of the allowlist: diff against the substitution table, run `git grep` for any real value that should not appear, run the pre-commit secret-scan against the staged tree as a final sanity check, confirm no file from the never-ship list has been copied accidentally, confirm the license file is present, confirm the README explains what was redacted and why. None of it is automated yet (writing a `redact-for-public.sh` that takes the substitution table as a sed mapping is a follow-up). For now, it is a 6-step manual checklist and that is fine.

## What Did and Didn't Work

A few things from running this for ~3 months:

**The persona section is doing more work than I expected.** Ban one filler phrase ("It's important to note that") and the rest of the AI smell drops with it. Suppressing the false-dichotomy framework alone has visibly improved the prose quality of every blog draft Cline produces.

**The two-tier split was the right call.** The first version of `rules/` had the full homelab architecture map in it, and every Cline session opened with the agent burning through a giant block of context that was relevant to maybe one task in twenty. Splitting it into pointers + on-demand reference cut always-on token usage by roughly 8000 tokens and made non-homelab tasks noticeably more responsive.

**The pre-commit hook caught real things.** Twice in 60 days. Both were embarrassing pastes into a markdown code block. Both would have made it to GitHub if the hook hadn't blocked the commit. The hook paid for itself the first time it fired.

**The credentials file living in the always-on rules tier still bothers me a little.** It is `chmod 600`, the file path is documented, the agent has explicit "do not echo, do not commit, never copy elsewhere" rules, and the pre-commit hook uses it as a source of truth for the danger-strings list. But it is still a plaintext credentials file inside a folder that is in the system prompt every turn, and the agent is one prompt-injection bug away from leaking it. The compensating control is that everything that file talks to is on Tailscale-only endpoints. The day Cline supports per-file ACLs on rules folders, this is the file that gets the strictest one.

**The next thing I want is the redaction script.** Right now, prepping a public version of the rules folder is a manual diff-and-substitute pass. A small script that consumes the substitution table as a sed mapping and runs against a copy of the tree on its way to the public repo would close that loop.

## Takeaway

A coding agent without a steering layer is a junior engineer who joined yesterday: smart, fast, well-meaning, with no idea how you work. A coding agent *with* a steering layer is the same junior engineer six weeks in: knows your conventions, knows the vocabulary you don't want, knows which folders are off-limits, knows what gets reviewed before it ships.

The pieces I'd start with if I were building this from scratch:

1. **A persona.** Two lines, no character to perform. Just enough to set the salutation.
2. **A banned-words list.** Buzzwords plus filler phrases plus the false-dichotomy ban. Five minutes of work, biggest single quality win.
3. **An opsec file.** Categories of things that must never leak, each with a placeholder vocabulary. Copy mine if it helps.
4. **One canonical config folder, symlinked into the OS-expected paths.** Sync it to whatever you already back up nightly. Don't keep two copies.
5. **A pre-commit hook that greps the staged diff for known secrets and known internal names.** ~110 lines of bash. Install it on every repo you push from.

Everything else is decoration.

The full rules folder will eventually go up as a public template once the redaction script exists and the substitution pass is automated. Until then, this post is the closest you can get to seeing it.
