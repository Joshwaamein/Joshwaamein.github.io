---
title: "Auditing a Homelab With AI Agents: Personas, Four Waves, and an Adversarial Verifier"
description: "The architecture of a security-review system built from AI agent personas: a read-only auditor with a hard constraint list, a four-wave pipeline where each wave answers a question the previous one cannot, a checklist of stable-ID checks that each carry a known trap, and an adversarial verifier whose only job is to falsify the most severe finding. What each component is, why it exists, how it fits together, and what it delivers."
date: 2026-08-20 16:30:00 +0100
categories: [AI, DevOps]
tags: [cline, claude, llm, agents, multi-agent, adversarial-review, security, automation]
---

## What This Is

A security-review system for a multi-site homelab, built out of AI agent
personas rather than a scanner. Five parts:

| Component | Role |
|---|---|
| **Process runbook** | How not to be wrong. Five rules, each derived from a verdict that turned out false. |
| **Checklist** | What to look at. 86 checks in 11 domains, stable IDs, each carrying the trap that has previously produced a wrong answer. |
| **Auditor persona** | Read-only recon on a named set of hosts. Collects evidence, never remediates. |
| **Four-wave pipeline** | Recon, then cross-host exposure, then adversarial verification, then the write-up. |
| **Adversarial verifier** | Attacks the most severe finding with instructions to disprove it. |

It is read-only end to end. The output is a report, a findings file with
evidence per finding, a suppression list, and verbatim per-host collection logs.

This post covers the architecture, not the results. Nothing here describes the
state of any control on my own fleet.

## Why It Exists

Three problems, each of which defeats the obvious approach.

**Breadth beats attention.** A configuration review across a multi-site fleet is
a host count multiplied by a domain count, and the interesting answers live in
the combination. Doing that by hand means either a shallow pass over everything
or a deep pass over a sample, and the sample is chosen by whatever you happened
to be worried about that week.

**Polish reads as correctness.** An agent writes a fluent, well-structured
security finding whether or not the finding is true, so the usual signals for
"this needs a second look" are absent exactly when they matter most. Trusting
the output because it reads well is the failure mode, and it cannot be fixed
with resolve. It has to be designed against.

**The best findings are invisible to status checks.** The highest-value class in
any review is the silent failure: a control that passes "is it running" and
protects nothing. Monitoring answers whether a service is up and whether a rule
exists. It does not answer whether the control is doing its job.

So the system needs to cover breadth cheaply, distrust its own output
structurally rather than by good intentions, and ask a harder question than "is
it enabled".
## How It Works

### Three documents, three jobs

The first version was one long file, and it failed in a specific way: process
advice and check content interleaved, so the checks were buried in prose and the
process rules got repeated inside individual checks. Splitting by job fixed it.

The **runbook** is process, and it wins any disagreement. The **checklist** is
content: 86 checks with stable IDs like `N-04`, append-only, so a finding cites
the check that produced it and a coverage gap gets a name instead of a
description. The **skill** is procedure, loaded on demand when a task matches, so
it costs nothing on sessions that are not audits.

That tiering matters beyond tidiness. My always-on rules tier, which loads into
every single session, had grown to 195% of the budget I set for it, because every
lesson I learned went into the only tier guaranteed to be in context. Procedure
belongs in an on-demand skill. Live state belongs in reference docs.

### The auditor persona

A persona is frontmatter plus a system prompt. The frontmatter makes it
selectable:

```yaml
---
name: host-security-auditor
description: Read-only security recon of a named set of homelab hosts. Use when
  auditing listeners, firewall state, sshd config, privilege boundaries,
  container exposure, patch debt, or certificate validity across specific hosts.
  Collects evidence and reports findings; never remediates.
providerId: bedrock
modelId: global.anthropic.claude-opus-5
maxIterations: 40
---
```

The `description` is a routing signal, not documentation, so it reads as a list
of trigger conditions.

The body is mostly prohibitions: never modify a packet filter or any network
control plane, never start or stop a service, never install or remove a package,
never create or edit a file anywhere including temp directories, never change a
power state, never touch certificate material, never write to a repository.

Then the constraint that matters more than all of those combined:

> **Never read secret material.** You may note that such a file exists and
> record its **mode and ownership**, never its contents. Use `stat` or `ls -l`,
> never a command that prints the body of the file.

An audit's real question about a private key is whether its permissions are
right, which needs metadata. Without that sentence an agent will happily read a
credential file into a report that then gets written to disk.

Seven evidence categories per host: listeners with bind addresses, firewall state
at every layer, effective SSH daemon config, privilege boundaries, container
exposure, patch debt, certificate expiry.

Two of those embed a trap in the prompt itself. On listeners, record the
**address** and not just the port, because a wildcard bind, a private overlay
bind, and a loopback bind are three completely different exposures that look
identical in a port list. On firewalls, absence of a host firewall is not absence
of firewalling, since a guest can legitimately rely on the hypervisor layer, so
the agent must name which layer enforces what before calling anything
unfirewalled, and must check each address family separately rather than assuming
they match.

Access is one batched call per host:

```bash
timeout 20 ssh -o BatchMode=yes -o ConnectTimeout=8 <admin-user>@<host> '<batched script>'
```

`BatchMode=yes` so a missing key fails fast instead of hanging on a prompt.
`timeout` so one unresponsive machine cannot stall the run. A host that refuses
the key is itself a finding, recorded before moving on, and the agent is told
never to try another credential.
### The four waves

Each wave answers a question the previous one structurally cannot.

**Wave 1, recon.** One agent per host group, grouped by role so a single batched
command set is valid for every host in the group. Each agent receives its host
list, the checklist IDs in scope, and its slice of the **suppression list**.

That suppression list is the component I would add first if I rebuilt this. It is
the set of known and accepted risks, assembled before any agent starts. An
accepted risk re-reported as a finding does not merely waste attention, it
devalues every other finding in the document.

**Wave 2, cross-host exposure.** Takes Wave 1's output and judges reachability
between hosts. This has to be its own wave because "what is this host running" is
answerable from that host, and "who else can reach it" is not answerable from
that host at all.

**Wave 3, adversarial verification.** Below.

**Wave 4, the write-up.** The lead writes every file. Sub-agents return content
in their reply; they do not reliably share the lead's filesystem, and an agent
claiming it saved a report has been wrong before, with the wrong path and the
wrong date.

### The adversarial verifier

Dispatched at every finding rated Critical, with instructions to **disprove** it
and to name the specific objections that would collapse it. Not "review this".
Confirmation is a permitted outcome, never the goal.

Its attack list is ordered by yield, and the ordering came from real misses:

1. **The allowlist, the exemption, the special case.** Every "except when" is a
   candidate bypass. The question that finds most of them: does the exemption
   apply per item, or to the whole input?
2. **The success signal.** Does "it worked" mean it worked? Two live examples from
   my own machine: a scheduled run reporting success while its own summary said
   the model ID was invalid and it consumed zero tokens, and a job runner
   reporting no schedules found while a job fired every two minutes.
3. **The synonym.** A rule matching one spelling of a command and not its
   equivalent is not a rule. Try split flags, long-flag forms, environment
   variables, nesting, chaining.
4. **Failure direction.** Fails open or closed, and is that deliberate?

Its output contract is verdict-first: a `VERDICT` line, then at most six findings
of at most four lines each, then a closing line naming the classes it attacked.
Verdict first is deliberate. A review whose conclusion sits at the end is a
review whose conclusion is the first thing lost if anything truncates the reply,
and capping the body forces the agent to rank rather than enumerate.

### The five process rules

Each maps to a specific verdict that turned out to be wrong.

**1. Probe from a different host on the same subnet.** A probe from a host to its
own address proves nothing about who else can reach it, and a rule listing proves
nothing on its own.

```bash
# WRONG: proves nothing about reachability
ssh <admin-user>@target 'curl -s localhost:8080'

# RIGHT: from a peer on the same subnet
ssh <admin-user>@peer 'timeout 3 bash -c "</dev/tcp/<target-ip>/8080"'
```

**2. Sweep before you generalise.** Two samples are not a pattern. Writing
"fleet-wide" from two observations sends remediation at healthy machines and
buries the real ones.

**3. Establish your own vantage point before reasoning from it.** Before
concluding anything from "this host shares a prefix with me", confirm where you
are.

