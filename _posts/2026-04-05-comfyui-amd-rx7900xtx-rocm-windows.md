---
title: "Running ComfyUI on an AMD RX 7900 XTX — Native ROCm 7.1 on Windows"
description: "How I got ComfyUI running natively on an AMD RX 7900 XTX on Windows 11 using ROCm 7.1, without Zluda, with Wan2.1, LTX-Video, and FramePack custom nodes — and the exact steps to replicate it."
date: 2026-04-05 00:00:00 +0100
categories: [Code, AI]
tags: [python, ai, amd, windows, rocm, comfyui, video-generation, stable-diffusion]
---

*AMD ROCm 7.1 now runs natively on Windows. Here's how I used it to get ComfyUI running on a gaming PC with an RX 7900 XTX — no Zluda, no translation layer, full GPU acceleration.*

---

## The Problem

My main machine is a Windows gaming PC with an AMD RX 7900 XTX (24GB VRAM). I can't switch to Linux because of kernel-level anti-cheat — Riot Vanguard, EasyAntiCheat, BattlEye. These don't run under Wine or Proton.

The traditional options for running ComfyUI on AMD hardware on Windows were:

- **DirectML** — works, but significantly slower than ROCm or CUDA. Not viable for video generation.
- **Zluda** — a CUDA translation layer for AMD. Works for some models, but requires specific forks, is fragile, and adds complexity.
- **ROCm on Linux** — the gold standard, but requires dual-booting or a separate machine.

Then AMD shipped **ROCm 7.1 for Windows** in late 2025. `torch.cuda.is_available()` returns `True` on the RX 7900 XTX. The full pipeline runs natively on GPU.

---

## What's Already Required

Before starting, you need:

- **AMD HIP SDK 7.1** installed — available from [AMD's developer site](https://www.amd.com/en/developer/rocm-hub/hip-sdk.html). The installer sets `HIP_PATH` as a system environment variable automatically.
- **AMD Adrenalin driver 25.20.01.17 or newer** — the preview driver that enables ROCm on Windows. Check AMD's release notes for the latest.
- **Python 3.12** — the ROCm PyTorch wheels are built for cp312 specifically.
- **Git** — for cloning ComfyUI and custom nodes.

You can verify your HIP SDK is installed:

```powershell
echo $env:HIP_PATH
# Should output: C:\Program Files\AMD\ROCm\7.1\
```

---

## Installing uv

I use [uv](https://github.com/astral-sh/uv) as the package manager — it's significantly faster than pip for large installs like the ROCm SDK wheels (which are several GB).

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

uv installs to `C:\Users\<you>\.local\bin\`. Since each terminal session won't have it on PATH yet, I reference it by full path throughout this guide.

---

## Cloning ComfyUI

```powershell
git clone https://github.com/comfyanonymous/ComfyUI.git O:\ComfyUI
```

I'm installing to `O:\ComfyUI` — a dedicated SSD with plenty of space. Models alone can be 10–50GB+, so pick a drive accordingly.

---

## Creating the Python Environment

```powershell
C:\Users\joshu\.local\bin\uv.exe venv O:\ComfyUI\.venv --python 3.12
```

Note: `uv venv` needs an absolute path to the target directory, not a relative one, when running from a different drive.

---

## Installing ROCm SDK Wheels

AMD publishes ROCm Python wheels at `repo.radeon.com`. Install the SDK first:

```powershell
C:\Users\joshu\.local\bin\uv.exe pip install --no-cache `
  --python O:\ComfyUI\.venv\Scripts\python.exe `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_core-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_devel-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_libraries_custom-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm-0.1.dev0.tar.gz
```

This downloads ~3.3GB. The `--no-cache` flag is important here — uv's cache is on C: by default, and these wheels are large enough that you don't want them cached if C: is tight.

---

## Installing ROCm PyTorch

```powershell
C:\Users\joshu\.local\bin\uv.exe pip install --no-cache `
  --python O:\ComfyUI\.venv\Scripts\python.exe `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torch-2.9.0+rocmsdk20251116-cp312-cp312-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torchaudio-2.9.0+rocmsdk20251116-cp312-cp312-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torchvision-0.24.0+rocmsdk20251116-cp312-cp312-win_amd64.whl
```

---

## Installing ComfyUI Requirements

```powershell
C:\Users\joshu\.local\bin\uv.exe pip install --no-cache `
  --python O:\ComfyUI\.venv\Scripts\python.exe `
  -r O:\ComfyUI\requirements.txt
```

---

## Custom Nodes

I installed four custom nodes for video generation:

```powershell
git clone https://github.com/ltdrdata/ComfyUI-Manager         O:\ComfyUI\custom_nodes\ComfyUI-Manager
git clone https://github.com/kijai/ComfyUI-WanVideoWrapper     O:\ComfyUI\custom_nodes\ComfyUI-WanVideoWrapper
git clone https://github.com/Lightricks/ComfyUI-LTXVideo       O:\ComfyUI\custom_nodes\ComfyUI-LTXVideo
git clone https://github.com/kijai/ComfyUI-FramePackWrapper    O:\ComfyUI\custom_nodes\ComfyUI-FramePackWrapper
```

> **Important:** `lllyasviel/FramePack` is a standalone Gradio app, not a ComfyUI custom node. It has no `__init__.py` and will fail to load. Use `kijai/ComfyUI-FramePackWrapper` instead.

Install their requirements. The first three can be installed together:

```powershell
C:\Users\joshu\.local\bin\uv.exe pip install --no-cache `
  --python O:\ComfyUI\.venv\Scripts\python.exe `
  -r O:\ComfyUI\custom_nodes\ComfyUI-Manager\requirements.txt `
  -r O:\ComfyUI\custom_nodes\ComfyUI-WanVideoWrapper\requirements.txt `
  -r O:\ComfyUI\custom_nodes\ComfyUI-LTXVideo\requirements.txt
```

Then FramePackWrapper separately (its requirements are clean and already satisfied):

```powershell
C:\Users\joshu\.local\bin\uv.exe pip install --no-cache `
  --python O:\ComfyUI\.venv\Scripts\python.exe `
  -r O:\ComfyUI\custom_nodes\ComfyUI-FramePackWrapper\requirements.txt
```

> **Why separate?** The standalone `lllyasviel/FramePack` repo pins `transformers==4.46.2`, which conflicts with `ComfyUI-LTXVideo` requiring `transformers>=4.50.0`. If you accidentally install FramePack's requirements, uv will refuse to resolve the dependency graph. FramePackWrapper doesn't have this problem.

---

## Launcher Scripts

The three environment variables below are essential for stable operation on AMD hardware:

| Variable | Value | Effect |
|----------|-------|--------|
| `PYTORCH_NO_HIP_MEMORY_CACHING` | `1` | Saves ~1/3 VRAM, prevents OOM on long video runs |
| `HIP_VISIBLE_DEVICES` | `0` | Targets the RX 7900 XTX, ignores Intel iGPU |
| `HSA_OVERRIDE_GFX_VERSION` | `11.0.0` | Forces gfx1100 (RDNA3) compatibility |

`PYTORCH_NO_HIP_MEMORY_CACHING=1` is the most important one. Without it, ROCm caches GPU memory aggressively and you'll hit OOM errors during 81-frame video generation runs.

**`O:\ComfyUI\launch_comfyui.ps1`:**

```powershell
# ComfyUI Launcher for AMD Radeon RX 7900 XTX (ROCm 7.1 / Windows)
$env:PYTORCH_NO_HIP_MEMORY_CACHING = "1"
$env:HIP_VISIBLE_DEVICES = "0"
$env:HSA_OVERRIDE_GFX_VERSION = "11.0.0"

& "$PSScriptRoot\.venv\Scripts\Activate.ps1"

Write-Host "Starting ComfyUI on http://127.0.0.1:8188 ..." -ForegroundColor Cyan
& "$PSScriptRoot\.venv\Scripts\python.exe" "$PSScriptRoot\main.py" --listen 0.0.0.0 --port 8188
```

**`O:\ComfyUI\launch_comfyui.bat`** (double-click launcher):

```bat
@echo off
powershell.exe -ExecutionPolicy Bypass -File "%~dp0launch_comfyui.ps1"
pause
```

---

## Validating the GPU

Before launching ComfyUI, verify the GPU is detected:

```powershell
O:\ComfyUI\.venv\Scripts\python.exe -c "
import torch
print('Torch version:', torch.__version__)
print('CUDA available:', torch.cuda.is_available())
print('Device name:', torch.cuda.get_device_name(0))
"
```

Expected output:

```
[WARNING] failed to run amdgpu-arch: binary not found.
Torch version: 2.9.0+rocmsdk20251116
CUDA available: True
Device name: AMD Radeon RX 7900 XTX
```

The `amdgpu-arch` warning is harmless — it's a compile-time tool that isn't needed at runtime.

Run a quick GPU compute test:

```powershell
O:\ComfyUI\.venv\Scripts\python.exe -c "
import torch
x = torch.randn(1000, 1000).cuda()
y = torch.randn(1000, 1000).cuda()
z = torch.mm(x, y)
print('GPU matmul OK, sum:', z.sum().item())
"
```

---

## First Launch

```powershell
.\launch_comfyui.bat
```

Navigate to `http://127.0.0.1:8188`.

> **Note:** Use `127.0.0.1:8188`, not `localhost:8188`. Chrome sometimes returns a 403 on `localhost` due to HSTS preloading.

ComfyUI startup output confirms everything is working:

```
pytorch version: 2.9.0+rocmsdk20251116
Set: torch.backends.cudnn.enabled = False for better AMD performance.
AMD arch: gfx1100
ROCm version: (7, 1)
Total VRAM 24560 MB, total RAM 32482 MB
Set vram state to: NORMAL_VRAM
Device: cuda:0 AMD Radeon RX 7900 XTX : native
```

Key things to check:
- `AMD arch: gfx1100` — correct RDNA3 architecture
- `Device: cuda:0 AMD Radeon RX 7900 XTX : native` — running natively, not via a translation layer
- `Set vram state to: NORMAL_VRAM` — 24GB is enough that ComfyUI isn't in a reduced-VRAM mode

The `comfy-aimdo` warning on startup is also harmless — it's an Nvidia-only optimisation that self-reports as unsupported and skips itself.

---

## Model Placement

ComfyUI uses separate folders for each model type. The default LTX-Video workflow that loads on first launch needs three models (19.27 GB total) — click **"Download all"** in the Missing Models dialog and ComfyUI places them automatically.

For manual placement:

| Model type | Folder |
|-----------|--------|
| Diffusion model (main checkpoint) | `O:\ComfyUI\models\diffusion_models\` |
| Text encoders (T5, CLIP, Qwen) | `O:\ComfyUI\models\text_encoders\` |
| VAE | `O:\ComfyUI\models\vae\` |
| CLIP Vision (for image-to-video) | `O:\ComfyUI\models\clip_vision\` |
| LoRAs | `O:\ComfyUI\models\loras\` |
| Upscale models | `O:\ComfyUI\models\upscale_models\` |

### Wan2.1 i2v 480p

| File | Folder |
|------|--------|
| `wan2.1_i2v_480p_14B_fp8_scaled.safetensors` | `diffusion_models\` |
| `umt5-xxl_fp8_e4m3fn.safetensors` | `text_encoders\` |
| `wan_2.1_vae.safetensors` | `vae\` |
| `clip_vision_h.safetensors` | `clip_vision\` |

Use **ComfyUI-Manager → Model Manager** to download models directly into the correct folders without having to know the paths.

---

## Performance

Benchmarked on RX 7900 XTX, ROCm 7.1, `PYTORCH_NO_HIP_MEMORY_CACHING=1`:

| Workflow | Resolution | Frames | Steps | Time |
|----------|-----------|--------|-------|------|
| Wan2.1 i2v | 480×704 | 81 | 25 | ~40 min |
| Wan2.1 t2v | 480×704 | 81 | 25 | ~5–6 min |
| LTX-Video t2v | 512×512 | 25 | 20 | ~2–3 min |

These are slow compared to CUDA on equivalent Nvidia hardware, but they work reliably without OOM errors. The DirectML backend is significantly slower still — ROCm is the right path for AMD on Windows.

---

## Quality vs Speed: FP8 vs BF16

The models come in different precision variants. Understanding the trade-offs helps you get the most out of 24GB VRAM:

| Format | Memory | Quality | Best for |
|--------|--------|---------|----------|
| BF16 | 2 bytes/param | ★★★★ | Final renders, maximum detail |
| FP8 (scaled) | 1 byte/param | ★★★☆ | Good balance |
| FP8 (e4m3fn) | 1 byte/param | ★★★ | Fast iteration, finding compositions |

**Quality ranking:** `bf16 > fp8_scaled > fp8_e4m3fn`

With 24GB VRAM you can run BF16 variants of most models. The practical workflow I use:

1. **Draft** — fp8 model, 15–20 steps, find a good seed and composition
2. **Final render** — BF16 model, same seed, 35–50 steps

BF16 has FP32-like dynamic range (8-bit exponent) which means fewer NaN/overflow issues and better preservation of fine detail in hair, skin, and fabric. FP8 halves the VRAM requirement, which matters if you want to push to 720p or longer sequences.

If you see banding, posterisation, or loss of micro-detail, switch from `fp8_e4m3fn` to `fp8_scaled` or BF16.

---

## Known Issues

| Issue | Fix |
|-------|-----|
| `FramePack` fails to load — `__init__.py` not found | Use `kijai/ComfyUI-FramePackWrapper`, not `lllyasviel/FramePack` |
| `transformers==4.46.2` conflict when installing FramePack requirements | Install FramePackWrapper separately; don't use FramePack's `requirements.txt` |
| `uv pip install` — "No virtual environment found" | Use `--python O:\ComfyUI\.venv\Scripts\python.exe` explicitly |
| Browser 403 on `localhost:8188` | Use `http://127.0.0.1:8188` instead |
| OOM during 81-frame video generation | Ensure `PYTORCH_NO_HIP_MEMORY_CACHING=1` is set before launch |

---

## Lessons Learned

1. **ROCm on Windows works now.** AMD shipped ROCm 7.1 for Windows in late 2025. `torch.cuda.is_available()` returns `True` on RDNA3. No Zluda, no translation layer, no Linux required.

2. **`PYTORCH_NO_HIP_MEMORY_CACHING=1` is essential.** Without it, ROCm caches GPU memory aggressively and you'll hit OOM on longer video runs. This single env var saves roughly a third of VRAM.

3. **Use `kijai/ComfyUI-FramePackWrapper`, not `lllyasviel/FramePack`.** The original FramePack repo is a standalone Gradio app. It has no `__init__.py` and will fail to load as a ComfyUI custom node. The kijai wrapper is the correct one.

4. **uv needs explicit `--python` flags when the venv is on a different drive.** `uv pip install` looks for a venv relative to the current working directory. If your venv is on `O:` and you're running from `C:`, it won't find it. Pass `--python O:\ComfyUI\.venv\Scripts\python.exe` explicitly.

5. **Don't install FramePack's standalone `requirements.txt`.** It pins `transformers==4.46.2`, which conflicts with LTX-Video's requirement for `>=4.50.0`. Install FramePackWrapper's requirements separately — they're clean.

6. **BF16 for final renders, FP8 for drafts.** With 24GB VRAM you have the headroom to run BF16 models. Use FP8 to find a good seed quickly, then switch to BF16 for the final high-step render.
