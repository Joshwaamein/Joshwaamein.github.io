---
title: "Tuning Open WebUI + AWS Bedrock for Complex AI Workflows — Timeouts, Code Execution, and Custom Patches"
description: "How I diagnosed and fixed timeout failures, slow code execution, and WebSocket drops in my self-hosted Open WebUI + AWS Bedrock setup — including custom patches, a Jupyter code execution server, and the trade-offs of maintaining upstream forks."
date: 2026-03-28
categories: [Cloud, DevOps]
tags: [docker, aws, bedrock, openwebui, python, jupyter]
---

My self-hosted AI setup runs [Open WebUI](https://github.com/open-webui/open-webui) backed by AWS Bedrock via a custom gateway. Simple queries work fine. But complex workflows — sub-agents making dozens of tool calls, web searches, and code execution — kept timing out, dropping connections, or just hanging indefinitely.

This post covers the full diagnosis and every customisation I've made, including the trade-offs and drawbacks of each one.

---

## 🏗️ The Architecture

```
Browser → Open WebUI (Docker)
              ↓
         Bedrock Gateway (Docker, internal network)
              ↓
         AWS Bedrock API (eu-west-2)
              ↓
         SearXNG (web search) / Tika (document parsing) / Jupyter (code execution)
```

Six Docker containers on a shared bridge network, all communicating internally. Open WebUI is the only container with an exposed port. The Bedrock gateway translates OpenAI-compatible API calls into AWS Bedrock's ConverseStream format, with cross-region inference enabled so models appear with `global.*` prefixes and route automatically.

---

## 🐛 The Problem

Complex queries with sub-agents or code execution would fail in three ways:

1. **WebSocket drops** — the browser connection would silently die mid-response
2. **Code execution hangs** — Python code blocks would take 30+ seconds or never return
3. **Bedrock validation errors** — tool-use conversations would hit `400 Bad Request` after many iterations

Simple one-shot queries worked perfectly. The failures only surfaced during multi-turn, tool-heavy workflows.

---

## 🔍 The Investigation

### WebSocket Keepalive Failures

The Open WebUI logs showed repeated errors:

```
keepalive ping failed
AssertionError
  File "websockets/legacy/protocol.py", line 308, in _drain_helper
    assert waiter is None or waiter.cancelled()
```

This is a [known bug in websockets v16.0](https://github.com/python-websockets/websockets/issues) — the library's legacy protocol throws an `AssertionError` when trying to send a ping to a connection that's mid-drain. During complex queries, the server is busy processing tool calls and can't respond to WebSocket pings in time.

The default `WEBSOCKET_SERVER_PING_TIMEOUT` is **20 seconds**. A single sub-agent iteration with web search, code execution, and LLM response easily exceeds that.

### Code Execution Round-Trip

Open WebUI's default code execution engine is **Pyodide** — a WebAssembly Python runtime that runs *in the browser*. The execution path for every code block is:

```
Server → WebSocket event → Browser → Pyodide WASM → Browser → WebSocket → Server → Bedrock API
```

Every code block makes a full round-trip through the browser's WebSocket connection. On a multi-step sub-agent workflow running 3-5 code blocks, this adds 30-60 seconds of pure overhead — and if the WebSocket drops mid-execution, the entire workflow fails silently.

### Bedrock Validation Errors

Two specific errors appeared in the gateway logs during long conversations:

```
ValidationException: The toolConfig field must be defined when using
toolUse and toolResult content blocks.
```

```
ValidationException: prompt is too long: 2,084,831 tokens > 1,000,000 maximum
```

The first indicates tool configuration wasn't being forwarded properly on follow-up turns. The second shows conversation history accumulating past Bedrock's 1M token context window — a natural consequence of sub-agents that generate hundreds of tool call results.

### API Latency

The Bedrock gateway was configured to use `us-east-1` (Virginia). Every API call — and there are dozens per sub-agent workflow — was crossing the Atlantic and back. With the server physically located in the UK, this added 100-200ms per request, compounding across multi-turn conversations.

---

## 🛠️ The Fixes

### Fix 1: Increase WebSocket and HTTP Timeouts

Three environment variables on the Open WebUI container:

```bash
-e WEBSOCKET_SERVER_PING_TIMEOUT=120    # Was 20s — prevents keepalive failures
-e WEBSOCKET_EVENT_CALLER_TIMEOUT=600   # Was 300s — allows longer tool chains
-e AIOHTTP_CLIENT_TIMEOUT=600           # Was 300s — prevents HTTP client timeouts
```

**Why:** The defaults assume short request-response cycles. Sub-agent workflows with tool calls, web searches, and code execution routinely exceed 5 minutes end-to-end.

**Drawback:** Higher timeouts mean genuinely broken connections take longer to detect. A hung request will now sit for 10 minutes before timing out, consuming a server thread the entire time. On a resource-constrained system, this could become a problem under concurrent usage.

### Fix 2: Server-Side Code Execution with Jupyter

Replaced the browser-side Pyodide engine with a server-side Jupyter notebook container:

```yaml
services:
  jupyter:
    image: jupyter/scipy-notebook:latest
    container_name: jupyter
    restart: always
    environment:
      - JUPYTER_TOKEN=<token>
    command: start-notebook.py --NotebookApp.allow_origin='*' --NotebookApp.ip='0.0.0.0'
    networks:
      - ai-services
```

Open WebUI configured with:

```bash
-e CODE_EXECUTION_ENGINE=jupyter
-e CODE_INTERPRETER_ENGINE=jupyter
-e CODE_EXECUTION_JUPYTER_URL=http://jupyter:8888
-e CODE_INTERPRETER_JUPYTER_URL=http://jupyter:8888
-e CODE_EXECUTION_JUPYTER_AUTH=token
-e CODE_INTERPRETER_JUPYTER_AUTH=token
-e CODE_EXECUTION_JUPYTER_AUTH_TOKEN=<token>
-e CODE_INTERPRETER_JUPYTER_AUTH_TOKEN=<token>
-e CODE_EXECUTION_JUPYTER_TIMEOUT=60
-e CODE_INTERPRETER_JUPYTER_TIMEOUT=60
```

The execution path is now:

```
Server → Jupyter HTTP API → Server
```

No browser round-trip, no WebSocket dependency, and `scipy-notebook` ships with NumPy, pandas, matplotlib, and SciPy pre-installed.

**Why:** Eliminates the browser round-trip entirely. Code execution drops from 10-30 seconds to 1-3 seconds. The Jupyter kernel persists state across code blocks within a session, so variables and imports carry over.

**Drawback:** The `jupyter/scipy-notebook` image is ~1.5GB and uses significant RAM. On a memory-constrained system, this adds pressure. The Jupyter server also has full access to the Docker network — any code the LLM generates runs server-side with the same network access as every other container. This is a real security consideration for multi-user deployments.

### Fix 3: Move Bedrock to eu-west-2 (London)

Changed the gateway's AWS region from `us-east-1` to `eu-west-2`:

```yaml
environment:
  - AWS_REGION=eu-west-2
```

With cross-region inference enabled, `global.*` model prefixes automatically route to the nearest available capacity.

**Why:** Reduces API latency by ~100-200ms per request. Over a 20-turn sub-agent workflow, that's 2-4 seconds saved — and more importantly, fewer timeout-inducing delays.

**Drawback:** If a specific model isn't available in `eu-west-2`, the cross-region routing adds its own overhead. Model availability can vary by region, though with `global.*` prefixes this is mostly transparent.

---

## 🔬 Custom Code Patches

I maintain three patched files that are bind-mounted into the containers, overriding upstream code. Each one exists to solve a specific problem, but they all come with maintenance costs.

### Patch 1: Empty Model Cache Guard (`models.py`)

**The problem:** When the Bedrock gateway is temporarily unreachable, Open WebUI's model list refresh returns empty. The upstream code caches this empty result, causing every subsequent request to fail with "Model not found" until the next successful refresh. During sub-agent workflows where the model list is re-checked between tool calls, this creates a cascade of failures.

**The fix:**

```python
# Only update the cache if we got a non-empty model list
if models_dict:
    if isinstance(request.app.state.MODELS, RedisDict):
        request.app.state.MODELS.set(models_dict)
    else:
        request.app.state.MODELS = models_dict
else:
    log.warning('get_all_models() returned empty model list, keeping previous cache')
```

Same pattern applied to `BASE_MODELS`.

**Drawback:** If a model is genuinely removed from Bedrock, the stale cache will continue serving it until a successful refresh eventually returns the updated list. This could cause confusing errors if a user selects a model that exists in cache but no longer exists upstream.

### Patch 2: Default Feature Flags (`middleware.py`)

**The problem:** Open WebUI requires users to manually enable web search and memory recall per-chat. For a single-user setup where you always want these features, this is friction.

**The fix:**

```python
features = form_data.pop('features', None) or {}
features.setdefault('web_search', True)
features.setdefault('memory', True)
```

**Drawback:** Every single chat now triggers a web search — even for simple "hello" messages. This adds 2-5 seconds of latency to every response, increases API costs (SearXNG queries + RAG processing), and occasionally returns irrelevant search results that confuse the model. Memory retrieval runs on every message too, adding its own overhead.

### Patch 3: Default max_tokens (`middleware.py`)

**The problem:** Without an explicit `max_tokens`, some Bedrock models default to very low token limits, causing truncated responses. This is particularly harmful for tool-use scenarios where the model needs to output complete JSON for function call arguments.

**The fix:**

```python
if 'max_tokens' not in form_data:
    form_data['max_tokens'] = 16384
```

**Drawback:** Higher token limits increase API costs per request. A 16K token limit means every single request — including short yes/no answers — is budgeted for 16K tokens of output. The cost impact is real but manageable for single-user usage.

### Patch 4: Bedrock Gateway Model Caching (`model_patched.py`)

**The problem:** The upstream Bedrock gateway calls AWS's `ListFoundationModels` and `ListInferenceProfiles` APIs on every single `/models` request. These are synchronous boto3 calls that block the async event loop and take 1-3 seconds each.

**The fix:**

```python
_cached_models = None
_cache_timestamp = 0
_CACHE_TTL = 300  # 5 minutes

def _get_models_cached():
    global _cached_models, _cache_timestamp
    now = time.time()
    if _cached_models is not None and (now - _cache_timestamp) < _CACHE_TTL:
        return _cached_models
    try:
        models = chat_model.list_models()
        _cached_models = models
        _cache_timestamp = now
        return models
    except Exception:
        if _cached_models is not None:
            return _cached_models  # Stale cache on error
        raise
```

Also wrapped in `run_in_threadpool` to prevent event loop blocking.

**Drawback:** New models deployed to Bedrock won't appear for up to 5 minutes. There's no cache invalidation mechanism — the only way to force a refresh is to restart the gateway container. The global mutable state could theoretically have race conditions under high concurrency.

---

## ⚠️ The Cost of Custom Patches

All four patches are applied via Docker bind mounts — the patched files are stored on the host and mounted over the container's originals at startup. This means:

1. **Watchtower updates don't break the patches** — the bind mounts persist across image updates
2. **But upstream API changes can break everything** — if an Open WebUI update changes internal function signatures that the patches depend on, the container will crash on startup
3. **Version drift accumulates** — the longer you maintain patches, the harder it becomes to merge upstream improvements

I originally maintained a fully pinned `middleware.py` (all 4,887 lines), but the drift became unsustainable. The pinned version was missing over a dozen upstream fixes including `strip_empty_content_blocks()` (which prevents Claude/Gemini errors), `merge_system_messages()` (which prevents template parsing failures), and proper `done: True` completion markers.

The current approach is better: **start from the latest upstream, apply minimal targeted patches.** The four patches above total ~20 lines of actual changes. When upstream updates, re-extracting the base files and re-applying the patches takes minutes, not hours.

---

## 📊 Results

| Metric | Before | After |
|--------|--------|-------|
| Sub-agent success rate | ~60% (intermittent drops) | ~100% |
| Code execution time | 10-30s per block (Pyodide) | 1-3s per block (Jupyter) |
| WebSocket "keepalive ping failed" | Every few minutes | Rare (idle connections only) |
| Bedrock API latency | ~200ms (us-east-1) | ~50ms (eu-west-2) |
| Custom patch maintenance | 4,887-line pinned file | ~20 lines across 3 files |

---

## 💡 Lessons Learned

### 1. Pyodide Is the Wrong Tool for Server-Side AI Workflows

Browser-based code execution makes sense for interactive notebooks. For autonomous AI agents running multi-step code workflows, the WebSocket round-trip is a dealbreaker. Jupyter is heavier but eliminates an entire class of failure modes.

### 2. Default Timeouts Assume Simple Conversations

Most AI UIs are designed for single-turn Q&A. When you add sub-agents, tool calls, web search, code execution, and RAG — all in a single conversation turn — the default 20-second WebSocket ping timeout is laughably short. Know your workload and set timeouts accordingly.

### 3. Maintain Patches, Not Forks

Pinning an entire 5,000-line file to avoid upstream breakage feels safe, but it's a trap. You lose every upstream bugfix and improvement. Minimal, targeted patches that can be re-applied to fresh upstream files are far more sustainable.

### 4. Every Customisation Has a Cost

Defaulting web search to "always on" sounds great until every trivial question adds 3 seconds of latency. Setting `max_tokens=16384` prevents truncation but increases API costs. Server-side Jupyter execution is fast but widens the attack surface. **Document the trade-offs, not just the benefits.**

### 5. Cache Defensively

Never replace good data with empty data. Whether it's model lists, DNS caches, or configuration stores — if the upstream source is temporarily unavailable, serving stale data is almost always better than serving nothing.
