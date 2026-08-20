---
title: "Relaxing an Over-Zealous AI Guard: A Silent Abort, a Three-Character Bypass, and an Empty Rule List"
description: "My Cline PreToolUse hook was ending whole conversations with no error message, because a tool_call hook that returns cancel aborts the entire agent run and discards the reason on the way, rather than denying the single call. Finding that led me to a three-character bypass in my own destructive-delete check, 52 of 90 fixtures asserting the wrong thing, a hook that had never run once, and the decision to clear both rule lists and start from zero."
date: 2026-08-20 14:45:00 +0100
categories: [AI, DevOps]
tags: [cline, claude, llm, agents, hooks, guardrails, testing, automation]
---

The hook was written by an AI, to my brief, and so were its 90 fixtures. Three days after installing it my sessions started ending mid-answer: no error, no partial output, no message of any kind. I knew where it was coming from, because the timing matched the guard going in and nothing else had changed. What I did not know was why a refused command took the whole conversation with it instead of coming back as a refusal I could read.

This post is what was underneath that: the mechanism bug that made every false positive fatal, a bypass in my own pattern list that showed up while I was writing regression tests for the annoying bug, and the conclusion I reached after three rounds of fixes, which was to delete every rule I had written.

## The Guard Architecture

Two stages. A bash prefilter (`PreToolUse`) runs on every tool call at about 6ms and scans the raw JSON payload for keywords that might be dangerous. Most calls pass instantly, with no Python involved.

When a keyword matches, a Python decider (`red-action-guard.py`) does a real JSON parse and matches against compiled patterns: destructive commands, sensitive paths, fleet mutations. Measured on this machine today, that second stage costs 27ms per call, or 22ms with `python3 -S`. If it finds a match, it returns a block decision on stdout and Cline is supposed to refuse the call.

The split is a performance optimisation and not a security boundary, which is written in the prefilter's own header comment. The structure held up. What went inside it, and what it assumed about the hook contract, did not.

## The Trail: Three Logs, One Timestamp

The join is the useful part here, more than any single fix. Three files, keyed on time:

| File | What it gives you |
|---|---|
| `~/.cline/logs/red-action-guard.log` | my own audit line for every allow and block |
| `~/.cline/data/logs/hooks.jsonl` | `tool_call`, `agent_abort`, `session_shutdown` events |
| `~/.cline/data/logs/cline.log` | agent errors, hook failures, tokens and cost per turn |

Every block in the first file lines up with a dead session in the other two, inside 300ms. In three days: 51 real blocks and 14 `agent_abort` events. Four of the last five real blocks were false positives, and three of those were the same command retried three times at 23:10, 23:12 and 23:14, each attempt killing a fresh conversation. A fourth attempt at 23:32 died the same way while I was writing my notes.

The line that gave the game away came from `cline.log`:

```json
{"time":"2026-08-19T00:14:11.492Z","msg":"Agent loop caught error",
 "err":{"type":null,"message":null}}
```

An aborted run with a null error type and a null message. Not a crash. Something calling stop with no reason attached.

## What `cancel` Actually Does

My guard returned this on a block, which is what the hook documentation implies:

```json
{"cancel": true, "errorMessage": "RED action blocked: destructive delete. Target: ..."}
```

Here is what Cline 3.0.55 does with it. This is the bridge for hooks discovered as files under `~/Documents/Cline/Hooks`, pulled out of the compiled binary:

```js
if ((i.tool_call?.length ?? 0) > 0)
  m.beforeTool = async (s) => { let l = await o(ate(s)); return JAe(l) };

function JAe(e) {
  if (!e) return;
  let i = {};
  if (e.cancel === true) i.stop = true;
  if (e.overrideInput !== undefined) i.input = e.overrideInput;
  return Object.keys(i).length > 0 ? i : undefined;
}
```

Two keys survive. `cancel` becomes `stop`, `overrideInput` becomes `input`, and everything else, including my carefully written `errorMessage`, is dropped on the floor. Then the agent loop:

```js
applyStopControl(e) {
  if (!e?.stop) return;
  if (e.reason) this.state.lastError = e.reason;
  throw new Wy(e.reason);
}
```

