---
title: "Zero-Shot Voice Cloning on AMD — ROCm 7.1 on Windows, F5-TTS, and the ONNX Fallback"
description: "How I got zero-shot voice cloning running on a Windows gaming machine with an AMD RX 7900 XTX — using ROCm 7.1 natively on Windows, with an ONNX+DirectML fallback for when you don't want the full SDK."
date: 2026-04-04 22:00:00 +0100
categories: [Code, AI]
tags: [python, ai, tts, amd, windows, onnx, automation, rocm]
---

*AMD ROCm 7.1 now runs natively on Windows. Here's how I used it to build a zero-shot voice cloning pipeline on a gaming machine that can't switch to Linux.*

---

## The Setup

My main machine is a Windows gaming PC with an AMD RX 7900 XTX. I can't switch to Linux because I play games with kernel-level anti-cheat — Riot Vanguard, EasyAntiCheat, BattlEye. These systems require Windows and won't run under Wine, Proton, or any compatibility layer. Dual-booting is theoretically possible but kills any iterative AI workflow.

The goal: **zero-shot voice cloning on GPU, on Windows, with AMD hardware.**

Zero-shot means no fine-tuning — you give the model a short reference clip of any speaker, and it synthesises new speech in their voice. The model I chose is **F5-TTS**, a flow-matching TTS model that does this well and is fully open source.

---

## The Journey (Short Version)

Before ROCm on Windows existed, I went through several dead ends:

1. **torch-directml** — DirectML doesn't support `ComplexFloat` (FFT ops). F5-TTS uses STFT for mel spectrograms. Fatal incompatibility.
2. **VMware PCIe passthrough** — `NOT_IMPLEMENTED` on Windows hosts. Linux host required.
3. **ROCm on Windows** — didn't exist. PyTorch ROCm wheels were Linux-only.
4. **ZLUDA** — CUDA compatibility layer for AMD. `torch.stft` explicitly broken.

The workaround I built was an **ONNX + DirectML hybrid** — export F5-TTS to three ONNX models, run the transformer on DirectML GPU and the FFT-heavy preprocessing/decode on CPU. It worked, but it was a compromise.

Then AMD shipped **ROCm 7.1 for Windows**.

---

## ROCm 7.1 on Windows — The Real Solution

AMD's HIP SDK for Windows is now available at `repo.radeon.com`, and PyTorch 2.9.0 ROCm wheels are included. `torch.cuda.is_available()` returns `True` on the RX 7900 XTX. The full pipeline — mel spectrogram, transformer, vocoder — runs on GPU.

### Setting Up the ROCm Venv

Create a dedicated virtual environment (keep it separate from your main Python env):

```powershell
# Use Python 3.12
python -m venv venv_rocm
```

Install the ROCm SDK and PyTorch from AMD's repo:

```powershell
.\venv_rocm\Scripts\python.exe -m pip install `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm-0.1.dev0.tar.gz `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_core-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_devel-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_libraries_custom-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torch-2.9.0+rocmsdk20251116-cp312-cp312-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torchaudio-2.9.0+rocmsdk20251116-cp312-cp312-win_amd64.whl
```

Install f5-tts and dependencies:

```powershell
.\venv_rocm\Scripts\python.exe -m pip install f5-tts soundfile pydub pyyaml numpy
```

Verify the GPU is detected:

```python
import torch
print(torch.__version__)          # 2.9.0+rocmsdk20251116
print(torch.cuda.is_available())  # True
print(torch.cuda.get_device_name(0))  # AMD Radeon RX 7900 XTX
```

### Required Environment Variables

ROCm on Windows needs three env vars set before running. I put these in a launcher script:

```powershell
# scripts/launch_voice_rocm.ps1
$env:PYTORCH_NO_HIP_MEMORY_CACHING = "1"   # saves ~1/3 VRAM, prevents OOM
$env:HIP_VISIBLE_DEVICES = "0"              # target RX 7900 XTX, ignore iGPU
$env:HSA_OVERRIDE_GFX_VERSION = "11.0.0"   # force gfx1100 (RDNA3) compatibility
```

`PYTORCH_NO_HIP_MEMORY_CACHING=1` is particularly important — without it, ROCm caches GPU memory aggressively and you'll hit OOM on longer runs.

### Compatibility Patches

ROCm 7.1 + PyTorch 2.9 + f5-tts 1.1.18 required four patches to work together. None are fundamental issues — they're version incompatibilities that will be fixed upstream:

| File | Issue | Fix |
|------|-------|-----|
| `encodec/distrib.py` | `torch.distributed.ReduceOp` moved in PyTorch 2.9 | `try/except` fallback |
| `torchaudio/__init__.py` | torchaudio 2.9 requires torchcodec (no Windows DLLs) | soundfile fallback |
| `f5_tts/model/cfm.py` | Sway sampling produces duplicate ODE timesteps | `torch.unique()` |
| `f5_tts/infer/utils_infer.py` | `ThreadPoolExecutor` causes tensor size mismatches | Sequential loop |

