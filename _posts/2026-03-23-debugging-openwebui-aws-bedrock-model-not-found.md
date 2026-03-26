---
layout: post
title: "Debugging OpenWebUI + AWS Bedrock: A Deep Dive into Model Not Found Failures"
date: 2026-03-23
categories: ["Cloud", "DevOps"]
tags: ["docker", "aws", "bedrock", "openwebui", "python", "debugging"]
description: "A deep dive into debugging intermittent 'Model not found' failures in Open WebUI with AWS Bedrock, uncovering cache invalidation bugs, event loop blocking, and blank message issues."
---

**Date:** March 22–23, 2026
**Status:** ✅ Resolved
**Stack:** Open WebUI (Docker) → Bedrock Access Gateway → AWS Bedrock (Claude Opus 4, Sonnet 4.6)

---

## 🐛 The Problem

Complex requests in Open WebUI kept failing with cryptic errors. The Sub Agent tool — used for autonomous, tool-heavy tasks — would run for several minutes and then crash with:

```text
Error in sub-agent completion: Model not found
POST /api/chat/completed HTTP/1.1 400
```

Simple queries worked fine. Only long-running, complex requests with the Sub Agent tool would fail, and the failures were intermittent — sometimes it worked, sometimes it didn't.

---

## 🔍 The Investigation

### Step 1: Check the Basics

SSH into `your-server` and check the container status:

```bash
docker ps --filter name=open-webui
# CONTAINER ID  IMAGE                                  STATUS
# b4f4f7f67778  ghcr.io/open-webui/open-webui:latest   Up 2 days (healthy)
```

Container was healthy. Time to check the logs.

### Step 2: Follow the Error Trail

```bash
docker logs open-webui --tail 200 2>&1 | grep -i 'error\|exception'
```

Two categories of errors jumped out:

1. **Constant Ollama connection errors** — `Cannot connect to host host.docker.internal:11434` — Ollama wasn't running (not needed, using Bedrock)
2. **The real culprit** — `tool_sub_agent:run_sub_agent_loop:425 - Error in sub-agent completion: Model not found`

The full traceback showed:

```python
File "/app/backend/open_webui/utils/chat.py", line 188, in generate_chat_completion
    raise Exception("Model not found")
```

The model being requested was `global.anthropic.claude-sonnet-4-20250514-v1:0` — a valid Bedrock model.

### Step 3: Understand the Architecture

```
Browser → Open WebUI (Docker, port 3000)
              ↓
         Bedrock Gateway (Docker, ai-services network)
              ↓
         AWS Bedrock API (us-east-1)
```

Open WebUI connects to a custom **Bedrock Access Gateway** that translates OpenAI-compatible API calls into AWS Bedrock ConverseStream calls. The gateway is configured as an "OpenAI API" endpoint in Open WebUI's settings.

### Step 4: Trace the Model Resolution

The `generate_chat_completion` function checks `request.app.state.MODELS` — an in-memory dictionary of available models. If the model ID isn't in this dict, it raises "Model not found".

```python
# /app/backend/open_webui/utils/chat.py, line 186-188
model_id = form_data["model"]
if model_id not in models:
    raise Exception("Model not found")
```

But the model existed in the Bedrock gateway! A direct curl confirmed it:

```bash
docker exec open-webui curl -s http://bedrock-gateway:8080/api/v1/models \
  -H 'Authorization: Bearer bedrock' | python3 -c '...'
# Models: 94 (including global.anthropic.claude-sonnet-4-20250514-v1:0)
```

So why wasn't it in `app.state.MODELS`?

---

## 🔬 Root Cause #1: The Model Cache Death Spiral

### The Cache TTL Problem

Open WebUI caches its model list with a configurable TTL:

```python
# /app/backend/open_webui/env.py
MODELS_CACHE_TTL = os.environ.get("MODELS_CACHE_TTL", "1")  # Default: 1 second!
```

**One second.** The model list cache expired almost immediately, forcing a refresh on nearly every request.

### The Connection Error

During long-running Sub Agent operations, the periodic model list refresh would sometimes fail:

```
open_webui.routers.openai:send_get_request:91 - Connection error:
```

The error message was **empty** — not a timeout, not a DNS failure, just... nothing. When `send_get_request` fails, it returns `None`:

```python
async def send_get_request(url, key=None, user=None):
    try:
        async with aiohttp.ClientSession(...) as session:
            async with session.get(url, ...) as response:
                return await response.json()
    except Exception as e:
        log.error(f"Connection error: {e}")
        return None  # ← Returns None on ANY failure
```

### The Empty Cache Catastrophe

When the model list request returns `None`, the merge function produces an empty model list. This empty list then **replaces** the entire `app.state.MODELS` cache:

```python
# /app/backend/open_webui/utils/models.py
models_dict = {model["id"]: model for model in models}  # Empty dict!
request.app.state.MODELS = models_dict  # Overwrites good data with nothing
```