`stop` aborts the whole run, not the single tool call. And because the bridge never sets `reason`, it throws an error whose message is undefined. That is the null-message abort in the log, and that is why the session just stopped with nothing printed. The guard was doing its job perfectly and reporting it to nobody.

The bitter part: the runtime has exactly the primitive I wanted. Further down the same loop there is `skip` with a `reason`, which denies one call, hands the reason back as the tool result and lets the run continue. Cline's own plan-mode command guard uses it. No JSON key from an out-of-process hook reaches it. From a hook script in 3.0.55 you get three levers:

| Return | Effect |
|---|---|
| `cancel: true` | aborts the entire run, with no message |
| `overrideInput: {...}` | replaces the tool input, run continues |
| `errorMessage` / `contextModification` | silently discarded for `tool_call` |

I had shipped the first one and assumed it meant the second.

## Keeping the Conversation Alive

Since `overrideInput` is the only lever that keeps a run alive, a block now rewrites the call into a refusal instead of cancelling it:

```python
REFUSAL_REWRITES = {
    "run_commands": lambda reason: {
        "commands": ["printf '%s\\n' " + shlex.quote(reason) + "; exit 1"]
    },
    "start_background_command": lambda reason: {
        "command": "printf '%s\\n' " + shlex.quote(reason) + "; exit 1",
        "notifyParent": False,
    },
}
```

The refused command becomes a `printf` of the reason with a non-zero exit. The model sees a failed tool call with the explanation in the output, tells me what was refused, and carries on with whatever does not depend on it. Tools with no safe rewrite, `editor` for example, still fall back to `cancel`, which is a sharp edge I have documented rather than solved.

One detail worth knowing if you try this: input schema coercion happens before the hook runs, so an `overrideInput` is never validated against the tool's schema. Whatever shape you hand back goes straight to the tool. My fixtures now assert that a rewrite's keys match the real input keys, because a typo there would be a very confusing bug.

## Three Rounds of False Positives

With the mechanism understood, the false positives went from mysterious to embarrassing.

**Round one, word boundaries.** A read-only fleet audit, killed:

```
BLOCK why='host reboot' target='echo "=== REBOOT REQUIRED ==="; ls -l /var/run/reboot-required'
```

The pattern was fine. The word `REBOOT` appeared inside an `echo` label, and my matcher is case-insensitive across the whole payload. An `echo` cannot restart a machine. Cleaning `__pycache__` was blocked the same day.

**Round two, container commands.** This one killed three conversations in five minutes while I was trying to start a Jekyll preview:

```
BLOCK why='destructive delete (rm -rf)' target='docker rm -f blog-preview; docker run -d ...'
```

`\brm\s+(-\w*\s+)*-\w*[rf]` matches the `rm -f` inside `docker rm -f`. Also `docker rmi -f`, `podman rm -f`, `crictl rm -f`. None of those touch a file.

**Round three, content scanning.** The guard walked every string in a tool call's input, including the content being written by the editor tool. So writing documentation that mentioned `find -delete` was treated as running it. The best example is the one that blocked a docstring reading "only a real poweroff or shutdown should block", which was me documenting the fix for round one. The guard blocked the commit that explained the guard.

My first fix was a prose heuristic: if the text reads like English, allow it. That fails exactly where the writing is most technical, because my heuristic disqualified anything containing a path. The real fix is to stop pretending every string is a command. `new_text` is data. It gets checked against path rules, never against command patterns.

I also added an attended mode, `CLINE_HOOK_GUARD=attended`, where only one-way-door mutations block, and wrote 21 fixtures for it. The suite reached 90 tests, all green.

Then another session halted anyway, on a payload the attended relaxation was supposed to allow.

## The Bypass I Found While Writing Tests

While writing regression cases for the false positives, I ran this against the guard that was live at the time:

```
rm -rf ~/Documents                        -> BLOCK   (correct)
rm -rf /tmp/scratch; rm -rf ~/Documents   -> ALLOW   (!!)
rm -rf ~/.cache/x && rm -rf ~/projects    -> ALLOW   (!!)
rm -rf __pycache__; rm -rf ~/projects/x   -> ALLOW   (!!)
```

