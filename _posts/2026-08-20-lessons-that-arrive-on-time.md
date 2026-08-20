---
title: "Lessons That Arrive On Time: A Scored Corpus, and What Six Phases Actually Cost"
description: "Continuing from \"When the Output Looks Right\": building discernment into a coding agent. A dated lesson in a rules file is useless at the moment it matters, so I moved them into a scored corpus that injects the relevant warning two seconds before the mistake. Then the measurements: one frontmatter field cut a scheduled job from $0.31 to $0.05, cost scales with tool calls rather than jobs, and a real scheduled job cost 17 times what a trivial one did."
date: 2026-08-20 14:30:00 +0100
categories: [AI, DevOps]
tags: [cline, claude, llm, agents, self-learning, memory, automation, scheduling, cost]
---

[When the Output Looks Right](/posts/when-the-output-looks-right/) covered the
finding that started this: Anthropic's AI Fluency Index measured that people get
*less* critical exactly when an AI produces something polished, and I
promptly reproduced it twice in one day, finding four gaps in my own tooling
across two test suites that were both at 100%.

It also left a problem hanging. My self-learning loop works: when I correct
the agent on something its rules were supposed to govern, it proposes the
durable edit itself and the behaviour becomes permanent and inspectable. But
every lesson lands in the always-on rules tier, because that is the only tier
guaranteed to be in context. So the tier hit **195% of the hard budget I set
for it myself**, my own linter failed on it, and a note about an API's silent
pagination cap sat unread in a system prompt when it was needed two seconds
before a specific call.

This post is the fix, and what it cost.


## Giving Lessons a Third Home

The fix for the delivery problem is to stop treating "write it in the always-on
file" as the only option.

Lessons move into a small database with a few fields that matter: date learned,
keywords, the lesson, a severity, and a **burn count**, the number of separate
times that mistake has actually cost me something. Retrieval scores on
severity, burn count, recency, and keyword overlap with the task at hand, then
injects the top few through a hook, hard capped so it cannot itself become a
context problem.

The burn count is the weighting. One trap has bitten me three separate times; a
house-style rule bit me once. They should not rank equally, and a flat markdown
list has no way to express that.

Two design decisions I want to defend, because both look wrong at first glance.

**Capture never auto-approves.** A hook at task end can notice that a
correction probably happened, using unglamorous signals: I said "no, don't", or
the same tool failed twice against the same target. It writes a *candidate*.
Nothing enters the live corpus until I promote it. A poisoned memory is worse
than no memory, because it looks like knowledge and it loads before anyone can
question it. A weekly review queue where three items in ten are useful beats an
LLM-judged auto-approver that confidently persists a hallucinated lesson into
every future session.

**No embeddings yet.** This is where I expect disagreement, since "vector
memory" is the obvious answer. At thirty entries, semantic search is worse
than keyword matching. Recall is not the constraint at that scale; precision
and explainability are. When a keyword match fires I can see why and fix the
keyword. When a cosine similarity of 0.71 fires, I cannot. And "surface this
more often because it keeps biting me" is a counter, not a vector: embeddings
measure semantic proximity, which is not the property I am trying to weight.

The schema carries an embedding column from day one, so adding vectors later is
a backfill rather than a rewrite. The trigger is a few hundred entries, or a
miss caused by vocabulary rather than relevance. I already run a local
embedding endpoint; it is a question of when the corpus justifies it, not
whether the infrastructure exists.

## Verifying It Actually Delivers

Thirty lessons went in, all of them things I had already written down
somewhere. The corpus is a delivery mechanism, not new knowledge.

Then I tested it the only way that means anything. I told a fresh session to
run a tracker query with a deliberately wrong page size, and asked whether
anything in its context had warned it. Its reply, lightly trimmed:

> **Yes, three warnings fired**, and all three are about the *result*, not the
> risk.
>
> **1. `per_page=100` is a silent lie.** [The tracker] silently caps it at 50:
> it returns 50 items with no warning and no error. So even against the live
> instance, that exact query would have undercounted.
>
> **2. `curl -s` with no status check is the documented false-negative.** A
> loop that parses the response and takes its length reads "0 open tickets,
> everything closed".
>
> Steering worked as designed here, so I have no rule edit to propose.