**4. Distinguish "today" from "always" before it enters the docs.** A transient
event written up as a standing property will mislead every future session, and the
always-on tier is the most expensive place in the system to be wrong because
nothing re-reads it critically.

**5. Verify a control works, not that it exists.** Ask what artefact would exist
only if the control had actually fired. For anything whose job is to act on an
event, that is a counter moving, not a status line. A control that cannot produce
such an artefact cannot be verified and should not be counted as protection.
## What It Delivers

**Breadth at a cost that scales.** Host groups run in parallel with one batched
call per host, so wall-clock time tracks the number of groups rather than the
number of hosts. The domains that only apply to part of the fleet cost
proportionally less.

**Findings that survive contact with an adversary.** The verifier changed the
substance of my most serious finding: it confirmed the mechanism with better
evidence than I had gathered, by querying the authoritative source for the actual
permitted operations rather than inferring them from a label, and it falsified my
claim about that mechanism's blast radius. I had written an absolute ("there is no
case where...") about a distribution I had never enumerated item by item. It
enumerated it and the absolute was simply false.

The most useful detail: the false sentence was false in the *flattering*
direction, making the finding sound more severe. That is the direction I am least
likely to check, and a verifier does not care which way the error points.

**A remediation order worth following.** Post-verification, the recommended first
action was reversible and took minutes. My original order started with the change
that had the longest rollback. Same findings, different sequencing, much better
risk-per-unit-effort.

**Corrections that stay visible.** One finding was withdrawn outright. It stays in
the findings file with the reasoning error written out, because a review that
silently edits its mistakes gives a reader no basis for judging the rest of it.
If you cannot see how a wrong conclusion was caught, you cannot calibrate the
conclusions that were not caught. That applies double when an AI produced the
document.

**A report that names its own edges.** There is an explicit "what this did not
cover" section listing every out-of-scope domain, so gaps are not mistaken for
clean results, which is the failure mode of every audit summary that only lists
what it found.

**Reusable evidence discipline.** Every rule above came from a wrong answer, so
the checklist gets better in a way that does not depend on remembering. Each
check carries its own trap.

## Two Things to Know Before You Build This

Neither is a bug, and both change how you scope the work.

**A persona's read-only promise is a contract, not a sandbox.** The persona
format I use has no field for restricting which tools an agent may call, so an
agent whose prompt says read-only can still reach for an editor. The prohibition
list in that prompt is doing real work, because a model follows it, but it is
not enforcement. Actual enforcement needs a lifecycle hook that can veto a tool
call before it runs, or an equivalent allowlist. Check whether your own persona
format enforces anything at all, and assume it does not until you have proven
otherwise.

**Scope each agent narrowly, in the low single digits of hosts and one check
domain.** This is not caution, it is arithmetic: a turn has a finite output
budget, reasoning spends the same budget, and a broad task exhausts it partway
through. The result is an agent that stops mid-collection having reported a
fraction of what it found. Small scopes that finish beat wide scopes that die,
and splitting is cheap. Run two or three at a time rather than fanning out.

Worth building the refusal into the persona rather than remembering it at
dispatch time. Mine is told that more than a handful of hosts, or more than one
domain, must be handed back with a proposed split before it runs anything. Given
a deliberately over-scoped request it now returns the split, having touched
nothing, which is a useful result rather than a wasted run.

## Where This Leaves Me

The system produces a review I trust more than one I would have written by hand,
for a reason that has nothing to do with the agents being clever. It is that
every claim has to survive a specific, mechanical challenge before it reaches the
report: probed from a separate host, swept before generalised, attacked by an
agent instructed to disprove it, and checked against the docs for the host it
concerns.

None of that is insight. It is procedure, which is exactly why it can be
delegated to a machine and exactly why it holds up when I am tired or in a hurry.
The components that earn their place are the ones that produce observations
rather than opinions.

Related: [From One Agent to a Team](/posts/from-one-agent-to-a-team-async-loops-and-multi-agent-cline/)
on the persona and autonomy model, and
[When the Output Looks Right](/posts/when-the-output-looks-right/) on why
adversarial review is a different activity from testing.