My safe-target check searched the string once, took the first match, and if that first target was safe it returned early and skipped every pattern check for the whole payload. Prefixing anything with a throwaway `rm -rf /tmp/x;` walked straight through the guard. Three characters and a semicolon.

Worse, this is the second time I made that mistake. On 08-17 an adversarial pass found that mentioning `/tmp` anywhere whitelisted a real target beside it, and I fixed it by evaluating each target separately. I fixed the instance. The class of bug, "checking one occurrence and generalising to the whole string", moved up a level and survived. The fix now walks every shell segment and requires all of them to be safe:

```python
def is_fully_safe_destructive(text):
    segments = destructive_segments(text)      # every segment, not the first
    if not segments:
        return False
    for _segment, match in segments:
        targets = segment_targets(match)
        if not targets or not all(SAFE_TARGET_RE.match(t) for t in targets):
            return False
    return True
```

So: a green 90-test suite, a bypass that takes three characters and a semicolon, and four false positives that had been ending sessions for three days. That is the point at which the question below is worth asking.

## The Question That Cleared Both Lists

Which of these rules has ever prevented actual damage?

None of them. Not one entry in either list was there because something had gone wrong. Every one was there because a dangerous-looking command was imagined, by me in the brief or by the model writing the patterns, and written down. Measured over three days: zero incidents prevented, 51 blocks, 14 aborted runs, and a bypass that made the protection theatre anyway.

So both lists are now empty:

```python
RED_PATTERNS = [
    # Empty as of 2026-08-20. Add rules back one at a time as real incidents
    # justify them. Each new entry needs a fixture in test-guard-fixtures.py.
]

RED_PATHS = [
    # Empty as of 2026-08-20. Add rules back one at a time as real incidents
    # justify them. Each new entry needs a fixture in test-guard-fixtures.py.
]
```

Everything else stays: the prefilter, the decider, the neutraliser that stops `echo` labels and container commands matching, the per-occurrence target check, the refusal rewrite, the fixture suite. The machinery that can block is intact and tested. It currently blocks nothing.

When something actually goes wrong, that exact pattern goes back in, with a fixture that tests both sides and a dated comment naming the incident that justified it. One rule at a time, each one earned.

The escape hatch matters here too. The only override the guard has is `CLINE_HOOK_GUARD=off`, which switches off every rule at once. A list that produces false positives pushes you towards that switch, and the switch is all or nothing, so a single annoying pattern can end up disabling the entire guard for a session. Per-call refusals that the agent can report are worth more than a global off.

## My Tests Were Asserting the Wrong Thing

When I switched blocks from `cancel` to `overrideInput`, 52 of my 90 fixtures failed. The guard was strictly better than it had been ten minutes earlier.

They failed because of this:

```python
return bool(out.get("cancel")), out
```

The suite defined "blocked" as "the guard emitted `cancel`". It never asked whether the call was actually refused. The moment refusing stopped being spelled `cancel`, the tests reported disaster while the product improved. One line fixed all 52:

```python
blocked = bool(out.get("cancel")) or "overrideInput" in out
```

A green suite told me nothing on the day it mattered, twice: once here, and once by sitting at 100% over a live bypass. I wrote about that pattern in [When the Output Looks Right](/posts/when-the-output-looks-right/), then walked into it again in my own test file. Two new fixture classes came out of it:

- **Shape fixtures.** A block on a command tool must arrive as `overrideInput`, must not contain `cancel`, must carry the reason inside the rewritten command, and its keys must match the tool's real input keys. Without these, the fix could silently regress to killing sessions and every other test would still pass.
- **Shebang fixtures.** For every hook Cline launches directly: the first line must resolve, through the same `env`-stripping rule Cline uses, to one of `bash`, `sh`, `zsh`, `python` or `python3`.

That second one exists because of the next bug.

## The Hook That Never Ran Once

Every completed run in `cline.log` carried this line:

```
hook command failed: -S python3 -S ~/Documents/Cline/Hooks/TaskComplete:
Executable not found in $PATH: "-S"
```

My hook started with `#!/usr/bin/env -S python3 -S`, to skip `site` and save interpreter startup. The kernel understands that. Cline parses shebangs itself: it drops a leading `env`, then expects the interpreter, so the "interpreter" became `-S`. ENOENT, every time, for three days. My lesson-capture hook had never executed once since I installed it.