The hook's own log confirms it, one line per tool call:

```
ALLOW tool=run_commands subagent=False strings=2 lessons=1
```

The lesson arrived two seconds before the mistake, matched to the command
about to run, instead of sitting unread at line 280 of a file that loads on
every turn whether it is relevant or not.

The last line of that reply is the part I did not expect. My steering tells the
agent to propose a rule edit whenever it gets corrected on something the rules
were supposed to govern. It declined, correctly, because nothing had gone
wrong. That is a small thing, and it is the first time the loop has told me it
had nothing to learn.

## Where the Cost Actually Lands

The context budget stopped being an abstraction the moment I measured a
scheduled job.

A job whose entire body was one shell command consumed **49,124 input tokens
and cost $0.31**. Not because the work was expensive, but because the
always-on rules tier loads into every scheduled run. Setting one frontmatter
field to skip it took the same job to **7,194 tokens and $0.05**.

That is 85% of the cost being steering context the job never needed. At hourly,
roughly $223 a month against $36. And cost scales with round trips, not jobs: a
tool call means a second model call re-sending the whole context plus the
result, so the same trivial job measured 98,499 tokens once it actually invoked
something.

The multiplier matters more than the base cost. My first genuinely useful
scheduled job, a read-only audit that queries a few machines and reports what it
finds, cost **$0.86** for one run: nine tool calls, 150,851 input tokens.
Seventeen times the trivial job, with the same context-skipping setting
applied. `extensions: []` shrinks the base that gets re-sent every round trip;
it does not make a working job cheap.

Weekly, that is about $3.70 a month and entirely fine. Hourly it would be $620
a month and obviously not. So "measure the first run before choosing a
frequency" went straight into the lessons corpus, which is the only reason I
will remember it in six weeks.

Which reframes the tiering exercise. Trimming the always-on tier used to be
hygiene. Now it has a per-run price that compounds with every step an agent
takes. For the record it worked: **1,770 lines down to under 1,500**, and my budget
linter passes for the first time in weeks. Nothing was deleted; about 280 lines
of procedure moved into skills, costing roughly a hundred tokens each until
something matches them.

## The First Job That Earns Its Keep

The point of all this was never the machinery. It was to have work happen
without me.

The first scheduled job is a weekly configuration audit: a read-only script
runs against my own infrastructure, checks a property I care about, and reports
anything that does not hold. The specific check does not matter for this post.
What matters is that it is diagnose-and-report only, and that it runs whether
or not I remember to.

Four controls, all of them enforced rather than requested:

- `mode: plan`, which cannot edit files at all.
- A `tools:` allowlist of exactly two entries. This is the real
  least-privilege mechanism I could not get from a persona.
- `extensions: []`, per the cost finding above.
- A schedule deliberately placed outside my existing maintenance windows, so
  it cannot contend with the jobs it is auditing.

I test-fired it on a three-minute schedule before trusting the weekly one. It
came back with real findings: an inconsistency between systems that should have
been configured identically, of the sort that hides for months precisely
because nothing is obviously broken. Deliberately not detailing it here, for
reasons I will come back to.

It also did something I had not asked for and should have. My prompt said to
report a particular class of stale entry. It reported zero, and then ran the
audit script's own self-test suite to demonstrate that the zero came from a
working detector rather than a broken one. That is the "is this success signal
actually trustworthy?" question, asked unprompted, by the thing I built because
I keep failing to ask it.

Findings went to my tracker rather than into a fix, because remediating them
touches live infrastructure, which is exactly the class of action an unattended
agent should never take.

## The Review That Caught What the Regexes Could Not

One more thing happened while writing this, and it belongs here rather than in
a footnote.

Before publishing, I ran both drafts through the opsec reviewer described in
[the previous post](/posts/when-the-output-looks-right/). Both had already passed every automated check I have: no hostnames,
no addresses, no paths, no credentials, no product names. Clean.

