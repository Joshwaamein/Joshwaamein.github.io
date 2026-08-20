---
title: "When the Output Looks Right: Why a Green Test Suite Stops You Looking"
description: "Anthropic's AI Fluency Index found that people get less critical exactly when an AI produces something polished: fact-checking drops 3.7 points and spotting missing context drops 5.2 points the moment code or documents are involved. I reproduced that finding on myself twice in one day, finding four gaps in my own tooling across two test suites that were both at 100%. What I built instead of trying harder: lifecycle hooks that can veto a tool call, and adversarial review with a deliberately narrow trigger list."
date: 2026-08-20 14:00:00 +0100
categories: [AI, DevOps]
tags: [cline, claude, llm, agents, adversarial-review, multi-agent, hooks, testing]
---

This is the fourth entry in a series on steering [Cline](https://cline.bot),
the open-source coding agent I run most of my homelab work through, and it runs
across two posts. The
[first](/posts/how-i-steer-cline-with-a-tiered-rules-system/) covered the
static steering layer: a tiered rules system, a persona, a banned-words list,
an opsec policy. The
[second](/posts/teaching-cline-to-learn-from-my-corrections/) covered the
learning loop, where a correction I type in conversation becomes a permanent
rule the agent proposes itself. The
[third](/posts/from-one-agent-to-a-team-async-loops-and-multi-agent-cline/)
covered running it unattended: an autonomy envelope, specialised personas,
alert-and-stop.

All three assumed something I never examined: that when the agent hands me
something, I check it properly.

Anthropic's [AI Fluency Index](https://www.anthropic.com/research/AI-fluency-index)
has a number suggesting I do not.

## What the Study Measured

Anthropic analysed 9,830 Claude conversations from a week in January 2026,
scoring them against the [4D AI Fluency Framework](https://anthropic.skilljar.com/ai-fluency-framework-foundations)
(Delegation, Description, Discernment, Diligence) developed by Professors
Rick Dakan and Joseph Feller. Twenty-four behaviours, of which eleven are
observable inside a conversation.

The first finding is the encouraging one. 85.7% of conversations involved
iteration and refinement, and those averaged 2.67 fluency behaviours against
1.33 for one-shot exchanges. Users who iterated were **5.6x more likely to
question the model's reasoning** and **4x more likely to spot missing
context**. Staying in the conversation correlates with everything else good.

The second finding is the one that matters here.

In the 12.3% of conversations that produced artifacts, meaning code,
documents, or interactive tools, users got measurably *better* at directing
the work: clarifying the goal (+14.7 percentage points), specifying a format
(+14.5pp), providing examples (+13.4pp). And measurably *worse* at evaluating
what came back. All three discernment behaviours dropped: identifying missing
context **-5.2pp**, checking facts **-3.7pp**, questioning the reasoning
**-3.1pp**.

Read that again with a developer's eyes. The conversations where the output is
*code* are the conversations where people check least.

Anthropic offers alternative explanations, including that users may evaluate
elsewhere, by running the code or asking a colleague, in ways the study cannot
observe. Fair, and it probably deflates the effect for developers. But the
mechanism they describe is the useful part: if the work *looks* finished, users
treat it as finished. Polish reads as correctness.

I cannot fix that with resolve. I have been telling myself to be careful for a
year. What I can do is build the checking into the machinery, so it happens
whether or not I remember.

## Reproducing It On My Own Code

The first thing I built was a lifecycle hook that blocks dangerous commands
before they run, enforcing the destructive-action list in my autonomy rules. It
passed all thirty-four of its fixtures. Green, and it looked finished.

Ten minutes of deliberately attacking it found two holes.

**The allowlist was substring-based.** The guard exempts scratch directories,
because a guard that blocks routine work gets uninstalled. My check asked
whether a safe path appeared anywhere in the command string, so a recursive
delete naming a temp directory *and* a real one together was allowed: the safe
path whitelisted the dangerous target beside it.

**A whole command family was missing.** I had patterns for the obvious delete
command and nothing for `find ... -delete`, which removes files just as
thoroughly.

The fix was structural rather than another pattern: judge each target of a
destructive command separately, instead of scanning the whole string for a
reassuring substring. Both cases became permanent fixtures.

What that buys is narrow but real. Two command forms that would have deleted
real data now cannot, and the guard's notion of "safe" no longer depends on
where a word happens to appear in a string.

The reason it is in this post is the timing: thirty-four passing tests hid both
holes, and I found them forty minutes after reading a study about not checking
polished output. The tests were not wrong. They were insufficient in a way that
looked sufficient.

Then the same thing happened on a larger suite.

By then the suite had grown to fifty-one cases, all passing, including the two
regressions above. I had just built an adversarial reviewer whose entire job is
to attack freshly written artefacts, so I pointed it at the guard. It got as far
as confirming the baseline and starting its first attack battery before its run
died, for an unrelated reason.

So I ran the battery by hand. Ten payloads. Two walked straight through, and
both were actions the guard already blocked **in their other spelling**.

One was a destructive delete written with long flags where my pattern only
recognised the clustered short form. The other was a history-rewriting push
written with a one-character flag where my pattern only covered the spelled-out
version. Same operations, same danger, different surface text, and the guard
waved both through.

Eight other attacks were correctly refused, including a write to an SSH
authorized-keys file via the editor tool rather than the shell, a delete whose
target was hidden in an environment variable, and a `>` truncation of a key
file. So the guard was not weak. It was **specifically blind to synonyms of
things it already knew were dangerous**, which is a much more embarrassing kind
of blind.

Thirty-four fixtures hid two holes in the morning. Fifty-one hid two more by
evening. The conclusion I have landed on is not "write more fixtures". It is
that fixtures prove the cases you thought of, and **adversarial probing is a
different activity from testing**. One confirms your model of the artefact; the
other attacks the model itself. A suite at 100% tells you nothing about the
inputs you never imagined, and a green suite actively discourages you from
imagining them.

Which is the study's finding again, one level up: the polish that stops you
checking does not have to be the artefact's. It can be the test suite's.

The same shape turned up repeatedly that evening, outside the guard entirely. A
scheduled job reported status `done`, with a real session id and a timestamp,
while its own report said the model identifier was invalid and it had consumed
zero tokens. The CLI's listing command reported "no schedules found" the entire
time a job was firing every two minutes. And the audit log I had chosen as the
guard's liveness signal turned out never to be written by the fast path, so a
healthy quiet session and a dead guard looked identical.

Five plausible surfaces over empty interiors, in one day. If you take one thing
from this post: **`done` is not a synonym for "worked"**. Verify the side
effect, never the status.

## Where Self-Learning Actually Breaks

The [second post in this series](/posts/teaching-cline-to-learn-from-my-corrections/)
described my self-learning loop. When I correct the agent on something its rules
were supposed to govern, it proposes the durable edit itself, I approve, and the
behaviour becomes permanent and inspectable. No fine-tuning, no black box, just
a diff I can read.

That loop works. Two months on, the corpus is a few dozen dated lessons:
API traps that cost me an afternoon, an incident where a redaction commit
message named the exact values it was redacting, a routing rule for where tasks
get filed.

It also has a delivery problem I had not admitted to myself. Every lesson lands
in the always-on rules tier, because that is the only tier guaranteed to be in
context. So a file that began as a short reference grew into a four-hundred-line
operational manual, and the tier as a whole now sits at **195% of the hard
budget I set for it myself**. My own linter fails on it. It also grew forty
lines *during* the session where I was designing the fix, from a sync I did not
initiate, which tells you the drift is active rather than historical.

A lesson therefore has exactly two possible fates: earn a permanent slot every
future session pays for, or live in prose nothing acts on. That binary is why
"just write down what you learn" stops scaling after a couple of dozen lessons.

The timing is wrong too. Most of those lessons matter at exactly one moment. A
note about an API's silent pagination cap is useless in a system prompt and
invaluable in the two seconds before the agent makes that call.

That delivery problem is the subject of the companion post. The rest of this one is the
other half: the mechanisms that make checking happen when nobody remembers to.

## Four Levers Instead of One

The structural problem: my steering system had exactly one lever. Write it in
the always-on file. Everything I learned in a year went through that single
mechanism, which is why it broke.

There are several other points in an agent's lifecycle where you can intervene,
and most cost nothing when they are not in use.

- **Before every turn.** The always-on rules. What I have now. Permanent cost,
  paid on every request whether relevant or not.
- **When the agent wants a tool.** A lifecycle hook receives the full tool call
  as JSON on stdin and can allow it, block it, or inject context the model then
  sees. Where a dangerous-action guard belongs, and the ideal place to deliver
  a just-in-time lesson: the agent is about to call the API with the pagination
  trap, so say so *now*.
- **When a task needs a procedure.** A skill: a file whose one-line description
  is always visible for roughly a hundred tokens, whose body loads only when
  the task matches. The tier I was missing. Procedural knowledge that
  advertises itself cheaply, with the payload attached.
- **When a task needs different thinking.** A sub-agent with its own context
  window, system prompt, and model.
- **When a task ends.** A hook that captures what happened, so the learning
  loop does not depend on me noticing in the moment.

Four of those five cost nothing when idle. That is the point, more than any
individual feature.


## Mixture-of-Experts, Without the Marketing

"Mixture-of-experts" usually describes a model architecture. I mean something
plainer: routing each piece of work to the model actually suited to it, which
in an agent framework means per-role model selection. Mine ships four presets:
a fast cheap model for reconnaissance, a heavyweight reasoner for planning, a
heavyweight for implementation, and a fourth intended for adversarial review.

Two distinct wins live in there, and they get conflated constantly.

The first is **context isolation**. A sub-agent that reads fifty files to
answer one question returns a paragraph, and those fifty reads never touch my
context window. Given that iteration is the strongest correlate of fluency and
iteration burns context, protecting the main window is protecting my ability to
keep refining. Cheap search models earn their place here, not because search is
unimportant but because it is voluminous.

The second is **independent judgment**, and it is the part I care about most.

## The Adversarial Reviewer Is Not the Author

The review preset is deliberately separate from the implementer. A model
reviewing its own output shares its own blind spots. Ask a model to check its
work and you often get a confident endorsement, because the weights that
produced the error see nothing wrong with it. That is the machine version of
the -3.1pp drop in questioning reasoning: the reviewer is too close to the
work.

Ideally that separation is a different model family, trained on different
data with different failure modes. More on how well that worked in a moment.

The prompt matters as much as the model. My reviewer persona is told
explicitly that its job is to stress-test, not to approve: find logic errors,
challenge whether the abstraction is right, identify untested scenarios, flag
anything touching auth or external input, severity-rank every finding, and skip
praise unless something is genuinely non-obvious. An agent asked "does this
look good?" will tell you it looks good.

What I am adding is a trigger set, because adversarial review of everything
trains you to ignore it. The narrow list:

- Any change bound for a public repository, because I have leaked to one
  before and the redaction rules were loaded in context at the time.
- Any new guard or hook, because a buggy guard has blast radius over
  everything else.
- Any config change touching more than one machine.
- Any multi-file plan, since challenging a plan is cheap and unpicking a
  finished implementation is not.

Deliberately excluded: routine single-file edits, doc updates, ticket closes.
If review is not scarce, it is noise.

Two limitations worth stating plainly, because I nearly documented the opposite
of both.

**The tool restrictions are not enforced.** My persona definitions specify which
tools each role should have, and I had written that up as though it were a
sandbox. The format has no field for it, so a reviewer told "you may never
write" can still reach for an editor. That is guidance, and I have corrected my
own docs to say so. Real enforcement has to come from the hook layer, which is
the one place that can actually refuse a call.

**The independence is not achieved either.** The whole argument rests on the
reviewer running a different model family from the author. When I first spawned
it, it failed with an authorisation error: the persona had inherited a model
from a bundled preset that this machine does not authenticate. The failure
happens at **spawn time**, not when the file is written, so it looked perfectly
installed right up to the moment it was needed. My second attempt pointed at a
provider that *was* configured, and that failed too, for a missing service key.

So on this box exactly one provider works, which means my adversarial reviewers
currently run the same family as the implementer. I could have quietly dropped
the claim; instead both prompts now carry a dated note saying so, and telling
the reviewer to compensate by leaning on the mechanical half of its job: run the
artefact, craft inputs that break it, trust observed behaviour over its own
reading of the code.

Mechanical verification does not need model diversity. Judgment does. Knowing
which half you are getting is worth more than the tidier story.

## Discernment as a Checklist, Not a Disposition

The most actionable thing to come out of the Fluency Index, for me, is that
discernment cannot be a character trait. Evaluation drops precisely when work
looks most finished, which is precisely when you are least likely to remember to
evaluate. Any fix that depends on remembering fails at the moment it is needed.

So it becomes a skill file, triggered whenever a session produces a script, a
config, or a scheduled job, carrying the three questions the report names, is it
accurate, is anything missing, does the reasoning hold up, plus my own dated
burns. For anything on the trigger list above, it hands the artefact to the
adversarial reviewer.

That is the mechanism that should have caught all four of my guard bugs without
depending on me having a good day.

## Honest Caveats

**Anthropic's own.** One week, one platform, eleven of twenty-four behaviours,
and correlation rather than causation. The thirteen unmeasured behaviours are
largely the Diligence ones, which they describe as arguably the most
consequential, so the Index measures the observable part rather than the
important part. The causal direction is also unresolved: do people who iterate
become more critical, or do critical people iterate more? If the latter, "have
longer conversations" is a symptom rather than a lever, so I have targeted the
specific behaviours instead, which are actionable either way.

**None of these mechanisms are documented APIs.** The hook system I am building
on has an effectively empty documentation page that redirects to a page
describing a different system, one which does not fire. Everything I know came
from reading shipped type definitions and probing my own install. A version bump
could rename an event and the failure would be *silent*: a hook that no longer
fires looks exactly like a hook with nothing to say. A post-upgrade smoke test
is part of the design for that reason.

## Takeaway

The Fluency Index measures humans in conversations. The uncomfortable extension
is that an agent running at three in the morning has a discernment score of
exactly zero, by construction. It cannot pause on a polished output, because
nobody is looking at it.

So every check a careful human would perform has to be built in, or it does not
happen. Two mechanisms carry that, and both are in this post:

1. **A hook that can say no.** Prose in a system prompt is a suggestion to a
   probabilistic system. A hook is an `if` statement. My dangerous-action
   policy was beautifully specified and enforced by nothing at all until I made
   it executable.
2. **A reviewer that is not the author.** Prompted to stress-test rather than
   approve, on a deliberately narrow trigger list. Ideally a different model
   family, which I have not managed yet and have documented as an outstanding
   gap rather than a solved problem.

Four gaps in my own tooling, in one day, across two test suites that were both
at 100%. The lesson is not that I should try harder. It
is that trying harder does not scale, and that a green test suite is a
comfortable place to stop looking.

[Lessons That Arrive On Time](/posts/lessons-that-arrive-on-time/) covers what
I built to fix the delivery problem: a scored lessons
corpus that injects a warning two seconds before the mistake, what six phases
of this actually cost in tokens and dollars, and the first scheduled job that
earned its keep.

---