The guard has the same shebang and works fine, because the prefilter invokes it through the kernel rather than through Cline. That is why the failure only showed up on the one hook I never tested by hand. Both are now plain `#!/usr/bin/env python3`, and dropping `-S` costs 5ms on the slow path, which is a fine price for a hook that runs.

## The Lessons That Never Arrived

This one requires a correction to a post I published earlier today.

The guard's other job is retrieval. On an allow, it queries my lessons corpus, a SQLite database of dated corrections scored by severity and burn count, and returns the relevant one as `contextModification`. The audit line shows it working:

```
ALLOW tool=run_commands subagent=False strings=2 lessons=1
```

In [Lessons That Arrive On Time](/posts/lessons-that-arrive-on-time/) I described that as the warning arriving two seconds before the mistake, injected into the agent's context at the moment a matching tool call fires. Look again at `JAe` above. For a `tool_call` hook, `context` and `contextModification` are parsed, merged across hook commands, and then dropped along with `errorMessage`. The retrieval layer has been computing the right lesson, at the right moment, for the right command, and handing it to nothing.

`tool_call` is also the only hook event with a return channel at all. Every other event, `agent_start`, `prompt_submit`, `tool_result`, `agent_end`, `agent_abort` and `session_shutdown`, is dispatched detached and its output ignored. There is no second door.

So the honest status: retrieval works, scoring works, the corpus is good, delivery does not happen on Cline 3.0.55. The one route that would work is the same lever as the refusal, prepending the lesson to the command through `overrideInput` so it lands in the tool output the model reads. I have not done it yet, because it mutates every allowed command and I want to decide whether that noise is worth it for anything below blocking severity. The `lessons=1` in my audit log proved retrieval ran. I read it as proof of delivery, which it never was.

One useful correction in the other direction: `prompt_submit` does fire on this build, contrary to my earlier probe notes. It cannot inject anything, but it can record what I actually asked for, which is the signal I had assumed no hook could see.

## One File, Two Sessions

A smaller trap worth naming. The guard file was open in two agent sessions at once. One was relaxing the content-scanning rule while the other was editing the same file, and the fix got overwritten by the session that had loaded the file before the change. A false positive that was already fixed came back and ended another conversation.

Two agents editing one file is a race with no warning and no merge conflict to notice.

## What I Learned

1. **A guard's failure mode matters more than its rules.** Mine failed by ending the conversation with an empty error, which is the most expensive way to be wrong. Before writing any hook, find out exactly what the runtime does with each control value, and test the failure path, not the happy path.

2. **Silence is the worst failure mode.** It cost me three days because there was nothing to search for. If a control channel drops your message, make your own: log it, and make the log the first thing you check.

3. **A blocklist populated from imagination produces a guard that fights you.** Every rule should be earned by an incident. This one was written from a threat model, by an agent, on my instructions, and neither of us checked which entries corresponded to anything that had happened.

4. **An all-or-nothing override is a design flaw.** `CLINE_HOOK_GUARD=off` is the only escape hatch, so any false positive puts you one keystroke from having no guard at all. A refusal the agent can report back is worth more than a switch that turns everything off.

5. **Fixing an instance is not fixing a class.** The 08-17 fix covered "safe path beside a real target". Three days later the same shape reappeared as "safe target before a real target" and went unnoticed. When a bug turns up, ask what shape it is, then look for that shape one level up.

6. **Assert on outcomes, not mechanisms.** 52 of 90 tests failed on a change that made the product better, because they tested how a refusal was spelled rather than whether the call was refused.

7. **Classify by what has actually happened.** `rm -rf node_modules` looks alarming to a regex and has never cost me anything. `tailscale set --advertise-routes` looks harmless and can reroute traffic across the whole tailnet. Until either actually does damage, neither earns a rule.

The guard source, the fixture suite and the autonomy rules live in my Cline config, which I described in [How I Steer Cline With a Tiered Rules System](/posts/how-i-steer-cline-with-a-tiered-rules-system/). Both rule lists in it are empty as of today. The next entry will carry a date, the incident that justified it, and a test on both sides.
