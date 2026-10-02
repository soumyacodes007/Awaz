# Low-latency voice agents: benchmarks, architectures, Sarvam, telephony, and a Dograh roadmap

**Research date:** 2026-08-20  
**Scope:** Dograh's current cascade and speech-to-speech pipelines; LiveKit and Pipecat benchmarks; public voice-agent evaluation suites; Vapi, Retell, ElevenLabs, and Daily engineering material; Vobiz, Exotel, Twilio, Telnyx, and Vonage media paths; Sarvam's public APIs and hosted runtime; and open speech-to-speech models.

## Executive answer

The displayed `Reasoning Delay: 2564ms` does not mean that Dograh spent exactly 2.564 seconds on the whole turn. In the current UI it is the LLM time-to-first-token/byte metric. It excludes endpoint detection, STT finalization, TTS buffering, first audio generation, transport buffering, and the network. In the locally inspected run, the turn showing about 2.7 seconds of LLM TTFB took about **4.36 seconds from user speech-stop to bot audio-start**. Another turn had about 0.69 seconds of LLM TTFB and about **2.45 seconds end to end**. The label is therefore misleading, but the delay is real and is spread across more than the LLM.

The published workflow is not using Dograh's default STT or TTS. The inspected configuration was:

- STT: Sarvam `saaras:v3`
- LLM: OpenRouter, Qwen 3 30B Instruct family
- TTS: Sarvam `bulbul:v3`, Pooja, Bengali
- Architecture: cascade/BYOK (`STT -> LLM -> TTS`), not a native speech-to-speech model

The reason the experience can still resemble the default pipeline is that selecting a provider does not change Dograh's orchestration behavior. Sarvam is plugged into the same Pipecat cascade. More importantly, the current Dograh integration has four material latency constraints:

1. It uses Pipecat's released **legacy** `SarvamSTTService`, not `saaras:v3-realtime`. Sarvam's own production guide says the realtime Pipecat service is still on a feature branch, not in the released package.
2. Sarvam is not classified as an STT provider that supplies external turn boundaries, so Dograh runs local Silero VAD plus transcription/speech-timeout turn logic.
3. Local Silero uses `stop_secs=0.2`, while Pipecat's speech-timeout stop strategy defaults to roughly 0.6 seconds. In the common path these can create roughly 0.8 seconds of endpointing/final-transcript wait before the LLM even has a complete user turn.
4. Dograh constructs Sarvam TTS without overriding Pipecat's default sentence aggregation or Sarvam's default `min_buffer_size=50`. The LLM text can therefore be buffered twice before first audio.

“300 ms latency” is usually not an apples-to-apples end-to-end number. It may describe model inference, TTS time-to-first-byte, STT finalization, or endpointing at a tolerated false-cutoff rate. LiveKit's public endpointing benchmark, for example, reports about 295 ms at a **10% false-cutoff operating point** for its best listed model, but this excludes LLM, TTS, media transport, and telephony. Moshi reports about 200 ms on an NVIDIA L4, but that is a co-located, full-duplex native model rather than a PSTN cascade. These figures cannot be compared directly with user-stop-to-first-audible-agent-audio on an Indian phone call.

A credible Dograh objective is not to promise a universal 300 ms. It is to measure each stage, eliminate avoidable serialization and buffering, and establish separate p50/p95 service-level objectives for WebRTC and PSTN. The fastest practical Sarvam path is:

```text
caller audio
  -> nearest media ingress
  -> Saaras v3 realtime partials + Sarvam server VAD
  -> external turn boundaries (no second Silero VAD)
  -> fast conversational LLM with streaming and no hidden reasoning
  -> Bulbul v3 WebSocket TTS in token/clause mode, 15–25 character buffer
  -> codec-matched streaming output with immediate interruption/cancellation
```

Dograh cannot enable that complete path through settings today. It requires an integration change, better latency instrumentation, and—unless Dograh carries Sarvam's feature branch temporarily—a released Pipecat realtime Sarvam service.

## 1. What latency actually means

Every latency claim should state four things: the start event, end event, percentile, and transport. Without all four, it is a demo number rather than an engineering target.

### 1.1 Useful stage metrics

| Metric | Start | End | What it diagnoses |
|---|---|---|---|
| Ingress delay | audio at caller/device | audio at Dograh transport | network, carrier, jitter buffer |
| First partial STT | first speech audio at Dograh | first useful partial transcript | streaming STT responsiveness |
| Endpoint delay | semantic end of user's utterance | turn committed | VAD/semantic endpoint policy |
| STT finalization | detected speech end | final transcript | provider buffering and decoding |
| LLM TTFT | LLM request accepted | first useful token | routing, queueing, model and reasoning |
| TTS TTFB | first speakable text submitted | first audio returned | text aggregation, TTS buffer, synthesis |
| Response latency | user speech end | first agent audio emitted by server | normal server-side voice-agent metric |
| Mouth-to-ear | user speech end | first agent audio audible to caller | response latency plus egress/carrier buffers |
| Barge-in cut | user speech begins over bot | bot audio becomes inaudible | VAD, interruption propagation, queued audio clear |

LiveKit formalizes the cascade as approximately:

```text
end-to-end response latency
  = end-of-utterance delay
  + LLM time to first token
  + TTS time to first byte
  + transport/output overhead
```

