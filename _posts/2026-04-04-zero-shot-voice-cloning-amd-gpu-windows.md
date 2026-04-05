---
title: "Zero-Shot Voice Cloning on an AMD GPU — F5-TTS, ONNX, and DirectML on Windows"
description: "How I built a zero-shot voice cloning pipeline on Windows using F5-TTS exported to ONNX, with GPU acceleration via DirectML on an AMD RX 7900 XTX — no ROCm, no WSL, no CUDA required."
date: 2026-04-04 22:00:00 +0100
categories: [Code, AI]
tags: [python, ai, tts, amd, windows, onnx, automation]
---

*How I got zero-shot voice cloning running on a Windows gaming machine with an AMD RX 7900 XTX — and why the usual advice doesn't apply when you can't switch to Linux.*

---

## The Constraint Nobody Talks About

Most AI voice cloning tutorials assume one of two things: you have an NVIDIA GPU, or you're on Linux. If you have both, great — install CUDA, install PyTorch, done.

I have neither. My main machine is a Windows gaming PC with an AMD RX 7900 XTX. I can't switch to Linux because I play games with kernel-level anti-cheat (Riot Vanguard, EasyAntiCheat, BattlEye). These anti-cheat systems require Windows and won't run under Wine, Proton, or any Linux compatibility layer. Dual-booting is an option in theory, but in practice it means rebooting every time I want to do AI work — which kills any kind of iterative workflow.

So the challenge was: **get GPU-accelerated voice cloning working on Windows with AMD hardware.**

This post documents what I built, the dead ends I hit, and the solution that actually works.

---

## What I Wanted to Build

The goal was a pipeline that takes a short reference audio clip of any speaker and synthesises new speech in their voice — zero-shot, meaning no fine-tuning required. Feed it 10–30 seconds of someone talking, give it a text prompt, get back audio that sounds like them saying it.

The model I chose was **F5-TTS** — a flow-matching TTS model that does zero-shot voice cloning from a reference clip. It's fast, the quality is good, and it's fully open source.

The final pipeline:

1. Download a reference audio clip (YouTube, podcast, etc.)
2. Trim and transcribe it with Whisper
3. Run F5-TTS inference with the reference clip + target text
4. Get a `.wav` file back

Simple in concept. The GPU acceleration part is where it gets complicated.

---

## The AMD GPU Problem on Windows

### ROCm: Linux Only (Until Recently)

AMD's answer to CUDA is ROCm — their open compute platform for GPU-accelerated workloads. PyTorch has ROCm support. Coqui TTS has ROCm support. In theory, you install ROCm, install PyTorch with ROCm wheels, and everything works.

The catch: **ROCm has historically been Linux-only.** There are no official ROCm Windows packages. The PyTorch ROCm wheels are built for Linux. If you're on Windows, you're locked out.

This is changing — AMD recently shipped the **HIP SDK for Windows**, which brings ROCm-style GPU compute to Windows natively. This is a genuinely significant development. But at the time I built this pipeline, PyTorch ROCm Windows wheels weren't available, and the ecosystem wasn't there yet. More on this at the end.

### DirectML: The Windows AMD Path

Microsoft's answer to this problem is **DirectML** — a hardware-accelerated machine learning API built on top of DirectX 12. It works on any DirectX 12 GPU: NVIDIA, AMD, Intel. No CUDA, no ROCm required.

PyTorch has a DirectML backend via `torch-directml`. ONNX Runtime has a DirectML execution provider. Both work on Windows with AMD GPUs.

The problem: **DirectML doesn't support all operations.** Specifically, it doesn't support complex-valued tensor operations — `ComplexFloat`, FFT, and related ops. F5-TTS uses these extensively in its mel spectrogram processing and vocoder decode stages.

When I tried running F5-TTS directly with `torch-directml`, it crashed immediately:

```
RuntimeError: "fft_c2c_cuda" not implemented for 'ComplexFloat'
```

DirectML simply doesn't have these ops. The model can't run end-to-end on DirectML.

### What About WSL2?

WSL2 with GPU passthrough works for NVIDIA (via CUDA). For AMD, it's more complicated — ROCm in WSL2 requires specific kernel versions and driver support that wasn't stable for RDNA3 (7900 XTX) at the time. I tested it; it didn't work reliably.

VMware PCIe passthrough to a Linux VM was another option I explored. It returned `NOT_IMPLEMENTED` on Windows hosts. Dead end.

---

## The Solution: ONNX + DirectML Hybrid

The breakthrough came from realising I didn't need to run the *entire* model on the GPU — just the expensive part.

F5-TTS can be exported to ONNX. When you do this, the model splits into three separate ONNX graphs:

