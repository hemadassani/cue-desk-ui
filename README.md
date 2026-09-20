# CUE desk UI

Static HTML front-end for the CUE live director. Serve `index.html`
from any host and point a WebSocket backend at `/ws` on the same
origin. Everything else — Deepgram, the semantic parser, the policy
director, roster — is on the backend side.

Three pages, all static, all sharing one set of CSS tokens:

| page | who opens it | what it does |
|---|---|---|
| `index.html` | the operator | the live directing desk |
| `signup.html` | each guest, on their phone | name + two reference photos |
| `dashboard.html` | the production team | every participant, and which camera they are on |

The page falls back to a scripted demo if no server answers within
1.5 seconds, so you can open the file directly (`file://…`) and see
what it looks like without a backend.

## Serving locally

Anything that serves static files works. For example:

    python -m http.server 8765

Then open <http://127.0.0.1:8765>. On the same origin, the page
connects to `ws://127.0.0.1:8765/ws`.

## Guest sign-up and the participant dashboard

The flow: a guest opens `signup.html` on their phone, types the name they
want on screen, takes two photos — one face-forward, one turned to the
side — ticks a consent box and presses Send. The row lands in a Google
Sheet, which **is** the production team's dashboard. `dashboard.html`
reads the same sheet and adds the bit a spreadsheet is bad at: assigning
each participant to a camera.

The sign-up page prompts through every step: one instruction per screen,
a dashed oval to line the face up with (offset for the side shot), a
progress rail, and a review screen showing exactly what will be sent.

### Wiring it up

A static page cannot write to Google Sheets on its own, so there is one
piece to deploy — an Apps Script web app that owns the sheet:

1. Open the Google Sheet you want as the dashboard.
2. **Extensions → Apps Script**, paste `apps-script/Code.gs`, Save.
3. Run `setup` once from the editor and accept the permission prompt.
   It adds the header row and creates a Drive folder for the photos.