The torchaudio patch is the most interesting — torchaudio 2.9 replaced its `load()` function with a torchcodec-only implementation, but torchcodec's Windows DLLs don't ship with the ROCm build. The fix is a one-line fallback to soundfile:

```python
# torchaudio/__init__.py — patched load()
try:
    return load_with_torchcodec(uri, ...)
except (ImportError, OSError):
    import soundfile as _sf
    data, sample_rate = _sf.read(str(uri), dtype="float32", always_2d=True)
    return torch.from_numpy(data.T if channels_first else data), sample_rate
```

### Running It

```powershell
# Default (NFE=32, fast)
.\scripts\launch_voice_rocm.ps1

# Higher quality
.\scripts\launch_voice_rocm.ps1 --nfe 64

# Best quality
.\scripts\launch_voice_rocm.ps1 --nfe 128
```

---

## The Architecture: Full GPU vs Hybrid

### ROCm Native (Full GPU)

```
Reference Audio + Text
         │
         ▼
┌─────────────────────┐
│  Mel Spectrogram    │  ← ROCm GPU (STFT — works natively!)
│  Text Tokenisation  │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│  F5 Transformer     │  ← ROCm GPU (flow-matching, 32-128 steps)
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│  Vocoder (Vocos)    │  ← ROCm GPU (mel → waveform)
└─────────────────────┘
         │
         ▼
      output.wav
```

Everything runs on GPU. No CPU↔GPU transfers between stages.

### ONNX + DirectML (Hybrid Fallback)

```
Reference Audio + Text
         │
         ▼
┌─────────────────────┐
│  F5_Preprocess.onnx │  ← CPU (ComplexFloat/FFT — DirectML can't do this)
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ F5_Transformer.onnx │  ← DirectML GPU (pure float ops — works fine)
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   F5_Decode.onnx    │  ← CPU (ISTFT/vocoder — same FFT issue)
└─────────────────────┘
         │
         ▼
      output.wav
```

The preprocessing and decode stages run on CPU because DirectML doesn't support `ComplexFloat` (FFT). Only the transformer runs on GPU.

---

## Reference Audio Pipeline

The quality of the output depends heavily on the reference clip. I built an ingest pipeline to automate finding and preparing good clips:

```python
# scripts/ingest.py
# 1. Download from YouTube
ydl_opts = {
    "format": "bestaudio/best",
    "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
}

# 2. Trim to the clean section
ffmpeg.input(raw_wav, ss=start_time, to=end_time) \
      .output(trimmed_wav, ar=22050, ac=1) \
      .run(overwrite_output=True)

# 3. Transcribe with Whisper
model = whisper.load_model("base")
result = model.transcribe(trimmed_wav)
transcript = result["text"].strip()
```

What makes a good reference clip:
- **6–30 seconds** — long enough for voice characteristics, short enough to avoid drift
- **Clean audio** — no background music, minimal reverb, no compression artefacts
- **Consistent delivery** — don't use a clip where the speaker is shouting or whispering

For Neil deGrasse Tyson (my test voice), I used an 11.9-second clip from a YouTube lecture, trimmed to a section with clean, energetic speech and no background noise.

The transcript must match the audio exactly — F5-TTS uses it to align voice conditioning. An accurate transcript noticeably improves output quality.

---

## Configuration

Everything is driven by `config.yaml`:

```yaml
voice:
  name: neil_degrasse_tyson
  audio_path: reference_audio/neil_degrasse_tyson/ndgt_ref_new.wav
  transcript: "So, here in the United States, we completely freaked out for
    multiple reasons. First, they beat us at something technological that
    they're not supposed to, because they're like communists."
  language: en

model:
  backend: f5_onnx_dml   # or f5_rocm via launch_voice_rocm.ps1
  onnx_model_dir: onnx_models/F5-TTS-ONNX-GPU-NFE128-CFG3
  nfe_step: 128
  speed: 0.75
  device_id: 0

output:
  output_dir: outputs/runs
  target_duration: 5.0
  silence_thresh_db: -40
  keep_raw: true

sentences:
  - "The universe is under no obligation to make sense to you."
  - "We are all connected — to each other, biologically; to the earth,
    chemically; to the rest of the universe, atomically."
  - "The good thing about science is that it's true whether or not you
    believe in it."
```

Machine-specific paths go in `.env` (not committed):

```bash
VOICE_GENERATOR_MODEL_DIR=C:\Users\joshu\...\onnx_models\F5-TTS-ONNX-GPU-NFE128-CFG3
VOICE_GENERATOR_OUTPUT_DIR=C:\Users\joshu\...\outputs\runs
```

---

## Performance

Benchmarked on AMD RX 7900 XTX, 10-second reference clip, speed=0.75:

| Backend | NFE | Precision | Time/clip | Notes |
|---------|-----|-----------|-----------|-------|
| ONNX + DirectML | 128 | FP16 | ~33s | Stable, no SDK needed |
| ONNX + DirectML | 256 | FP32 | ~64s | Higher quality |
| **ROCm native** | **32** | **FP32** | **~10s** | **3x faster than ONNX** |
| **ROCm native** | **64** | **FP32** | **~17s** | **Sweet spot** |
| **ROCm native** | **128** | **FP32** | **~30s** | Best quality |

**The sweet spot is ROCm native at NFE=64** — 2x better quality than NFE=32, still 2x faster than ONNX+DirectML at equivalent NFE, and the quality improvement from 64→128 is marginal for most use cases.

At NFE=128, ROCm native (~30s) is roughly equivalent to ONNX+DirectML (~33s) in speed, but better in quality because the full pipeline runs in FP32 with no precision loss between stages.

---

## Project Structure

```
voice_generator/
├── config.yaml                         # All settings
├── .env                                # Machine-specific paths (not committed)
├── .env.example                        # Template
├── scripts/
│   ├── generate_f5_rocm.py             # ROCm native backend
│   ├── generate_f5_onnx_dml.py         # ONNX+DirectML fallback
│   ├── launch_voice_rocm.ps1           # ROCm launcher (sets env vars)
│   ├── ingest.py                       # YouTube → trimmed WAV + transcript
│   └── transcribe.py                   # Whisper transcription
├── lib/
│   ├── audio.py                        # FFmpeg, normalisation, silence trim
│   ├── vocab.py                        # F5-TTS vocabulary handling
│   └── config.py                       # Config dataclasses + loader
├── venv_rocm/                          # ROCm Python environment
├── onnx_models/
│   ├── F5-TTS-ONNX-GPU-NFE128-CFG3/   # ONNX FP16 (DirectML)
│   └── F5-TTS-ONNX-GPU-FP32-NFE256/   # ONNX FP32 (DirectML)
├── reference_audio/
│   └── neil_degrasse_tyson/
│       └── ndgt_ref_new.wav            # 11.9s reference clip
├── outputs/runs/                       # Generated audio
└── tests/                              # 78 pytest unit tests
```

---

## The ONNX + DirectML Fallback

If you don't want to install the full ROCm SDK (~3.5GB), the ONNX + DirectML approach still works well. It requires only standard AMD Adrenalin drivers and ONNX Runtime with the DirectML execution provider.

The ONNX models are exported from F5-TTS with NFE and CFG baked in:

```python
# onnx_export/Export_F5.py
use_fp16_transformer = True   # FP16 for DirectML
NFE_STEP = 128
CFG_STRENGTH = 3.0
OUTPUT_DIR = r"onnx_models\F5-TTS-ONNX-GPU-NFE128-CFG3"
```

The transformer runs on DirectML GPU, preprocessing and decode run on CPU:

```python
# DirectML for transformer
ort_session_b = onnxruntime.InferenceSession(
    "F5_Transformer.onnx",
    providers=["DmlExecutionProvider"],
)

# CPU for preprocessing and decode
ort_session_a = onnxruntime.InferenceSession(
    "F5_Preprocess.onnx",
    providers=["CPUExecutionProvider"],
)
```

When to use ONNX + DirectML:
- You don't want to install the 3.5GB ROCm SDK
- You need to run on a non-AMD GPU (NVIDIA, Intel — DirectML works on all DirectX 12 GPUs)
- You want FP16 precision to save VRAM
- You need a more stable, less patchy setup

---

## Test Suite

The project has 78 pytest unit tests:

```
tests/
├── test_lib_audio.py       # 19 tests
├── test_lib_vocab.py       # 18 tests
├── test_lib_config.py      # 22 tests
├── test_integration_smoke.py  # GPU required
└── test_e2e_full_run.py       # GPU required
```

```bash
pytest tests/ -v          # 78 unit tests, no GPU needed
pytest tests/ -m integration  # requires DirectML GPU
pytest tests/ -m e2e          # full pipeline test
```

---

## Lessons Learned

1. **ROCm on Windows works now.** AMD shipped ROCm 7.1 for Windows in late 2025. `torch.cuda.is_available()` returns `True` on RDNA3. The ecosystem is still maturing but it's functional.

2. **The ONNX hybrid is still worth knowing.** If you don't want the ROCm SDK overhead, or you need to run on non-AMD hardware, ONNX + DirectML is a solid fallback that works on any DirectX 12 GPU.

3. **NFE=64 is the sweet spot for ROCm native.** 2x better quality than NFE=32, still 2x faster than ONNX+DirectML, and the marginal quality gain from 64→128 rarely justifies the 2x time cost.

4. **Reference audio quality matters more than model parameters.** A clean 12-second clip beats a noisy 30-second clip every time. Get the transcript right — it directly affects voice conditioning quality.

5. **`PYTORCH_NO_HIP_MEMORY_CACHING=1` is essential.** Without it, ROCm caches GPU memory aggressively and you'll hit OOM on longer runs. This env var saves roughly a third of VRAM.

6. **Separate config from machine-specific paths.** Using `.env` for absolute paths means the same `config.yaml` works on any machine without modification.