| Model | Operation | Runs On |
|-------|-----------|---------|
| `F5_Preprocess.onnx` | Text encoding, mel conditioning | CPU |
| `F5_Transformer.onnx` | Flow-matching transformer (the heavy part) | **DirectML GPU** |
| `F5_Decode.onnx` | Vocoder decode (BigVGAN) | CPU |

The preprocessing and decode stages use complex-valued ops that DirectML can't handle — so they run on CPU. The transformer is pure matrix multiplication and attention — DirectML handles this perfectly. And the transformer is where ~95% of the compute lives.

This hybrid approach gives GPU acceleration where it matters, while routing the incompatible ops to CPU. The result: inference that's significantly faster than pure CPU, without needing ROCm or CUDA.

---

## The Architecture

```
Input Text + Reference Audio
         │
         ▼
┌─────────────────────┐
│  F5_Preprocess.onnx │  ← CPU (ComplexFloat/FFT ops)
│  Text → Tokens      │
│  Audio → Mel Spec   │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ F5_Transformer.onnx │  ← DirectML GPU (RX 7900 XTX)
│  Flow Matching      │
│  NFE=128 steps      │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   F5_Decode.onnx    │  ← CPU (BigVGAN vocoder)
│  Mel → Waveform     │
└─────────────────────┘
         │
         ▼
      output.wav
```

The ONNX Runtime session for the transformer is created with the DirectML execution provider:

```python
import onnxruntime as ort

providers = [
    ("DmlExecutionProvider", {"device_id": 0}),
    "CPUExecutionProvider",
]

transformer_session = ort.InferenceSession(
    "F5_Transformer.onnx",
    providers=providers,
)
```

The preprocess and decode sessions use CPU only:

```python
preprocess_session = ort.InferenceSession(
    "F5_Preprocess.onnx",
    providers=["CPUExecutionProvider"],
)
```

---

## Project Structure

```
voice_generator/
├── config.yaml                    # All settings
├── .env                           # Machine-specific overrides (not committed)
├── .env.example                   # Template
├── scripts/
│   ├── generate_f5_onnx_dml.py    # Main generation script
│   ├── ingest.py                  # YouTube → trimmed WAV + transcript
│   └── transcribe.py              # Whisper transcription
├── lib/
│   ├── audio.py                   # FFmpeg setup, normalisation, silence trim
│   ├── vocab.py                   # F5-TTS vocabulary handling
│   └── config.py                  # Config dataclasses + loader
├── onnx_models/
│   └── F5-TTS-ONNX-GPU-NFE128-CFG3/   # Current best model
├── reference_audio/
│   └── neil_degrasse_tyson/
│       └── ndgt_ref_new.wav       # 11.9s reference clip
├── outputs/runs/                  # Generated audio
└── tests/                         # 78 pytest unit tests
```

---

## Reference Audio: Getting a Good Clip

The quality of the output is heavily dependent on the reference audio. A few things that matter:

- **Length:** 6–30 seconds. Too short and the model doesn't have enough voice characteristics. Too long and it can drift.
- **Clean audio:** No background music, minimal reverb, no compression artefacts. A podcast or interview recorded in a quiet room is ideal.
- **Consistent speaking style:** Don't use a clip where the speaker is shouting, whispering, or doing something unusual — the model will try to match that energy.

I built an ingest pipeline to automate this:

```python
# scripts/ingest.py
# Downloads a YouTube video, trims to a specific timestamp range,
# and transcribes it with Whisper

ydl_opts = {
    "format": "bestaudio/best",
    "postprocessors": [{
        "key": "FFmpegExtractAudio",
        "preferredcodec": "wav",
    }],
}

# Trim to the clean section
ffmpeg.input(raw_wav, ss=start_time, to=end_time) \
      .output(trimmed_wav, ar=22050, ac=1) \
      .run(overwrite_output=True)

# Transcribe with Whisper
model = whisper.load_model("base")
result = model.transcribe(trimmed_wav)
transcript = result["text"].strip()
```

The transcript is important — F5-TTS uses it as the reference text to align the voice characteristics. An accurate transcript improves output quality.

For Neil deGrasse Tyson (my test voice), I used a 11.9-second clip from a YouTube video, trimmed to a section where he's speaking clearly with no background noise.

---

## Configuration

Everything is driven by `config.yaml`:

```yaml
voice:
  name: neil_degrasse_tyson
  audio_path: reference_audio/neil_degrasse_tyson/ndgt_ref_new.wav
  transcript: "So, here in the United States, we completely freaked out..."

model:
  backend: f5_onnx_dml
  onnx_model_dir: onnx_models/F5-TTS-ONNX-GPU-NFE128-CFG3
  nfe_step: 128
  speed: 0.85

output:
  output_dir: outputs/runs

sentences:
  - "The universe is under no obligation to make sense to you."
  - "We are all connected — to each other, biologically."
  - "The good thing about science is that it's true whether or not you believe in it."
```