**Timeline of a typical failure:**

1. `20:57:18` — Chat starts, Sub Agent begins running with Opus
2. `20:58:51` — `get_all_models()` triggered (cache expired)
3. `20:59:01` — Connection to Bedrock gateway fails → model list = `{}`
4. `21:05:36` — Sub Agent finishes, `chat_completed` called → "Model not found" (because `app.state.MODELS` is empty)

---

## 🔬 Root Cause #2: Bedrock Gateway Blocking the Event Loop

Why was the connection to the Bedrock gateway failing intermittently? The gateway was running on the same Docker network and was healthy.

The answer was in the gateway's model listing code:

```python
# /app/api/routers/model.py
@router.get("", response_model=Models)
async def list_models():
    model_list = [Model(id=model_id) for model_id in chat_model.list_models()]
    return Models(data=model_list)
```

`chat_model.list_models()` is a **synchronous** method called from an `async` endpoint:

```python
class BedrockModel:
    def list_models(self) -> list[str]:
        """Always refresh the latest model list"""
        global bedrock_model_list
        bedrock_model_list = list_bedrock_models()  # Sync AWS API calls!
        return list(bedrock_model_list.keys())
```

`list_bedrock_models()` makes multiple **synchronous** boto3 calls to AWS:
- `bedrock_client.get_paginator('list_inference_profiles')` — paginated, multiple pages
- `bedrock_client.list_foundation_models()` — another API call

These sync calls **block the single-threaded uvicorn event loop**. While the gateway was busy streaming long Opus responses AND trying to list models, the event loop would stall, causing Open WebUI's 10-second timeout to expire.

---

## 🔬 Root Cause #3: Blank Messages in Chat History

After fixing the model cache issues, a new error appeared:

```
ValidationException: The text field in the ContentBlock object at messages.42.content.0 is blank.
```

AWS Bedrock's ConverseStream API rejects messages with empty text content. The Sub Agent workflow was creating placeholder messages with blank content that never got filled in. These accumulated in the chat history and caused Bedrock to reject the entire conversation.

---

## 🛠️ The Fixes

### Fix 1: Disable Ollama (Quick Win)

Ollama wasn't being used but was generating constant connection error noise:

**Action:** Disabled Ollama API in Open WebUI admin settings.

### Fix 2: Increase Model Cache TTL

```bash
docker run ... -e MODELS_CACHE_TTL=60 ... ghcr.io/open-webui/open-webui:latest
```

Changed from 1 second to 60 seconds. This reduced the frequency of model list refreshes but initially made things **worse** — when a refresh failed, the empty result was now cached for 60 seconds instead of 1.

### Fix 3: Protect the Model Cache from Empty Results (Critical Fix)

Patched `/app/backend/open_webui/utils/models.py` to never replace a good cache with empty data:

```python
# Before (original code):
models_dict = {model["id"]: model for model in models}
request.app.state.MODELS = models_dict  # Always overwrites, even if empty

# After (patched):
models_dict = {model["id"]: model for model in models}
if models_dict:
    request.app.state.MODELS = models_dict
else:
    log.warning("get_all_models() returned empty model list, keeping previous cache")
```

Same pattern applied to `BASE_MODELS`:

```python
base_models = await get_all_base_models(request, user=user)
if base_models:
    request.app.state.BASE_MODELS = base_models
elif request.app.state.BASE_MODELS:
    log.warning("get_all_base_models() returned empty, keeping previous BASE_MODELS cache")
    base_models = request.app.state.BASE_MODELS
```

**Deployed via bind mount:**

```bash
-v /root/docker-services/open-webui/models.py:/app/backend/open_webui/utils/models.py
```

### Fix 4: Cache and Unblock the Bedrock Gateway Model List

Patched `/app/api/routers/model.py` in the Bedrock gateway:

```python
import time
from starlette.concurrency import run_in_threadpool

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
    except Exception as e:
        if _cached_models is not None:
            return _cached_models  # Return stale cache on failure
        raise

@router.get("", response_model=Models)
async def list_models():
    models = await run_in_threadpool(_get_models_cached)  # Non-blocking!
    model_list = [Model(id=model_id) for model_id in models]
    return Models(data=model_list)
```

Key improvements:
- **`run_in_threadpool`** — Sync AWS calls no longer block the event loop
- **5-minute cache** — Model list refreshes every 5 minutes instead of every request
- **Stale fallback** — If refresh fails, returns the previous cached list

### Fix 5: Sanitize Blank Messages at the API Boundary

Patched `/app/api/routers/chat.py` in the Bedrock gateway to replace blank text content before sending to AWS:

```python
def sanitize_messages(chat_request: ChatRequest) -> ChatRequest:
    """Replace blank text content with '...' to avoid Bedrock ValidationException."""
    for i, msg in enumerate(chat_request.messages):
        content = msg.content
        if isinstance(content, str) and not content.strip():
            msg.content = "..."
            logger.warning(f"Sanitized blank text in message {i} (role={msg.role})")
        elif isinstance(content, list):
            for j, block in enumerate(content):
                if hasattr(block, 'text') and not block.text.strip():
                    block.text = "..."
    return chat_request

@router.post("/completions", ...)
async def chat_completions(chat_request: ...):
    chat_request = sanitize_messages(chat_request)  # ← Added
    # ... rest of handler
```

### Bonus: Sub Agent Model Configuration

The Sub Agent tool was inheriting the chat's model (Opus 4 — very slow). Configured it to use a faster model:

**Admin Panel → Tools → Sub Agent → Valves:**

```json
{
  "DEFAULT_MODEL": "global.anthropic.claude-sonnet-4-6"
}
```

Sub Agent iterations dropped from 15+ minutes to ~2 minutes each.

---

## 📁 Files Modified

| File | Location | Purpose |
|------|----------|---------|
| `models.py` | `/root/docker-services/open-webui/models.py` → mounted at `/app/backend/open_webui/utils/models.py` | Protect model cache from empty results |
| `middleware.py` | `/root/docker-services/open-webui/middleware.py` → mounted at `/app/backend/open_webui/utils/middleware.py` | Pre-existing custom middleware |
| `model_patched.py` | `/root/docker-services/bedrock-gateway/model_patched.py` → mounted at `/app/api/routers/model.py` | Cache model list + run_in_threadpool |
| `chat_patched.py` | `/root/docker-services/bedrock-gateway/chat_patched.py` → mounted at `/app/api/routers/chat.py` | Sanitize blank messages |

---

## 🐳 Docker Run Commands

### Open WebUI

```bash
docker run -d --name open-webui \
  --network ai-services \
  -p 3000:8080 \
  -e BYPASS_MODEL_ACCESS_CONTROL=true \
  -e MODELS_CACHE_TTL=60 \
  -v open-webui:/app/backend/data \
  -v /root/docker-services/open-webui/middleware.py:/app/backend/open_webui/utils/middleware.py \
  -v /root/docker-services/open-webui/models.py:/app/backend/open_webui/utils/models.py \
  --restart always \
  --add-host=host.docker.internal:host-gateway \
  ghcr.io/open-webui/open-webui:latest
```

### Bedrock Gateway

```bash
docker run -d --name bedrock-gateway \
  --network ai-services \
  --restart always \
  -e AWS_ACCESS_KEY_ID=<key> \
  -e AWS_SECRET_ACCESS_KEY=<secret> \
  -e AWS_REGION=us-east-1 \
  -e API_KEY=bedrock \
  -v /root/docker-services/bedrock-gateway/model_patched.py:/app/api/routers/model.py \
  -v /root/docker-services/bedrock-gateway/chat_patched.py:/app/api/routers/chat.py \
  bedrock-gateway
```

---

## 💡 Lessons Learned

### 1. Never Replace Good Data with Empty Data

The most impactful bug was a single line: `request.app.state.MODELS = models_dict`. When the upstream API is temporarily unreachable, you get an empty response. Caching that empty response is catastrophic. **Always check before replacing cached data.**

### 2. Sync Calls in Async Handlers Are Silent Killers

The Bedrock gateway's `list_models()` was a sync function called from an `async` endpoint. It worked fine under light load but blocked the event loop during concurrent streaming responses. Use `run_in_threadpool` for any sync I/O in async FastAPI handlers.

### 3. Cache at Every Layer

We added caching at three levels:
- **Open WebUI** — `MODELS_CACHE_TTL=60` (model list refresh interval)
- **Open WebUI models.py** — Stale fallback when refresh fails
- **Bedrock Gateway** — 5-minute model list cache with stale fallback

### 4. Sanitize at API Boundaries

The blank message issue was caused by the Sub Agent creating empty placeholder messages. Rather than trying to fix every possible source of blank messages, we sanitized at the API boundary — right before sending to Bedrock. **Validate and sanitize where the data leaves your system.**

### 5. The Error Message Isn't Always the Root Cause

"Model not found" sounded like a configuration issue. It was actually a caching issue caused by a networking issue caused by an event loop blocking issue. Each layer of the stack added its own failure mode. **Follow the data flow, not just the error message.**

---

## 📊 Results

| Metric | Before | After |
|--------|--------|-------|
| Sub Agent success rate | ~30% (intermittent failures) | ~100% |
| Sub Agent iteration time | 15+ min (Opus) | ~2 min (Sonnet 4.6) |
| "Model not found" errors | Every 10-20 minutes | None |
| Bedrock ValidationException | On long conversations | None (sanitized) |
| Model list refresh failures | Catastrophic (empty cache) | Graceful (stale fallback) |
