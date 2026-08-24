# Local vision-model judge: feasibility on consumer hardware

Status: measured 2026-08-13 on an RTX 4060 Laptop GPU (8 GB VRAM), Ollama 0.32.9,
frozen `robot-success-v1` prompt and response schema, 8 frames per video at 448 px.

## Summary

A local judge is viable for **quality** at 7B and viable for **throughput** only at
pilot scale. The full 4,193-video round-robin is roughly 72 hours of continuous
compute on this machine, against about $4.50 and a couple of hours for the frozen
API run. Local inference is the right choice for the 200-video pilot and the wrong
choice for the full protocol.

## Model selection

`qwen2.5` and `qwen2.5vl` are different models. The former is text-only; Ollama
rejects images against it with `model does not support multimodal requests`. Only
the `vl` variants carry the `vision` capability.

| Model | Size | Placement on 8 GB | Throughput on fresh videos | Usable as a judge |
|---|---:|---|---:|---|
| `qwen2.5vl:3b` | 3.2 GB | fully on GPU | ~19 s/video | **no** |
| `qwen2.5vl:7b` | 6.3 GB | 13% CPU / 87% GPU | **~50 s/video** | yes, with caveats |

### Measuring throughput correctly

This number was got wrong twice, in opposite directions, and both mistakes are easy
to repeat.

A cold start charges the one-off model load against a handful of videos: the first
measurement was 62.4 s/video over 8 videos and overstated the steady-state cost.

Re-measuring on videos that had *already been judged during debugging* then gave
3.8 s/video and understated it by more than an order of magnitude — those runs hit
the OS file cache for the mp4 and Ollama's prompt cache for an identical image set.

Per-item timings across the first seven items of a real run make the split obvious:

```
4.0, 3.9, 3.7, 3.6,   44.5, 52.8, 53.3
└── previously judged ──┘ └── fresh videos ──┘
```

Size any estimate from **fresh, never-judged videos with the model already
resident**. The dominant cost is the 13% CPU spill: the 6.3 GB model does not fit
8 GB VRAM alongside an 8192-token context, so part of every forward pass runs on
CPU. A quantization that fits entirely in VRAM would change this materially and is
the first thing to try.

### 3B is not a judge

On four videos the reference labels SUCCESS, the 3B model returned FAILURE three
times, and its single SUCCESS was reasoned backwards: for `put the screwdriver out
of the box` it observed *"the screwdriver is visible in the box"* and scored that as
completion. Almost every output collapsed to the constant tuple
`FAILURE / confidence 0 / partial_success 0 / ABORTED`.

The evidence strings were accurate and specific (naming the fork, the whiteboard,
the ketchup), so the model was reading the frames. It could not judge completion.

### 7B discriminates

On the same four SUCCESS videos plus four FAILURE videos, 7B matched the reference
on 6 of 8, with confidences between 0.8 and 0.9 and no self-contradictions. It
recovered all four failures and two of four successes.

One residual degeneracy: `reason_code` returned `PARTIAL` on every item. The binary
verdict and confidence are what calibration consumes, so this does not block a run,
but the reason codes carry no information and must not be analyzed.

## Three defects this exposed in the harness

Running a real model surfaced problems that unit tests on stubs did not.

1. **Context overflow.** Eight 448 px frames cost about 4,311 tokens against
   Ollama's 4,096 default, and the server rejects the entire request. The context
   window is now sized from the frame budget.

2. **Field invention.** With `format: "json"`, the model emitted its own schema —
   `success` in place of `verdict`, no `reason_code` at all. Passing the frozen
   response schema as `format` constrains decoding to the contract.

3. **Score inversion.** The 3B model returns `FAILURE` with `confidence: 0`. Scored
   as `P(success) = 1 - confidence`, that yields **1.0**, a maximum-success score
   attached to a failure verdict. Nothing would have crashed; the calibration
   estimate would simply have been inverted. Verdicts whose confidence falls below
   0.5 are now rejected rather than recorded.

The third is the one worth remembering: it is silent, it survives every schema
check, and it corrupts the exact quantity the thesis depends on.

## Throughput

| Scope | Videos | Local 7B | Frozen API run |
|---|---:|---:|---:|
| Existing pilot (1 policy pair) | 200 | **~2.8 h** | ~1 min, ~$0.21 |
| Round-robin (21 policy pairs) | 4,193 | **~58 h** | ~$4.50 |

Frame extraction is about 1.5 s of that and is independent of the model.

## Recommendation

Run the 200-video pilot locally. It is a single overnight job, costs nothing, sends
nothing off the machine, and produces the first paired machine/human labels this
project has had.

Do not run the full round-robin locally on this hardware as configured. At roughly
58 hours of continuous compute against about $4.50 and a couple of hours for the
frozen API run, the local route is only worth it if avoiding the API is itself the
requirement. Fitting the model entirely in VRAM is the change that would make the
local full run competitive, and should be tried before accepting the 58-hour figure.

Two things still gate any full run: `video_paths` is empty for all 10,783
normalized records (the metadata-only import never listed media), so a round-robin
pilot directory must be built and wrist files resolved through the HuggingFace tree
API as `pilot-download` already does per session; and that download is roughly
4 GB against the current 2 GiB cap in `pilot-download.js`.

Quality remains a harder limit than throughput. 7B agreed with the reference on 6
of 8 spot-checked videos, and its `reason_code` was near-constant across the first
items of the real run (`PARTIAL` 6/7). Treat the binary verdict and confidence as
the usable signal, ignore the reason codes, and report the judge as
`qwen2.5vl:7b` — never as "an automatic judge" in general.

Note also that `video_paths` is empty for all 10,783 normalized records — the
metadata-only import never listed media — so any full-scale run must first build a
round-robin pilot directory and resolve wrist files through the HuggingFace tree
API, as `pilot-download` already does per session.