The reviewer blocked publication anyway, and its argument was one no check I
had built could reach. It read the posts I had **already published** on the
same site, under the same name, and found that earlier articles had disclosed
enough identifying detail that a *generalised* statement in these drafts
resolved back to specific named systems. The sentence was anonymous. The
sentence plus my own archive was not.

That is why the paragraph above is deliberately vague. The finding was real and
worth acting on privately; publishing which systems it applied to would have
been an advertisement.

The generalisable version: **a draft cannot be reviewed in isolation from what
you have already published under the same identity.** Aggregate disclosure is
not a property of the document in front of you. Every regex I run scans one
file, which means that whole class of leak is invisible to them by
construction. It took a reviewer with different instructions and no attachment
to the draft to see it.

The single worst instance was in the front-matter `description`, which becomes
the meta description, the search snippet, and the social card: the most
syndicated line in the file, written first and never re-read against the
finished body. Both of those are now lessons in the corpus.

## What I Am Deliberately Not Building

The restraint is usually the interesting half of these posts.

**Auto-approved lessons.** The entire value of the corpus is that its contents
are true. **An LLM ranking which lessons to retrieve**: a model call per task
start to decide relevance is expensive, non-deterministic, and undebuggable,
where arithmetic on a score column is none of those. **Embeddings at thirty
entries**, covered above. **Per-persona tool sandboxing**, not expressible in
the format, so I would rather document the limitation than imply a guarantee.
And **anything self-healing wired to alerting**: my own rules already call that
the highest-risk idea on the roadmap and mandate diagnose-and-ticket only.
Adding a guard that can veto tool calls is a prerequisite for revisiting it, not
permission to.

## Where It Stands

Five of six planned phases are live on this machine.

- **The guard** blocks dangerous tool calls, has stopped a real recursive
  delete during testing, and passes 55 fixtures including four that exist
  because it once did not.
- **The three-tier split** works: the always-on tier went from 1,770 lines to
  under 1,500, and the budget linter passes for the first time in weeks. About 280
  lines of procedure moved into skills that cost roughly a hundred tokens each
  until something matches them.
- **The corpus** holds 30 lessons and has delivered on 17 real tool calls.
- **Three sub-agent personas** are installed, with the independence gap
  documented rather than papered over.
- **One scheduled job** runs weekly, read-only, and cost $0.86 on its first
  real run.

The sixth is embeddings, deliberately parked. At thirty entries keyword matching
beats vector search and is debuggable, which matters more. The schema carries
an embedding column so adding them later is a backfill, not a rewrite. The
trigger is a few hundred entries, or a miss caused by vocabulary rather than
relevance.

One thing is still open and I would rather say so: the daemon that fires
scheduled jobs is not yet supervised, so it survives a terminal exit but not a
reboot. The expected failure mode is a job that quietly stops running, which is
the same class of problem as everything else in these two posts: absence of
output looks identical to nothing being wrong. Wiring up a persistent service
is the fix and I have not made that decision yet.

## Takeaway

The self-learning part of all this is not an agent getting mysteriously
smarter. It is that every time it gets something wrong, the fix lands
somewhere it will actually be read *at the moment it matters*. A dated lesson
in a system prompt is a hope. The same lesson injected two seconds before the
call it applies to is a control.

The cost result was not what I expected. I had assumed trimming the always-on tier was
hygiene. It turned out to have a per-run price that compounds with every step
an agent takes, which reframes context discipline as an operating expense
rather than tidiness.

And the part I keep relearning: **the thing that looked like it was working
usually was not.** A job reporting `done` while consuming zero tokens. A CLI
reporting no schedules while a job fired every two minutes. An audit log I had
chosen as a liveness signal that the fast path never wrote to. A retrieval
layer that was inert for exactly the calls it existed for, because a
performance optimisation short-circuited before it ran.

Five plausible surfaces over empty interiors, in one day. The mechanisms in
these two posts are all, in the end, the same bet: that a check you build is
worth more than a check you intend to perform.

---