4. **Deploy → New deployment → Web app**, *Execute as* **Me**,
   *Who has access* **Anyone** (guests' phones are not signed in).
5. `cp config.example.js config.js` and paste the `/exec` URL into
   `endpoint`.

`config.js` is gitignored on purpose: the `/exec` URL is a capability
URL, so anyone holding it can write to the sheet. Re-deploy with
**Version: New** after any edit to `Code.gs`, or the old code keeps
serving.

Both pages work without `config.js`. They say so plainly rather than
pretending — the sign-up page shows "Not linked yet", and a send that
cannot reach the sheet is held on the phone and reported as
**"Saved on this phone, not sent yet"**, never as success.

### Testing on a phone: you need HTTPS

Two separate problems, and they are easy to confuse:

1. **`localhost` is not reachable from a phone.** It means *the phone
   itself*, so the request goes nowhere and the browser eventually reports
   that the server stopped responding — which reads like a slow page
   rather than a wrong address.
2. **`getUserMedia` needs a secure context.** `http://192.168.x.x` is not
   one, so the in-page camera is refused outright and only the file-upload
   fallback works. No amount of page code changes this.

One command solves both:

    python tools/serve_https.py

It detects your LAN IP, generates a 14-day self-signed certificate that
carries that IP in `subjectAltName` (required — `CN` alone is rejected),
binds to `0.0.0.0`, and prints both URLs:

    this machine : https://127.0.0.1:8443/dashboard.html
    a phone      : https://192.168.1.20:8443/signup.html

The phone will warn about the certificate. **Accept it once** — that is
what makes the origin secure, and the two-photo camera flow then works.
Certificates land in `.certs/`, which is gitignored.

`http://localhost` also counts as a secure context, so plain
`python -m http.server 8765` is fine for testing on the serving machine
itself. It is only phones that need the above.

**If the form stops loading later, check your IP first.** It changes when
you switch network, and `signupBase` in `config.js` then points at an
address that no longer exists.

### What ends up in the sheet

One row per participant: received-at, event, name, role, guest id,
camera, both photos inline as `=IMAGE()`, consent, and the two Drive file
ids. `dashboard.html` reads the same columns and writes back only the
camera column.

For `=IMAGE()` to render a face, the photo has to be link-readable, which
means anyone holding that URL can view that one photo. `Code.gs` has
`LINK_READABLE_PHOTOS` at the top; set it to `false` to keep every photo
private to your Drive, and the sheet shows a link instead of a face.
Either way, `purgeAfterEvent()` trashes every photo and clears the rows —
which is what the guest agreed to on their phone.

### How fast a sign-up reaches the live desk

A Google Sheet cannot push, so the desk pulls. With `endpoint` set,
`index.html` polls `?action=roster` every `deskPollMs` (default **4 s**),
and immediately whenever the tab regains focus. So pressing Send on a
phone puts the guest on the desk roster within about four seconds, with
nobody copying anything.

What appears on the desk:

- the **Guests** list in the Status pane, with role and assigned camera
- the guest's first name **on the camera tile** they are assigned to, so
  `CAM-GUEST` reads "Sarah" instead of just "Guest". A camera health note
  is shown alongside the name, not replaced by it
- their first name added to the caption name-highlighting set

**A `roster` message from your backend always wins.** The moment one
arrives the polling stops for good — the backend is the authoritative
source and this is only the gap-filler for when it has no roster of its
own. Nothing here ever influences a camera decision; it is labelling.

The dashboard auto-refreshes on the same basis (`pollMs`, default 5 s).

If you would rather wire it properly, the **Copy the roster for the
desk** button produces exactly the `roster` message documented below:

```json
{ "type": "roster", "guests": [ { "name": "Sarah Tan", "role": "Guest of honour" } ] }
```

The camera column is the `sarah = Camera B` mapping the director needs.

### Keeping the data after the event

Two buttons under **Keep this event's data**:

- **Export to its own Google Sheet** — asks the Apps Script to copy the
  Participants tab into a brand-new standalone spreadsheet in your Drive,
  named `CUE participants <date> <time>`, and opens it. The working sheet
  is left untouched, and the copy keeps the inline `=IMAGE()` photos for
  as long as the Drive files exist. Also runnable from the editor as
  `exportToNewSpreadsheet()`.
- **Download CSV** — needs no backend at all. Writes whatever is on
  screen, BOM-first so Excel and Sheets both read the UTF-8 properly.

### Fitting on a phone

The sign-up page is bounded to the viewport: the step content scrolls,
never the page, so the Continue button is always on screen. It is checked
at seven sizes from a 320x568 iPhone SE up to a Pixel 7, plus landscape.
The picture takes whatever height is left rather than a fixed fraction of
the viewport, so a short phone shrinks the photo instead of pushing the
button out of reach. Safe-area insets are respected for notched phones.

To see the actual geometry at each size rather than just pass/fail, run
`python tests/run.py probe.html` — it prints the measured scroll, button
position and picture size per step, which is what you want when changing
the layout.

### Tests

    python tests/run.py

Drives all three pages in headless Edge or Chrome with a synthetic
camera, so the real `getUserMedia → canvas → JPEG` path runs rather than
a stub. **159 assertions**, covering the four-step flow, retakes, a
refused camera, phone fit at seven screen sizes, the desk bridge, the
exports, and — the important one — that a failed send is never shown as a
success. It writes a temporary `config.js` and restores yours afterwards.

It does **not** cover `apps-script/Code.gs` — that runs on Google's
servers and needs a deployed web app. The network layer is stubbed at
`fetch()` instead, so the contract is checked from the page's side only.

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
| `roster` | `{guests: [{name, role, camera?}]}` | on connect. Real guests only, no aliases. Names are highlighted in captions; the optional `camera` labels that camera's tile. Sending this stops the sign-up polling for good |
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
