---
title: "Teaching Cline to Learn From My Corrections: Turning Conversation Steering Into Durable Rules"
description: "Self-learning AI agents promise to get smarter from every interaction. Here is the honest version for a coding agent like Cline: it does not retrain its own weights from your chats, it consolidates your corrections into rules files that load as context on every future run. A worked example: a task-routing fix that became a permanent keyword map, plus a new rule that makes the agent propose the durable edit itself."
date: 2026-06-11 20:00:00 +0100
categories: [AI, DevOps]
tags: [cline, claude, llm, agents, self-learning, steering, automation, opsec]
---

A vendor blog I read this week opened with a line that stuck: most AI agents are "stuck in time, they perform the same way on day 1000 as they did on day 1." The pitch was self-learning agents that improve from every interaction, the way an experienced employee gets sharper over time. It is a good pitch. It is also, for most of us running a coding agent on a workstation, not quite how the learning actually happens.

I drive most of my homelab work through [Cline](https://cline.bot), the open-source coding agent. In an earlier post I wrote up [the tiered rules system I steer it with](/posts/how-i-steer-cline-with-a-tiered-rules-system/): the persona, the banned-words list, the opsec policy, the canonical config folder. That post was about the *static* layer, the rules that are true on day one. This post is about the loop that makes the agent better on day fifty: how a correction I type in a normal conversation becomes a permanent change in how the agent behaves, without anyone retraining a model.

I will use one real example end to end (a task-routing fix), explain the two very different things people mean by "the agent learned", and show the rule I added so the agent now proposes its own durable edits when I correct it.

## What "Self-Learning" Actually Means for a Coding Agent

The marketing version of self-learning blends two mechanisms that are worth keeping apart, because only one of them is happening on my machine.

**Weight-level learning.** Changing the model's parameters through fine-tuning or RLHF (reinforcement learning from human feedback). This is what permanently bakes a behaviour into the model itself. It happens offline, in a training pipeline, on aggregated and reviewed data. It is emphatically *not* happening when I correct Cline mid-task. Nothing I type today silently retrains Claude. The weights I am talking to next week are the same weights I am talking to now.

**Context-level learning.** Changing what the agent reads before it acts. The model is fixed, but the instructions, memory, and reference material loaded into its context window are not. This is the lever I actually pull, and it is the one that adapts the agent to me. When the agent "remembers" that I hate em dashes or that a particular backup host is reachable only over a private overlay network, it is not because a neuron changed. It is because a markdown file said so and that file was in the prompt.

Almost everything sold as "self-learning" for agents you run yourself is the second kind dressed up as the first. That is not a complaint. The context version is more auditable, more reversible, and far safer than an opaque weight update you cannot inspect. But it is worth being precise, because the precision tells you exactly where to put the work: into the files that get loaded, not into hoping the model absorbs your preferences by osmosis.

## The Loop, Concretely

Here is the actual learning loop for an agent steered by rules files. It is not reinforcement learning. It is closer to a code review that ends in a committed config change.

1. The agent makes a decision based on its current rules.
2. I correct the decision in conversation.
3. The agent applies the immediate fix for the task at hand.
4. The agent identifies which rules file governs that kind of decision.
5. The agent proposes a concrete edit to that file so the corrected behaviour becomes the new default.
6. I approve.
7. The edit is written. On every future run, that file loads as context, and the corrected behaviour is now the default.

Step 7 is the learning. Nothing is "learned" until it is written into a steering file. A correction that never makes it into a rule evaporates the moment the context window rolls over or the session ends. There is no background process where the agent mulls over our chats overnight and wakes up wiser. The consolidation is explicit, human-approved, and stored in a file I can diff.


## A Worked Example: Task Routing That Stuck

A representative case (details changed, the shape is real). I keep my to-do list in a self-hosted task app, reachable only over a private overlay network. I have several projects: General, Homelab, and a handful of others. When I hand the agent a list of items, I want each one filed in the right project without being asked twenty questions.

I gave it three homelab tasks:

```text
update some service documentation
review a host firewall change
write a config-management playbook for a networking tweak
add these items to my list
```

The first pass was reasonable but cautious. The agent authenticated against the app's REST API, listed the existing labels (every task on my board must carry at least one), and then asked which project each item belonged in rather than inferring it. It had no rule telling it that documentation, a firewall change, and a config-management playbook are all homelab engineering work, so it defaulted toward dumping everything in General and asking.

That is the correction moment. I told it plainly:

> these are all homelab tasks, they go in the Homelab project. please edit your cline config so you can better interpret where homelab items go.

Two things happened. The immediate fix: it created the three tasks in the Homelab project, each with a confirmed label, via the app's task-creation endpoint. The durable fix: it opened the rules file that owns the task-app behaviour and added a keyword-routing block so it would never need to ask again. The relevant part of what got written:

```markdown
- **Task routing by keyword (auto-route, do not ask which project).**
  When master hands me a list of items to add, route each to its
  project from the subject matter. Confirm the project only if no rule
  below fits. Established mappings:
  - Homelab / infra / fleet / host work, including documentation
    updates, firewall changes, config-management playbooks, and
    networking tweaks -> project Homelab.
  - Health, GP, dentist, prescriptions -> project Healthcare.
  - When an item matches none of the above, fall back to project
    General and ask if unsure.
  - Worked example: "update some service documentation" -> Homelab,
    "review a host firewall change" -> Homelab,
    "write a config-management playbook" -> Homelab.
```

That last block, the worked example, is the part I want to draw attention to. It is the same idea the self-learning vendors call a "golden sample": a known input paired with its correct output, kept around so future runs have a concrete case to pattern-match against rather than re-deriving the decision from a general description. Three lines of concrete examples do more to pin down behaviour than a paragraph of abstract rules. Next time I paste a messy list of infra tasks, the agent has both the rule and a precedent.





## Making the Consolidation Automatic

The routing fix worked, but it relied on me explicitly saying "edit your config". I did not want to have to remember that phrase every time. The whole point of a learning loop is that the consolidation step happens on its own.

So I added a standing rule. It lives in the always-on tier of my Cline rules, right after the planning section, and it tells the agent to treat any correction of a rule-governed decision as a trigger to propose the durable edit itself, in the same turn, without being asked:

```markdown
## Learning from steering (consolidate corrections immediately)

When master corrects a decision that is governed by a steering file (a
routing rule, a default, a naming convention, a workflow preference, a
tool-usage habit), treat the correction as a signal to update the
relevant rule, not just a one-off fix for the current task.

- **Propose the durable edit in the same turn.** As soon as I apply the
  immediate fix, identify which rules/reference file encodes that
  behaviour and propose the concrete edit that makes the corrected
  behaviour the new default. Do not wait to be asked to "update config".
- **Show the exact change.** Name the file and quote the precise text to
  add or change so it can be approved or adjusted in one step.
- **Record a worked example.** When the rule is a routing or
  classification decision, append a dated worked example (the input and
  the chosen target) so future runs have a golden sample to match against.
- **Human-approved, then persisted.** Apply the edit only after I
  confirm. The edit is the learning step: it loads as context on every
  future run. Nothing is "learned" until it is written into a file.
- **Stay within guardrails.** Edit the file that already owns that
  behaviour. Do not invent a new rules file without asking.
- **Don't over-fit.** If a correction looks like a one-time exception
  rather than a new standing rule, say so and ask whether to encode it,
  rather than baking a special case into the steering files.
```

Five of those six bullets are guardrails, and that is deliberate. An agent that rewrites its own configuration is exactly the failure mode you want to be careful about. The constraints map almost one-to-one onto the safety mechanisms the self-learning literature talks about:

- **Human-approved, then persisted** is human-in-the-loop. The agent proposes; I dispose. No silent self-modification.
- **Stay within guardrails** is bounded learning. The agent can optimise *within* the existing rules structure but cannot invent new policy files or violate the structure on its own.
- **Don't over-fit** is the guard against the agent turning every one-off into a standing rule, which is how a clean config rots into a pile of special cases.
- **Show the exact change** keeps every modification auditable and diffable, the config-file equivalent of version control for the agent's behaviour.

The net effect: the routing fix from earlier stopped being a thing I had to ask for and became the default workflow. The next time I correct how the agent classifies something or where it files a thing, it fixes the task and immediately offers the rule edit that makes the fix permanent. I review a one-line diff instead of re-explaining myself next month.

## Why This Beats Waiting for "Real" Self-Learning

There is a version of this problem that gets solved by fine-tuning a model on your preferences. For a single user steering a coding agent, it is the wrong tool. Fine-tuning is slow, expensive, opaque, and almost impossible to reverse cleanly. If the model learns the wrong lesson from your corrections, you cannot open a diff and see what changed. You retrain again and hope.

The rules-file approach gives up the romance of an agent that "just learns" in exchange for properties I actually want:

- **Inspectable.** Every learned behaviour is a line of markdown I can read.
- **Reversible.** A bad rule is a one-line revert, not a retraining run.
- **Portable.** The rules live in a single canonical folder synced to my homelab and snapshotted nightly. Restore it on a fresh machine and the agent has the same accumulated knowledge. The learning is not trapped inside a model checkpoint.
- **Auditable.** Because the agent has to *show* me the edit before it lands, I see exactly what it thinks the lesson was. Half the value is catching the cases where it drew the wrong conclusion from my correction.

The vendor blog that set me off framed self-learning as the agent getting smarter on its own. The honest version for a tool you run yourself is quieter: the agent gets smarter because every time it gets something wrong, it helps you write down the fix in a place it will read next time. The intelligence is in the loop and the file, not in some emergent property of the model. That is a feature. I would rather have a hundred lines of markdown I can read than a model that learned something I cannot see.

## A Postscript That Wrote Itself

This post is a worked example of its own thesis, which I did not plan.

While drafting it, I asked the agent to spin the blog up on a local dev stack so I could read the post rendered before publishing. It reached for the native toolchain first: install the build dependencies on the workstation and serve the site. On this machine that fell over hard. Several old native dependencies would not compile against the toolchain's strict compiler, and once those were worked around, the stylesheet compiler crashed during the build. A few separate failures, each a different rabbit hole.

So I corrected it: use Docker for local stack testing instead of compiling native toolchains on the workstation. It pulled a Linux image, mounted the repo, adjusted the stylesheet-compiler configuration inside the isolated preview container to get past the crash, and served the site. I read the post locally a minute later.

Then the loop closed on itself. Because of the "consolidate corrections immediately" rule above, the agent did not just fix the preview and move on. It proposed two durable edits: a general rule in the always-on tier ("prefer Docker for local personal-stack testing over native toolchains"), and a specific note in the blog reference doc with the working setup and the compiler workaround. I approved both. The next time it previews any site locally, it goes straight to Docker, and the next time it previews this blog, it has the working recipe sitting in a file.

That is the whole post in one incident: a correction, a proposed diff, an approval, a file write, and a behaviour that is now permanent and inspectable. The agent got better at one specific thing today, and I can read exactly how in a one-line diff.

## Takeaway

If you steer a coding agent with rules files, add one rule before any other: when you correct a decision the rules are supposed to govern, the agent should propose the durable edit to those rules itself, then and there, and apply it once you approve. That single rule turns every correction into a permanent improvement instead of a thing you re-explain next week.

The mechanics underneath are unglamorous and that is the point. No weight updates, no overnight training, no black box. A correction, a proposed diff, an approval, a file write. The agent that files my homelab tasks in the right project today does so because of a short routing rule and a three-line worked example that a conversation turned into config. That is what self-learning looks like when you can actually see it happening.
