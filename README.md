# CUE desk UI

Static HTML front-end for the CUE live director. Serve `index.html`
from any host and point a WebSocket backend at `/ws` on the same
origin. Everything else — Deepgram, the semantic parser, the policy
director, roster — is on the backend side.

The page falls back to a scripted demo if no server answers within
1.5 seconds, so you can open the file directly (`file://…`) and see
what it looks like without a backend.

## Serving locally

Anything that serves static files works. For example:

    python -m http.server 8765

Then open <http://127.0.0.1:8765>. On the same origin, the page
connects to `ws://127.0.0.1:8765/ws`.

## WebSocket contract

The page speaks JSON both ways. Message types are namespaced by a
top-level `type` string.

### Messages the server sends → the desk

Every message is a JSON object of the form `{"type": "…", …}`. The
desk tolerates snake_case AND camelCase on payload fields; use
whichever is easier on your side.

| type | payload | when to send |
|---|---|---|
| `source` | `{source: "mic" \| "fixture"}` | on connect. `fixture` shows a small "Scripted demo" chip |
| `directing` | `{enabled: bool}` | on connect. `false` hides the "CUE is directing" mode line hint |
| `caption_status` | `{connected: bool, label?: string}` | on connect + whenever ASR reconnects. The desk flashes a red alarm if `connected` goes false while captions were previously heard |
| `deepgram_config` | `{model, language, endpointing_ms, utterance_end_ms, keyterms, ...}` | on connect. Populates the Deepgram row + the Status pane |
| `roster` | `{guests: [{name, role}]}` | on connect. Real guests only, no aliases. Names are highlighted in captions |
| `mode` | `{mode: "auto" \| "assist" \| "manual" \| "hold"}` | on connect + whenever the operator or server changes mode |
| `latency` | `{first_ms, final_ms}` | after each utterance ends |
| `caption_provisional` | `{text}` | every Deepgram interim result |
| `caption_final` | `{text}` | every Deepgram final result |
| `deepgram_result` | `{text, words?, is_final?, speech_final?, confidence?, ...}` | raw Deepgram feed — populates the "Deepgram" tab |
| `decision` | `{record: DecisionRecord}` | one per director decision. See DecisionRecord below |
| `camera_state` | `{camera, ready: bool, note?: string}` | any time a camera becomes healthy / unhealthy |
| `prepare` | `{camera}` | show the "Next up" chip |
| `stand_down` | *(no payload)* | clear the "Next up" chip |

#### DecisionRecord

The `decision` message carries the record verbatim inside `.record`.
Fields the desk reads:

```jsonc
{
  "decision_seq": 42,           // used to correlate rate / suggest replies
  "action": "TAKE" | "STAY" | "SLATE",
  "camera_id": "CAM-HOST" | "CAM-GUEST" | "CAM-WIDE",
  "reason": "manual TAKE CAM-HOST",  // start with "manual" → shown as operator take
  "plain_reason": "You took the wide shot",  // one-sentence English, shown to producer
  "transcript_span": {
    "text": "Please welcome Sarah Tan."
  },
  "cue_summary": {
    "target_guest_ids": ["sarah"],
    "temporal_intent": "NOW" | "FUTURE" | "PAST" | "NEGATED" | "UNCERTAIN",
    "scope": "single" | "group" | "role" | "none"
  },
  "latencies_ms": {
    "final_ms": 315,            // Deepgram commit latency
    "cue_decide_ms": 240        // parser + policy latency
  }
}
```

`camera_id` uses SCREAMING-KEBAB by convention. Everything else is
snake_case; the desk also accepts camelCase (`cameraId`, `plainReason`,
`latenciesMs`, `transcriptSpan.text`, `cueSummary.evidenceText`).

### Messages the desk sends → the server

| type | payload | fires when |
|---|---|---|
| `manual_take` | `{camera: "CAM-HOST" \| ...}` | operator clicks a camera tile, or presses `1` / `2` / `3` / `W` |
| `set_mode` | `{mode: "manual" \| "assist" \| "auto"}` | operator toggles Take-over / Suggest / Auto (also `H` / `S` / `A`) |
| `accept_suggestion` | `{decision_seq}` | in ASSIST mode: operator clicks "Take it" or hits Space |
| `skip_suggestion` | `{decision_seq}` | operator clicks Skip / Esc, or the 6 s timer runs out |
| `rate` | `{decision_seq, right: bool \| null}` | operator taps Right call / Wrong call under the newest CUE decision (null clears the rating) |

The desk always assumes optimistic acknowledgement — it applies the
new state locally before the server confirms. The server should echo
a matching `mode` / `decision` back so both sides stay in sync on
reconnect.

## Keyboard shortcuts

| key | action |
|---|---|
| `1` | Cut to host |
| `2` | Cut to guest |
| `3` / `W` / `0` | Cut to wide |
| `H` | Take over (manual) |
| `S` | Suggest mode |
| `A` | Hand back to auto |
| `Space` | Accept the current suggestion |
| `Esc` | Skip the current suggestion |
| `Backspace` | Return to the previous camera |

## Rendering notes

- The main video and the three camera tiles all pull from
  `navigator.mediaDevices.getUserMedia({ video, audio })` for now —
  they share the same MediaStream. Swap this out for LiveKit / WebRTC
  in production.
- The mic waveform (five bars in the bottom bar) is driven client-side
  by a `WebAudio` AnalyserNode. It does not require the backend.
- The scripted demo (which runs when no server answers) never shows
  latency numbers; only real backend messages populate those.

## License

Prototype for CUE. No public license — ask the author before reuse.