Its observability API reports end-of-utterance delay and transcription delay separately, which is the right model for Dograh as well. See [LiveKit observability metrics](https://docs.livekit.io/deploy/observability/data/).

### 1.2 Why averages are not enough

Voice quality is dominated by tails and sequencing errors. Dograh should record p50, p90, p95, and p99 by provider, model, language, region, transport, and workflow version. Averages hide cold connections, provider failover, tool calls, long prompts, TTS sentence boundaries, and carrier jitter. The current QA aggregation in `api/services/workflow/qa/metrics.py` calculates average/max latency and average TTFB, which is not enough to operate a low-latency service.

### 1.3 Why 300 ms claims coexist with 1–3 second calls

The number can be true for one narrow component and still be irrelevant to the perceived turn:

- A VAD can signal silence in 200–300 ms, but the turn manager may wait for a final transcript.
- An LLM can produce a token in 150 ms, but TTS may wait for punctuation or a sentence.
- TTS inference can start in 75 ms, but the vendor number may exclude client buffering and network transit.
- A native speech model can continuously predict audio with 200 ms model latency, while a three-vendor cascade incurs three network hops and three queues.
- WebRTC to a nearby edge can be fast while a PSTN call traverses a carrier, media gateway, 8 kHz codec, WebSocket relay, and a distant cloud region.
- A benchmark may choose an aggressive endpoint threshold that cuts users off 10% of the time. The number is then a point on a quality/latency curve, not a free improvement.

## 2. Dograh's current runtime

### 2.1 Cascade path

`api/services/pipecat/pipeline_builder.py:28` builds:

```text
transport.input
  -> STT
  -> optional voicemail detector
  -> user context/turn aggregator
  -> optional voicemail LLM gate
  -> LLM
  -> workflow callback processor
  -> optional recording router
  -> TTS
  -> transport.output
  -> recording buffer
  -> assistant context aggregator
  -> metrics aggregator
```

This is a sensible modular architecture. Its risk is serialization: if endpointing waits for final STT, the LLM waits for endpointing, and TTS waits for a sentence, every buffer adds directly to the response.

### 2.2 Native realtime path

`api/services/pipecat/pipeline_builder.py:97` also has a distinct realtime path:

```text
transport.input
  -> user context aggregator
  -> realtime speech model (STT + LLM + TTS internally)
  -> callback processor
  -> transport.output
  -> recording/context/metrics
```

Dograh already supports the correct architectural separation for native realtime services such as OpenAI Realtime and Gemini Live. Sarvam's public components are modular STT/LLM/TTS services, so the recommended production Sarvam design still belongs in the cascade path. Open full-duplex models such as Moshi need a new model-specific speech-agent interface, not fake STT and TTS adapters.

### 2.3 Current turn detection

The configuration defaults in `api/schemas/workflow_configurations.py:24` are:

- smart-turn maximum wait: 2.0 s
- interruption/start strategy: `default`
- minimum words if that mode is selected: 3
- provisional VAD pause: 1.5 s
- stop strategy: `transcription`

For non-realtime STT, `api/services/pipecat/run_pipeline.py:150` selects:

- `min_words`: wait for the configured number of transcribed words before starting/interruption;
- `provisional_vad`: pause bot output on local VAD while awaiting transcript confirmation;
- external provider turns: use provider start/stop events;
- default: transcription plus local VAD start strategies.

At turn end, `run_pipeline.py:183` uses external stop events only for providers recognized by `stt_uses_external_turns`; otherwise it uses Smart Turn V3 when selected or Pipecat's speech-timeout strategy. The current external list in `service_factory.py:222` is Deepgram Flux, Dograh Flux-backed languages, and Cartesia Ink-2. Sarvam is not on the list.

`run_pipeline.py:890` always initially creates Silero VAD with `stop_secs=0.2`; the non-external Sarvam path keeps it. Pipecat's speech-timeout strategy defaults to approximately 0.6 seconds and normally waits for a transcript. This explains why very short VAD silence alone does not produce a 200 ms response.

### 2.4 Current Sarvam integration

`api/services/pipecat/service_factory.py:386` creates `SarvamSTTService` using the chosen legacy model and transport input sample rate. The registry exposes `saarika:v2.5` and `saaras:v3`, not `saaras:v3-realtime`.

`service_factory.py:758` creates `SarvamTTSService` with model, voice, language, and pace. It does not expose or set:

- Pipecat `text_aggregation_mode`;
- output `sample_rate` explicitly;
- Sarvam `min_buffer_size`;
- Sarvam `max_chunk_length`.

In the installed Pipecat service, the base TTS aggregation default is sentence mode. Sarvam's own buffer then defaults to 50 characters. Sarvam recommends roughly 15–25 characters for a lower time to first audio. Dograh therefore leaves a major low-latency control unavailable in the UI and runtime.

### 2.5 What “Reasoning Delay” measures

The backend observer in `api/services/pipecat/realtime_feedback_observer.py:229` captures `TTFBMetricsData` only when the processor name contains `LLM`. The UI adapter converts `ttfb_seconds` to milliseconds in `ui/src/components/workflow/conversation/adapters/fromRealtimeFeedback.ts:131`, and `MessageBubble.tsx:30` labels it `Reasoning Delay`.

The accurate label is **LLM first-token delay**. It can include provider routing, connection setup, queueing, prompt ingestion, reasoning tokens that are not streamed, and model inference. It does not include endpointing or TTS. Renaming the label is a small but important observability fix.

### 2.6 The inspected run

One locally inspected published workflow used Sarvam STT, OpenRouter/Qwen, and Sarvam TTS. Its observed turns included:

| Turn | Displayed/observed LLM TTFB | User-stop to bot-start | Non-LLM remainder |
|---|---:|---:|---:|
| 2 | 2.771 s | 4.356 s | about 1.585 s |
| 3 | 0.692 s | 2.454 s | about 1.762 s |

The roughly 1.6–1.8 second remainder is consistent with endpoint/final-transcript waiting plus TTS/text buffering and transport overhead. This is a two-turn diagnostic sample, not a benchmark. It establishes where instrumentation is missing; it does not establish production percentiles.

## 3. What low-latency production systems actually do

### 3.1 Stream every stage

Fast systems do not wait for complete artifacts:

- ingest 10–20 ms audio frames;
- send audio to STT continuously;
- consume partial transcripts;
- predict whether the user is complete;
- stream LLM tokens;
- feed speakable token/clause chunks to TTS;
- stream audio immediately;
- retain cancellation handles for every in-flight stage.

Vapi describes 20 ms audio chunks and parallel audio, transcription, and response streams in [its pipeline engineering article](https://vapi.ai/blog/how-we-built-vapi-s-voice-ai-pipeline-part-1). This is a pipeline scheduling advantage, not a special single model.

### 3.2 Predict and cancel

Waiting for certainty is slow. Strong systems begin reversible work early:

1. On a stable partial transcript, start an LLM request speculatively.
2. If more words arrive, cancel/restart or reconcile the generation.
3. On probable turn completion, allow early TTS for a safe prefix.
4. If the prediction was wrong, cancel generation and clear queued audio.

Vapi calls this “predict and scrap”/greedy inference and emphasizes cancellation throughout [part 2 of its pipeline article](https://vapi.ai/blog/how-we-built-vapi-s-voice-ai-pipeline-part-2). LiveKit exposes preemptive generation and optional preemptive TTS in [turn-detection tuning](https://docs.livekit.io/agents/logic/turns/tuning/). The cost is wasted tokens/synthesis and a correctness risk if cancellation is weak.

### 3.3 Use semantic turn detection, but benchmark the tradeoff

Silence is not the same as conversational completion. “I need a flight from…” may contain a pause that should not trigger a response. Semantic end-of-turn models combine acoustic timing with transcript context. They reduce waiting on completed turns while avoiding some false cutoffs.

However, endpointing has a Pareto frontier. A lower delay usually increases false cutoffs. Dograh should tune separate operating points by language and use case rather than copy one timeout globally.

### 3.4 Interrupt the whole pipeline, not only playback

Good barge-in behavior requires one event to:

- stop output audio immediately;
- clear provider/carrier audio already queued;
- cancel TTS synthesis;
- cancel the LLM request and tools where safe;
- trim unplayed assistant text from conversation history;
- preserve word/audio timestamps so context reflects what the user actually heard.

Vapi describes system-wide interruption below 100 ms and timestamp-based context reconstruction. Vobiz, Exotel, Twilio, and Telnyx all provide clear/mark-style media controls that Dograh should use to flush queued audio, not merely stop creating new TTS frames.

### 3.5 Co-locate, preconnect, and route adaptively

Each provider hop adds network transit, TLS/WebSocket setup, queueing, and variance. Production systems:

- place media and orchestration near the caller/provider region;
- keep STT/TTS WebSockets warm;
- reuse HTTP connections to LLM endpoints;
- prewarm model sessions before the greeting ends;
- avoid cross-region databases and tool calls in the critical audio path;
- select low-latency deployments dynamically;
- maintain fallback chains and circuit breakers.

Vapi's account of [latency-aware Azure deployment routing](https://vapi.ai/blog/how-we-solved-latency-at-vapi) is especially useful: static polling produced stale decisions, while production traffic was used for exploit/explore routing and unhealthy deployments were removed based on dynamic thresholds. Daily reports that co-location alone saved roughly 50–200 ms in one voice-bot exercise; treat the exact number as a case study, not a guarantee. See [Daily's fast voice-bot article](https://www.daily.co/blog/the-worlds-fastest-voice-bot/).

### 3.6 Design the conversation for speech

Model and prompt choices affect latency as much as infrastructure:

- use a conversation-tuned fast model;
- disable hidden reasoning for routine turns;
- keep the active prompt/context compact;
- ask for one or two short spoken clauses, not essays;
- place the most speakable words first;
- avoid markdown, tables, long enumerations, and meta-commentary;
- use deterministic tools and cached data for common answers;
- play a truthful filler only when a long tool call is unavoidable.

Dograh's current user modification disables OpenRouter reasoning for allowed Qwen prefixes. That is directionally correct. It must be benchmarked because provider routing and model selection can still dominate TTFT.

## 4. Framework benchmark evidence

### 4.1 LiveKit EOU benchmark

[LiveKit's open `eot-bench`](https://github.com/livekit/eot-bench) uses real human task-oriented turns in 14 languages. It evaluates causal endpointing models over silence spans of at least 100 ms and reports false-cutoff/delay tradeoffs.

Selected published results at the research date:

| Model | False cutoff at 300 ms | False cutoff at 600 ms | Delay at 5% false cutoff | Delay at 10% false cutoff |
|---|---:|---:|---:|---:|
| LiveKit turn detector v1 | 9.9% | 4.5% | 543 ms | 295 ms |
| Deepgram Flux | 12.9% | 9.9% | 1,151 ms | 548 ms |
| Soniox | not listed | 5.5% | 647 ms | 512 ms |
| ultraVAD | 27.7% | 11.9% | 899 ms | 663 ms |
| Smart Turn 3.2 | 35.2% | 14.8% | 1,051 ms | 739 ms |
| Cartesia Ink-2 | not listed | not listed | 1,056 ms | 911 ms |
| OpenAI GPT Realtime 2 | not listed | not listed | 1,143 ms | 824 ms |
| VAD baseline | 55.6% | 21.7% | 1,600 ms | 1,000 ms |

The correct interpretation is: LiveKit v1 can decide at roughly 295 ms if the application accepts about one false cutoff in ten. This is not a 295 ms voice agent. It excludes STT/LLM/TTS/network time.

Dograh should run this style of curve for Hindi, Bengali, code-switching, short acknowledgements, noisy PSTN, and its actual customer scripts. A single English aggregate would conceal the exact failures relevant to Sarvam.

### 4.2 Pipecat STT benchmark

[Pipecat's `stt-benchmark`](https://github.com/pipecat-ai/stt-benchmark) measures time from user speech stop to final transcript over about 1,000 samples from Smart Turn Data v3.1. Selected results:

| STT/model | Semantic WER | Median finalization | p95 | p99 |
|---|---:|---:|---:|---:|
| Deepgram Nova-3 semantic | 1.71 | 247 ms | 298 ms | 326 ms |
| Soniox | 1.25 | 249 ms | 281 ms | 310 ms |
| AssemblyAI Universal 3.5 Pro | 1.44 | 282 ms | 354 ms | 393 ms |
| Cartesia Ink-2 | 1.47 | 299 ms | 328 ms | 1,584 ms |
| OpenAI GPT-4o Transcribe | 3.24 | 637 ms | 965 ms | 1,655 ms |
| Azure | 1.21 | 1,016 ms | 1,345 ms | 1,791 ms |

This benchmark demonstrates why Dograh needs percentiles: Cartesia's median is competitive while its listed p99 is much worse. It also measures final transcript latency, not complete response latency. Sarvam should be added to the same harness with Bengali/Hindi and 8 kHz telephony audio.

[Pipecat's latency-tuning guide](https://docs.pipecat.ai/pipecat/fundamentals/stt-latency-tuning) and [metrics documentation](https://docs.pipecat.ai/pipecat/fundamentals/metrics) should be used as the implementation baseline.

### 4.3 Pipecat evals

The Pipecat repository includes an evaluation harness that runs YAML scenarios against a real bot over eval transports/RTVI, synthesizes audio, and supports assertions for text, latency, function calls, deterministic checks, and LLM judging. Suites can run in parallel. Dograh should extend this pattern rather than create a transcript-only unit-test suite. See the [Pipecat repository's agent/eval documentation](https://github.com/pipecat-ai/pipecat/blob/main/AGENTS.md).

## 5. Voice-agent evaluation repositories

No single benchmark covers endpointing, business-task correctness, natural speech, tools, safety, barge-in, and PSTN latency. Dograh needs multiple layers.

### 5.1 EVA: closest to an end-to-end system benchmark

[ServiceNow EVA](https://github.com/ServiceNow/eva) evaluates live voice agents with bot-to-bot WebSocket conversations, deterministic tools, recorded audio/transcripts/logs, and validators. The accompanying [EVA paper](https://arxiv.org/abs/2605.13841) describes 213 scenarios across three enterprise domains and 12 systems.

It splits accuracy and experience and includes task completion, faithfulness, speech fidelity, turn taking, conciseness/progression, response speed, WER, tool validity, key-entity handling, and TTS quality. The reported result that no evaluated system exceeded 0.5 on both Pass@1 axes is a warning: a polished demo says little about repeated-call reliability.

Dograh should adopt EVA's core structure:

```text
scenario + deterministic tools + simulated caller audio
  -> live Dograh run
  -> per-turn timing/audio/transcript/tool trace
  -> deterministic validators + limited LLM judges
  -> Pass@1 and repeated-run reliability report
```

### 5.2 VoiceAgentBench: useful Indic coverage, not a live-call benchmark

[VoiceAgentBench](https://github.com/ola-krutrim/VoiceAgentBench) contains roughly 5,500–6,000 synthetic spoken queries across English, Hindi, Bengali, Marathi, Tamil, Telugu, and Malayalam, including tool workflows and safety. This language coverage is directly relevant to Sarvam.

Its limitation is that it is primarily a static benchmark. It does not reproduce endpoint timing, carrier jitter, barge-in, or sustained multi-turn live calls. Use its prompts/tasks as content coverage inside a Dograh live harness.

### 5.3 VoiceBench and VoiceAssistant-Eval

[VoiceBench](https://github.com/MatthewCYM/VoiceBench) covers spoken QA, reasoning, instruction following, and safety using human and synthesized audio. It is strong for model capability and weak for endpointing/latency.

[VoiceAssistant-Eval](https://github.com/mathllm/VoiceAssistant-Eval) contains 10,497 examples across 13 listening, speaking, and viewing categories, including voice multi-turn behavior. It can broaden capability testing but still needs a Dograh transport/latency wrapper.

### 5.4 Recommended Dograh evaluation stack

| Layer | Purpose | Primary source/material |
|---|---|---|
| Unit/component | serializers, cancellation, frame order, config | existing Dograh/Pipecat tests |
| STT benchmark | WER plus stop-to-final and first-partial percentiles | Pipecat STT benchmark + Indic audio |
| Endpoint benchmark | false-cutoff/delay Pareto curves | LiveKit eot-bench + Dograh call audio |
| Scenario benchmark | tools, task completion, policy, handoff | EVA structure + VoiceAgentBench scenarios |
| Audio quality | intelligibility, pronunciation, clipping, echo | VoiceBench-style tasks + human MOS sampling |
| Load/chaos | concurrency, cold starts, failover, packet loss | controlled PSTN/WebRTC load tests |
| Production canary | real p50/p95 by provider/region/version | Dograh runtime telemetry |

## 6. Vendor case studies

### 6.1 Vapi

Vapi is useful because it publicly describes orchestration rather than claiming one magical model:

- 20 ms audio chunking;
- continuous partial transcription;
- hybrid endpoint prediction;
- speculative LLM requests and cancellation;
- streaming TTS;
- interruption propagated across all stages;
- timestamp-aware repair of conversation context;
- production latency-aware model deployment routing.

Its [pipeline configuration docs](https://docs.vapi.ai/customization/voice-pipeline-configuration) expose endpointing and interruption controls. The transferable lesson for Dograh is control-plane sophistication: aggressively overlap reversible work and make every stage observable/cancellable.

### 6.2 Retell

Retell describes a conventional streaming STT/turn-taking/LLM/TTS pipeline with partial transcripts, semantic endpointing, interruptions, and backchannels. Its public material often cites around 600 ms, but such figures must be treated as vendor measurements unless start/end events, route, model, language, and percentiles are provided. See [Retell's architecture explanation](https://www.retellai.com/blog/how-real-time-voice-ai-works-stt-llm-tts) and [latency checking documentation](https://docs.retellai.com/reliability/check-actual-latency).

The important product lesson is that turn-taking is a first-class service, not a fixed silence timeout hidden inside STT.

### 6.3 ElevenLabs

ElevenLabs publishes latency controls around model choice, regions, streaming, text buffering, and conversation flow. Flash model inference around 75 ms is a model-side claim and excludes network/client buffering. Its [latency concepts](https://elevenlabs.io/docs/eleven-api/concepts/latency), [optimization guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization), and [conversation-flow docs](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow) show the same themes: choose nearby regions, stream, reduce buffers, and explicitly tune turn behavior.

### 6.4 Daily/WebRTC

Daily argues that client-to-edge WebRTC is preferable to a long public WebSocket for browser media because UDP media avoids TCP head-of-line blocking and benefits from nearby media edges; server-to-server WebSockets remain useful inside a controlled backend. See [Daily's WebRTC transport discussion](https://www.daily.co/blog/you-dont-need-a-webrtc-server-for-your-voice-agents/).

Dograh already supports WebRTC and telephony. It should not use one latency target for both. The browser route can preserve 16 kHz audio and a nearby edge; the phone route inherits carrier geography and often 8 kHz μ-law.

## 7. Telephony: Vobiz, Exotel, and Dograh

Telephony providers carry media and call-control events. They do not replace the STT/LLM/TTS pipeline. Their contribution to latency is frame size, codec/transcoding, WebSocket geography, jitter/queues, and the ability to clear buffered audio.

### 7.1 Provider comparison

| Provider | Documented media behavior | Interruption controls | Dograh status |
|---|---|---|---|
| Vobiz | bidirectional WS; L16 8/16 kHz or μ-law 8 kHz; typical 20 ms examples | `playAudio`, `clearAudio`, checkpoint/mark behavior | implemented, fixed μ-law 8 kHz |
| Exotel AgentStream | raw linear16 PCM, 8/16/24 kHz; audio messages roughly every 100 ms; Mumbai/Singapore endpoints | `clear`, `mark`; start greeting can be parallel | not implemented |
| Twilio Media Streams | bidirectional WS; μ-law 8 kHz mono | `clear`, `mark` | implemented, 8 kHz |
| Telnyx | PCMU/PCMA/G722/Opus/AMR-WB/L16 choices; warns about transcoding | clear/mark equivalents | implemented; Dograh transport currently 8 kHz/PCMU-oriented |
| Vonage | binary L16 at 8/16/24 kHz | transport/call controls | implemented at 16 kHz |

Sources: [Vobiz Stream XML](https://docs.vobiz.ai/xml/stream), [Vobiz Bun media-stream example](https://docs.vobiz.ai/examples/vobiz-bun-media-stream), [Exotel AgentStream guide](https://developer.exotel.com/docs/agentstream/developer-guide), [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams), [Telnyx media streaming](https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming), and [Vonage WebSocket audio](https://developer.vonage.com/en/voice/voice-api/concepts/websockets).

### 7.2 Dograh's Vobiz path

Dograh registers Vobiz in `api/services/telephony/providers/__init__.py`. `providers/vobiz/__init__.py:145` declares an 8 kHz transport. `providers/vobiz/transport.py:59` constructs the serializer at 8 kHz, and generated Vobiz XML explicitly requests `audio/x-mulaw;rate=8000`.

Vobiz now documents linear PCM at 8/16 kHz as well as μ-law 8 kHz, so Dograh could add a configurable 16 kHz mode where the phone route and account support it. That may improve STT quality, but it does not automatically reduce latency; larger audio and transcoding choices must be measured. Avoiding needless conversions matters more than choosing the highest nominal rate.

### 7.3 Exotel opportunity and constraints

There is no Exotel provider in Dograh's provider registry. Supporting Exotel means implementing its provider config, signed callbacks/auth, AgentStream WebSocket lifecycle, serializer, clear/mark semantics, region selection, tests, and UI/config registry entries.

Exotel's roughly 100 ms input frame cadence is already a non-trivial barge-in granularity compared with 20 ms media streams. This is not necessarily fatal, but it must appear in the latency budget. Choose the Mumbai endpoint for an India-hosted Dograh/Sarvam deployment, match an accepted PCM rate, and begin backend/STT/TTS session warmup while the greeting or call setup is in progress.

### 7.4 Telephony latency checklist

- Put Dograh media workers in the provider's nearest supported region.
- Request a codec/sample rate accepted natively by both the carrier and STT where possible.
- Keep frame duration small and bounded; measure jitter and late frames.
- Do not transcode multiple times.
- Use provider clear/mark commands on every interruption.
- Record server output time and provider acknowledgement/mark time separately.
- Measure a loopback/reference call through the real PSTN, not only a WebSocket simulator.
- Test mobile networks, packet loss, DTMF, short acknowledgements, silence, echo, and double talk.

## 8. What Sarvam is doing

### 8.1 Hosted Voice Agents

Sarvam's hosted product uses the familiar architecture:

```text
phone/SIP/web
  -> STT + VAD/turn management
  -> conversation harness, context and tools
  -> LLM
  -> TTS
  -> transport
```

The harness adds language switching, pronunciation, voicemail, hold/silence handling, barge-in, campaigns, and handoff. Sarvam claims 20,000+ concurrent calls and sub-second latency and attributes it to self-hosting and co-locating models. The [runtime architecture page](https://docs.sarvam.ai/conversations/build/run-time) does not provide a reproducible workload or per-stage p50/p95/p99, so these are product/vendor claims rather than a benchmark.

Sarvam supports its own or bring-your-own telephony, including Exotel, Twilio, Smartflo, Pulse, Intalk, and Vobiz. See [Sarvam telephony deployment](https://docs.sarvam.ai/conversations/deploy/telephony).

### 8.2 Realtime versus legacy Saaras

The public realtime endpoint is `wss://api.sarvam.ai/speech-to-text-realtime/ws` with `saaras:v3-realtime`. It supports:

- partial and final transcripts;
- server speech-start and speech-end events;
- server-VAD or manual endpointing;
- millisecond threshold/silence/minimum-speech controls;
- live configuration updates;
- `fast`, `balanced`, and `simulated` stream modes;
- automatic language detection;
- linear16/linear32/μ-law/A-law input at 8 or 16 kHz.

See [Sarvam realtime STT](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming).

The legacy `saaras:v3` WebSocket is final-only per utterance, has coarser VAD behavior, and requires reconnecting for configuration changes. [Sarvam's API selection guide](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/which-api-to-use) distinguishes these products.

### 8.3 Important current Pipecat limitation

[Sarvam's Pipecat production guide](https://docs.sarvam.ai/api/integration/pipecat-production-guide) states that the released Pipecat package still has the legacy service and that `SarvamRealtimeSTTService` lives on a feature branch. It recommends, once available:

```text
Saaras realtime server VAD
  -> ExternalUserTurnStartStrategy
  -> ExternalUserTurnStopStrategy
  -> no Silero VAD
```

It also documents a 500 ms client-side audio chunk in realtime `fast` mode, and about one second in `balanced`/`simulated`. This means even the forthcoming Pipecat path does not support a defensible 300 ms user-stop-to-response claim without changing/validating that buffering. Dograh should inspect and benchmark the eventual released implementation rather than assume “realtime” means low-latency at every boundary.

### 8.4 Bulbul v3

Bulbul v3 WebSocket TTS streams linear16 audio, supports more than 30 voices and 11 languages, and defaults to 24 kHz. The current guide recommends reducing its default 50-character `min_buffer_size` toward 15–25 for faster first audio. The output must be converted to μ-law for an 8 kHz phone provider; realtime Saaras can accept μ-law input natively.

Sources: [Bulbul model](https://docs.sarvam.ai/api/getting-started/models/bulbul) and [streaming TTS API](https://docs.sarvam.ai/api-reference/text-to-speech/stream).

### 8.5 Sarvam-105B

Sarvam exposes `sarvam-105b` and conversation-tuned `sarvam-105b-conversations` through an OpenAI-compatible streaming chat endpoint. Its model page describes a 105B+ mixture-of-experts model, 128K context, and 10 major Indian languages plus English. The conversation variant is the logical Sarvam-native candidate to benchmark against the current OpenRouter Qwen route. See [Sarvam-105B](https://docs.sarvam.ai/api/getting-started/models/sarvam-105b).

The test must compare useful first spoken token, answer quality, tool correctness, concurrency, and p95—not only average text TTFT.

### 8.6 Self-hosting

Sarvam documents self-hosted Saaras v3 realtime/streaming and Bulbul v3 through AWS Marketplace/SageMaker in a customer's VPC. That can eliminate public provider hops and improve privacy/co-location. It does **not** publicly document self-hosting the complete hosted Voice Agents harness, campaigns, and telephony control plane. See [Sarvam self-hosted models](https://docs.sarvam.ai/api/self-hosted/introduction).

### 8.7 What Sarvam does not publish

- reproducible end-to-end p50/p95/p99 by transport/language;
- realtime Saaras TTFS distributions;
- workload/hardware behind 20,000+ concurrency;
- exact batching, autoscaling, and queueing;
- source for the hosted harness;
- a public arbitrary-component swap interface inside hosted Voice Agents;
- evidence that the complete Voice Agents product can run in a customer VPC.

Dograh should treat “sub-second” and “sub-250 ms first byte” as targets to verify, not facts to paste into an SLO.

## 9. Open and Hugging Face speech-to-speech options

These systems are useful experiments, but “open” does not mean “drop-in,” “commercially licensed,” “Indic-ready,” or “telephony-ready.”

### 9.1 Comparison

| System | Architecture | Languages / license | Published latency | Practical Dograh fit |
|---|---|---|---|---|
| [Kyutai Moshi/Mimi](https://github.com/kyutai-labs/moshi) | full-duplex audio/text-token model; 7B temporal transformer; Mimi codec | English; code MIT/Apache, weights CC-BY 4.0 | theoretical 160 ms; as low as ~200 ms on L4 | best first full-duplex adapter experiment; weak tools/complex tasks |
| [MiniCPM-o 4.5](https://github.com/OpenBMB/MiniCPM-V) | 9B omni full-duplex; SigLIP2, Whisper, CosyVoice2, Qwen3 | 30+ claimed; Apache-2.0 | no comparable e2e number | experimental; high GPU needs and documented speech instability |
| [Qwen2.5-Omni](https://github.com/QwenLM/Qwen2.5-Omni) | 3B/7B Thinker-Talker, streaming multimodal input/output | multilingual; Apache-2.0 | no comparable e2e number | experimental monolithic speech-agent route |
| [GLM-4-Voice](https://github.com/zai-org/GLM-4-Voice) | separate tokenizer, 9B speech LM, streaming decoder | Chinese/English; code Apache, separate weight license | no comparable e2e number | most visibly modular, but not Indic and not standard STT/LLM/TTS |
| [SeamlessStreaming](https://github.com/facebookresearch/seamless_communication) | simultaneous speech translation | broad multilingual; CC-BY-NC-4.0 | no clear e2e number | translation sidecar, not general commercial agent runtime |
| [Kyutai delayed streams](https://github.com/kyutai-labs/delayed-streams-modeling) | swappable streaming STT/TTS services | model-dependent | component-specific | valuable reference for token-stream TTS and Rust serving |
| [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) | 100M CPU streaming TTS | six European languages; MIT | about 200 ms first audio on cited setup | low-risk non-Indic TTS experiment |

### 9.2 Moshi/Mimi

Moshi is genuinely full duplex: user and assistant audio streams coexist, and the model predicts text/inner monologue alongside speech tokens. Mimi runs 24 kHz audio at 12.5 frames/s with about 80 ms codec frame latency. The [Moshi paper](https://arxiv.org/abs/2410.00037) and [Moshika model card](https://huggingface.co/kyutai/moshika-pytorch-bf16) report theoretical 160 ms and practical latency as low as roughly 200 ms on an NVIDIA L4.

Those numbers are credible for the model setup but do not include PSTN/carrier integration. Moshi is English-only, the reference card says it has limited complex-task ability and cannot use tools, and PyTorch deployment needs roughly 24 GB GPU. The Rust/Candle backend is the most production-oriented option.

### 9.3 MiniCPM-o and Qwen2.5-Omni

Both combine audio understanding and speech generation inside a trained multimodal system. Their internal Whisper/CosyVoice/Qwen or Thinker/Talker parts are not documented as independently replaceable plugins. Dograh should treat each as a monolithic provider behind an experimental adapter. MiniCPM-o 4.5's official repository describes full-duplex behavior as experimental and documents pronunciation/mixed-language and remote-demo latency issues. Qwen publishes streaming implementations but no comparable end-to-end turn-latency number.

### 9.4 GLM-4-Voice

GLM-4-Voice is the clearest modular research design: a Whisper/VQ tokenizer, a 9B speech-language model, and a CosyVoice-derived decoder downloaded as separate artifacts. The decoder can begin after roughly 10 audio tokens. Those interfaces are still mutually trained and token-vocabulary-coupled, so replacing a piece is not arbitrary. Its Chinese/English coverage makes it a poor primary Sarvam alternative.

### 9.5 SeamlessStreaming

Meta's model is a simultaneous speech-translation system rather than an agent with tools and policy. Its non-commercial license is also a production blocker for many Dograh uses. It is appropriate only as a translation route where the license is accepted.

### 9.6 Correct Dograh abstraction for native models

Do not force native models into the existing `STTService` and `TTSService` interfaces. Add a separate experimental interface:

```python
class SpeechAgentSession(Protocol):
    async def input_audio(self, chunk: bytes) -> None: ...
    def output_audio(self) -> AsyncIterator[bytes]: ...
    def transcript_events(self) -> AsyncIterator[TranscriptEvent]: ...
    async def interrupt(self) -> None: ...
    async def close(self) -> None: ...
```

The concrete adapter must also report input/output codec and rate, VAD/speech events, backpressure, jitter, cancellation acknowledgement, word/audio timestamps, model license, hardware use, and concurrent-session capacity.

## 10. Dograh gap analysis

| Capability | Dograh today | Low-latency requirement | Gap |
|---|---|---|---|
| Sarvam STT | legacy `SarvamSTTService`, final-only model choices | realtime partials/server VAD | integration/package gap |
| Turn end | local VAD + transcript/speech timeout for Sarvam | one authoritative semantic/provider endpoint | duplicate/sequential waiting |
| TTS start | sentence aggregation + default Sarvam text buffer | token/clause streaming, small configurable buffer | double buffering |
| LLM | streaming providers; Qwen reasoning disable added | latency-aware model/region route and cancellation | no adaptive route/SLO policy |
| Preemptive generation | normal committed-turn cascade | start on stable partial, cancel/reconcile | absent |
| Barge-in | Pipecat strategies and provider transport | clear carrier queue + cancel every stage + history repair | needs end-to-end verification |
| Metrics | LLM TTFB and aggregate user-bot latency | per-stage p50/p95/p99, transport timestamps | insufficient granularity |
| UI | `Reasoning Delay` | precise metric names/timeline | misleading label |
| Vobiz | fixed 8 kHz μ-law | configurable codec/rate where useful | available provider features unused |
| Exotel | absent | India-region AgentStream adapter | provider implementation needed |
| Native S2S | realtime pipeline for selected commercial models | generic full-duplex experimental provider | no open-model adapter abstraction |
| Evals | tests and simple QA aggregation | live audio scenarios, endpoint curves, load/chaos | no unified voice-agent eval system |

## 11. Prioritized implementation plan

### Phase 0: establish truth before tuning

1. Add a per-turn trace ID propagated through transport, STT, turn manager, LLM, TTS, and output.
2. Timestamp audio ingress, speech start/end, first/stable/final transcript, turn commit, LLM request/first token/completion, first text sent to TTS, first audio from TTS, first audio submitted to transport, clear/mark events, and cancellation acknowledgements.
3. Emit histograms with p50/p90/p95/p99, tagged by workflow version, provider/model, language, region, call type, codec, and cold/warm connection.
4. Rename `Reasoning Delay` to `LLM first-token delay`; show endpoint, STT-final, TTS-first-audio, and total response separately.
5. Build a 100–1,000 utterance Bengali/Hindi/English-code-switch corpus in both clean 16 kHz and realistic 8 kHz phone audio.
6. Establish current-baseline reports for WebRTC, Vobiz PSTN, and a controlled loopback.

**Exit criterion:** a slow call can be explained from one trace without reading raw container logs.

### Phase 1: remove safe avoidable buffers

1. Expose Sarvam TTS `min_buffer_size`, `max_chunk_length`, output rate, and Pipecat aggregation mode in typed backend configuration and UI.
2. Benchmark sentence vs clause/token aggregation; begin around 20 characters, then tune pronunciation and glitches.
3. Match TTS output rate to the transport and perform exactly one required codec conversion.
4. Reuse/preconnect provider sessions before the first user turn.
5. Enforce short spoken replies and keep active prompts/tool schemas compact.
6. Benchmark OpenRouter Qwen against `sarvam-105b-conversations` and at least one known fast small model using useful-first-token and task-quality percentiles.

**Risk:** overly small TTS chunks can harm prosody/pronunciation. Gate by language/voice and retain rollback.

### Phase 2: integrate Saaras realtime correctly

1. Wait for/review the released Pipecat realtime Sarvam service, or carry the feature branch behind an explicit experimental flag with upstream-drift tests.
2. Add `saaras:v3-realtime` configuration: stream type, endpointing, VAD threshold, silence duration, minimum speech duration, language, encoding, and rate.
3. Classify realtime Sarvam as external turns.
4. Use `ExternalUserTurnStartStrategy` and `ExternalUserTurnStopStrategy`; remove Silero for that route.
5. Drive barge-in from `vad.speech_start`, with an optional transcript-word gate for noisy environments.
6. Measure the documented 500 ms client chunk and reduce it only if the provider/protocol safely permits.
7. Add legacy-vs-realtime A/B tests and automatic fallback that is visible in metrics.

**Exit criterion:** no duplicate VAD, partial transcripts visible, clear per-stage timing, and p95 correctness/latency meets the chosen language-specific operating point.

### Phase 3: overlap and cancel work

1. Start an LLM request on a sufficiently stable partial transcript.
2. Cancel/restart it when the partial changes materially.
3. Permit preemptive TTS only for safe, stable prefixes.
4. Keep exact text-to-audio timestamps and commit assistant context only for audio actually played.
5. On barge-in, clear transport audio and cancel TTS/LLM/tools in one coordinated operation.
6. Add budget and correctness guards because speculation consumes extra tokens and can expose wrong audio.

**Exit criterion:** measurable p50 improvement without a significant increase in false starts, cutoffs, incorrect context, or spend.

### Phase 4: telephony and regional routing

1. Add Vobiz codec/rate configuration and benchmark 8 kHz μ-law versus supported linear16 paths.
2. Implement Exotel AgentStream with Mumbai/Singapore endpoint selection and clear/mark handling.
3. Deploy media workers near telephony ingress and Sarvam/model endpoints.
4. Keep warm pools and circuit breakers per provider region.
5. Add latency-aware exploit/explore routing with quality and cost constraints; never route solely on average TTFT.
6. Run real PSTN load/chaos tests at target concurrency.

### Phase 5: native full-duplex experiments

1. Add the `SpeechAgentSession` interface behind an experimental feature flag.
2. Integrate Moshi's production-oriented Rust backend first.
3. Add 8 kHz μ-law/PCM to 24 kHz internal conversion, echo control, jitter/backpressure, and interruption tracing.
4. Compare against the optimized Sarvam cascade on latency, Indic coverage, tools, correctness, GPU/session, and operational complexity.
5. Keep GLM/Qwen/MiniCPM adapters separate; do not promise arbitrary component swapping.

For Dograh's current India/Bengali use case, the optimized Sarvam cascade should remain the production track. Open native models are a research track until they meet language, tools, license, and concurrency requirements.

## 12. Target setting

Do not set a 300 ms universal target from public demos. First collect a baseline, then create stage budgets. A useful initial budget template is:

| Stage | WebRTC target direction | PSTN target direction |
|---|---|---|
| endpoint/final transcript | minimize on a measured false-cutoff curve | allow extra carrier/frame variance |
| LLM useful first token | choose a fast warm regional route | same, with more tail budget |
| TTS first audio | token/clause streaming and small buffer | codec-matched streaming |
| server output overhead | tens of milliseconds, no hidden queue | tens of milliseconds plus media frame cadence |
| total | report p50 and p95, not one promise | separate by telephony provider/region |

After Phases 0–2, a sub-second p50 may be feasible for short, warm, regional WebRTC turns and possibly for well-tuned PSTN routes, but it must be demonstrated. A 300 ms PSTN mouth-to-ear SLO with the documented Sarvam/Pipecat 500 ms realtime chunk is internally inconsistent. The engineering goal should be a fast, natural, interruption-safe distribution—not a marketing number.

## 13. Immediate answer for the current agent

The fastest honest next configuration/engineering sequence is:

1. Keep Sarvam `bulbul:v3` and the desired Bengali voice; the missing voice-selection concern is not evidence that Dograh default TTS is being used.
2. Keep hidden Qwen reasoning disabled, but benchmark a faster conversation model and Sarvam's conversation-tuned model.
3. Expose and lower Sarvam TTS buffering and change sentence aggregation to a measured clause/token mode.
4. Instrument endpoint/STT/TTS separately so the UI stops attributing all waiting to “reasoning.”
5. Integrate `saaras:v3-realtime` only with Sarvam server VAD/external turns and no parallel Silero.
6. Co-locate Dograh, Sarvam endpoints, and the Vobiz/Exotel media region; warm connections at call setup.
7. Add speculation/cancellation after the deterministic buffer fixes are measured.

That is how Dograh can approach the responsiveness of Vapi-class systems while keeping Sarvam's Indian-language speech stack: not through one hidden setting, but through correct realtime STT integration, one authoritative turn detector, streaming TTS, cancellation, regional routing, and evidence-grade metrics.

## 14. Source index

### Frameworks and benchmarks

- [LiveKit observability](https://docs.livekit.io/deploy/observability/data/)
- [LiveKit turn tuning](https://docs.livekit.io/agents/logic/turns/tuning/)
- [LiveKit pipeline model choices](https://docs.livekit.io/agents/models/pipelines/)
- [LiveKit eot-bench](https://github.com/livekit/eot-bench)
- [Pipecat metrics](https://docs.pipecat.ai/pipecat/fundamentals/metrics)
- [Pipecat STT latency tuning](https://docs.pipecat.ai/pipecat/fundamentals/stt-latency-tuning)
- [Pipecat STT benchmark](https://github.com/pipecat-ai/stt-benchmark)
- [Pipecat user-turn strategies](https://docs.pipecat.ai/api-reference/server/utilities/turn-management/user-turn-strategies)

### Evaluation

- [EVA](https://github.com/ServiceNow/eva) and [paper](https://arxiv.org/abs/2605.13841)
- [VoiceAgentBench](https://github.com/ola-krutrim/VoiceAgentBench)
- [VoiceBench](https://github.com/MatthewCYM/VoiceBench)
- [VoiceAssistant-Eval](https://github.com/mathllm/VoiceAssistant-Eval)

### Production systems

- [Vapi pipeline part 1](https://vapi.ai/blog/how-we-built-vapi-s-voice-ai-pipeline-part-1)
- [Vapi pipeline part 2](https://vapi.ai/blog/how-we-built-vapi-s-voice-ai-pipeline-part-2)
- [Vapi latency routing](https://vapi.ai/blog/how-we-solved-latency-at-vapi)
- [Retell voice pipeline](https://www.retellai.com/blog/how-real-time-voice-ai-works-stt-llm-tts)
- [ElevenLabs latency concepts](https://elevenlabs.io/docs/eleven-api/concepts/latency)
- [Daily WebRTC transport discussion](https://www.daily.co/blog/you-dont-need-a-webrtc-server-for-your-voice-agents/)

### Telephony

- [Vobiz Stream](https://docs.vobiz.ai/xml/stream)
- [Exotel AgentStream](https://developer.exotel.com/docs/agentstream/developer-guide)
- [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams)
- [Telnyx media streaming](https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming)
- [Vonage WebSocket audio](https://developer.vonage.com/en/voice/voice-api/concepts/websockets)

### Sarvam

- [Voice Agents runtime](https://docs.sarvam.ai/conversations/build/run-time)
- [Realtime STT](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming)
- [STT API selection](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/which-api-to-use)
- [Pipecat production guide](https://docs.sarvam.ai/api/integration/pipecat-production-guide)
- [Bulbul](https://docs.sarvam.ai/api/getting-started/models/bulbul)
- [Sarvam-105B](https://docs.sarvam.ai/api/getting-started/models/sarvam-105b)
- [Self-hosted models](https://docs.sarvam.ai/api/self-hosted/introduction)

### Open speech models

- [Moshi](https://github.com/kyutai-labs/moshi)
- [MiniCPM-o](https://github.com/OpenBMB/MiniCPM-V)
- [Qwen2.5-Omni](https://github.com/QwenLM/Qwen2.5-Omni)
- [GLM-4-Voice](https://github.com/zai-org/GLM-4-Voice)
- [Seamless Communication](https://github.com/facebookresearch/seamless_communication)
- [Kyutai delayed streams](https://github.com/kyutai-labs/delayed-streams-modeling)