Machine-specific paths (absolute paths to model directories, etc.) go in `.env`:

```bash
# .env
VOICE_GENERATOR_MODEL_DIR=C:\Users\joshu\Nextcloud\Projects\voice_generator\onnx_models\F5-TTS-ONNX-GPU-NFE128-CFG3
VOICE_GENERATOR_OUTPUT_DIR=C:\Users\joshu\Nextcloud\Projects\voice_generator\outputs\runs
```

The config loader merges both:

```python
# lib/config.py
def load_config(config_path: str = "config.yaml") -> AppConfig:
    _load_dotenv()  # Load .env overrides first
    with open(config_path) as f:
        raw = yaml.safe_load(f)
    # .env values override config.yaml values
    ...
```

---

## Quality Tuning

The main levers for output quality:

### NFE Steps (Number of Function Evaluations)

F5-TTS uses a flow-matching ODE solver. More steps = better quality, more compute time.

| NFE | Quality | Time (approx) |
|-----|---------|---------------|
| 32  | Acceptable, some artefacts | ~2s |
| 64  | Good | ~4s |
| 128 | Best, noticeably cleaner | ~8s |

I settled on **NFE=128**. The quality improvement from 64→128 is audible — less metallic quality, better prosody.

### CFG Scale (Classifier-Free Guidance)

Controls how strongly the model follows the reference voice characteristics vs. generating freely.

| CFG | Effect |
|-----|--------|
| 2.0 | Default, balanced |
| 3.0 | Stronger voice adherence, slightly more natural |

**CFG=3.0** gave better voice similarity in my testing.

### Speed

The `speed` parameter controls the speaking rate of the output. Default is 1.0 (match reference). I use **0.85** — slightly slower than the reference, which tends to produce cleaner output with better articulation.

### Current Best Model

```
onnx_models/F5-TTS-ONNX-GPU-NFE128-CFG3/
├── F5_Preprocess.onnx
├── F5_Transformer.onnx   ← FP16, runs on DirectML
└── F5_Decode.onnx
```

Exported with NFE=128 baked into the ONNX graph, CFG=3.0, FP16 precision for the transformer.

---

## Running It

```bash
# Generate from config.yaml sentences
python scripts/generate_f5_onnx_dml.py

# Override voice
python scripts/generate_f5_onnx_dml.py --voice neil_degrasse_tyson

# Custom sentences file
python scripts/generate_f5_onnx_dml.py --sentences-file my_sentences.txt

# Custom output directory
python scripts/generate_f5_onnx_dml.py --output outputs/test_run
```

Output goes to a timestamped run directory:

```
outputs/runs/run_20260404_221500/
├── 001_the-universe-is-under-no-obligation.wav
├── 002_we-are-all-connected.wav
└── 003_the-good-thing-about-science.wav
```

---

## The Test Suite

The project has 78 pytest unit tests across three modules:

```
tests/
├── test_lib_audio.py       # 19 tests — FFmpeg setup, normalisation, silence trim
├── test_lib_vocab.py       # 18 tests — vocab loading, char-to-pinyin, token conversion
├── test_lib_config.py      # 22 tests — config loading, .env overrides, validation
├── test_integration_smoke.py  # ONNX model loading + single clip (requires GPU)
└── test_e2e_full_run.py       # Full script run validation (requires GPU)
```

Unit tests run without GPU:

```bash
pytest tests/ -v
# 78 passed in 1.2s
```

Integration and E2E tests are marked and skipped by default:

```bash
pytest tests/ -m integration  # Requires DirectML GPU
pytest tests/ -m e2e          # Full pipeline test
```

---

## Update: ROCm for Windows is Here

Since building the ONNX + DirectML pipeline, AMD shipped **ROCm 7.1 for Windows** — and it works. `torch.cuda.is_available()` returns `True` on the RX 7900 XTX with PyTorch 2.9.0+rocmsdk20251116.

I've now built a second backend (`generate_f5_rocm.py`) that runs the **full F5-TTS pipeline natively on ROCm** — no ONNX export, no DirectML, no CPU fallback for FFT ops. Everything runs on GPU.

### Setting it up

```powershell
# Create a dedicated ROCm venv
python -m venv venv_rocm

# Install ROCm SDK + PyTorch from AMD's repo
.\venv_rocm\Scripts\python.exe -m pip install `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm-0.1.dev0.tar.gz `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_core-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_devel-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_libraries_custom-0.1.dev0-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torch-2.9.0+rocmsdk20251116-cp312-cp312-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torchaudio-2.9.0+rocmsdk20251116-cp312-cp312-win_amd64.whl

# Install f5-tts
.\venv_rocm\Scripts\python.exe -m pip install f5-tts soundfile pydub pyyaml
```

### Running it

```powershell
# launch_voice_rocm.ps1 sets the required env vars automatically
.\scripts\launch_voice_rocm.ps1
.\scripts\launch_voice_rocm.ps1 --nfe 64
```

The launcher sets:
```powershell
$env:PYTORCH_NO_HIP_MEMORY_CACHING = "1"   # saves ~1/3 VRAM
$env:HIP_VISIBLE_DEVICES = "0"              # target RX 7900 XTX
$env:HSA_OVERRIDE_GFX_VERSION = "11.0.0"   # force gfx1100 (RDNA3)
```

### Performance comparison

| Backend | NFE | Time/clip | Quality |
|---------|-----|-----------|---------|
| ONNX + DirectML | 128 (FP16) | ~33s | Good |
| ONNX + DirectML | 256 (FP32) | ~64s | Better |
| **ROCm native** | **32** | **~10s** | Good |
| **ROCm native** | **64** | **~17s** | Better |
| **ROCm native** | **128** | **~30s** | Best |

The ROCm native backend is **3x faster** than ONNX+DirectML at low NFE steps (32/64), where the overhead of CPU↔GPU data transfers in the ONNX hybrid dominates. At NFE=128, ROCm native (~30s) is roughly equivalent to ONNX+DirectML (~33s) — but with better quality since the full pipeline runs in FP32 on GPU with no precision loss between stages.

The sweet spot for ROCm native is **NFE=64** — 2x better quality than NFE=32, still 2x faster than ONNX+DirectML, and the quality improvement from 64→128 is marginal for most use cases.

### Compatibility patches required

ROCm 7.1 + PyTorch 2.9 + f5-tts 1.1.18 required a few patches:

1. **`encodec/distrib.py`** — `torch.distributed.ReduceOp` moved in PyTorch 2.9, needs a try/except fallback
2. **`torchaudio/__init__.py`** — torchaudio 2.9 requires torchcodec for `load()`, which doesn't have Windows DLLs; patched to fall back to soundfile
3. **`f5_tts/model/cfm.py`** — sway sampling can produce duplicate timesteps; added `torch.unique()` to ensure strict monotonicity for torchdiffeq
4. **`f5_tts/infer/utils_infer.py`** — replaced `ThreadPoolExecutor` with sequential processing to avoid tensor size mismatches when batching chunks of different lengths

None of these are fundamental issues — they're version incompatibilities that will be fixed upstream as the ROCm Windows ecosystem matures.

### The ONNX + DirectML path is still useful

The ROCm native backend is faster, but the ONNX + DirectML approach has advantages:
- **No ROCm SDK required** — works with standard AMD Adrenalin drivers
- **Lower memory overhead** — FP16 ONNX models use less VRAM
- **More stable** — fewer compatibility patches needed
- **Portable** — the ONNX models work on any DirectX 12 GPU (NVIDIA, Intel, AMD)

For a gaming machine where you want minimal setup friction, ONNX + DirectML is still a solid choice. For maximum performance, ROCm native is the way to go.

---

## Results

The pipeline generates clean, recognisable voice clones from a single reference clip. Quality is good enough to be clearly identifiable as the target speaker, with natural prosody and intonation.

Key metrics with the current setup (RX 7900 XTX, NFE=128, CFG=3.0):

| Metric | Value |
|--------|-------|
| GPU | AMD RX 7900 XTX |
| Backend | ONNX + DirectML |
| NFE Steps | 128 |
| CFG Scale | 3.0 |
| Speed | 0.85 |
| Inference time (10s clip) | ~8–10s |
| Reference audio length | 11.9s |
| Output quality | Good — clearly identifiable voice |

The main limitation is that the CPU-bound preprocess and decode stages mean you can't get the full GPU speedup you'd get with a native CUDA/ROCm setup. But for a gaming machine that can't run ROCm, it's a solid working solution.

---

## Lessons Learned

1. **The ONNX hybrid approach is the right answer for AMD on Windows.** Don't try to force DirectML to run the whole model — route the incompatible ops to CPU and let the GPU handle the transformer.

2. **Reference audio quality matters more than model parameters.** A clean 12-second clip beats a noisy 30-second clip every time.

3. **NFE=128 is worth the extra compute.** The quality jump from 64 to 128 steps is audible. At ~8 seconds per clip, it's not a bottleneck.

4. **ROCm on Windows is coming.** The HIP SDK for Windows is real and shipping. The ecosystem isn't there yet for PyTorch, but it's moving. AMD GPU users on Windows will have a proper CUDA-equivalent path eventually.

5. **Separate config from machine-specific paths.** Using `.env` for absolute paths means the same `config.yaml` works on any machine without modification.

---

*The project is at `Nextcloud/Projects/voice_generator` — not public, but the approach is fully documented here.*
