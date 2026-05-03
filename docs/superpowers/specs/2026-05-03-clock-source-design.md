# Clock source selection (manual / MIDI)

## Goal

Let the user drive Polymorphic's loop clock from either of two sources:

- **manual** (default): the existing internal clock — set by tap tempo, drag, scroll, slider on the BPM bar.
- **midi**: the BPM and transport state are derived from incoming MIDI System Real-Time messages (`0xF8` clock, `0xFA` start, `0xFB` continue, `0xFC` stop).

A user playing a DAW or hardware sequencer should be able to pick **midi** and have Polymorphic's oscillators, animations, and beat indicator follow the DAW transport.

## UX

The source picker lives in the existing BPM bar (lower-left). A small text toggle next to the BPM display shows the active source: `tap` or `midi`. Clicking it cycles between the two. (Two-state toggle, not a dropdown.)

When **midi** is active:
- The `bpm` label changes to `midi` to make the source unambiguous.
- The pulse indicator color shifts (e.g. cool-blue → warm-amber) so the user can see at a glance the source has changed without reading text.
- A tiny inline status hint replaces the `tap T · scroll · drag` line: `synced` / `no device` / `no clock` / `stopped`.
- Manual interactions (drag/scroll/click-to-tap, `T` shortcut) become no-ops while midi is selected.

When **manual** is active: today's behavior, unchanged.

The source selection persists across reloads (`localStorage`). Default is `manual`.

## Behavior

### Source = manual
Existing behavior. The internal `_bpm` value drives `renderer.setLoopDuration(barSeconds())`.

### Source = midi

Derived BPM from the inter-tick interval of `0xF8` clock messages (24 PPQN). The clock receiver maintains a sliding window of the last 24 timestamps (one quarter note); when the window is full, BPM is computed and smoothed with an EMA (`alpha = 0.2`) to dampen jitter from typical DAW clock variation. Each new BPM call falls through to the same `setBpm()` path as manual, so all downstream wiring (loopDuration, beat counter, listeners) is unchanged.

Transport handling:

| Message | Status | Effect |
|---|---|---|
| Clock | `0xF8` | feed tick to BPM derivation |
| Start | `0xFA` | call `renderer.setLoopDuration(barSeconds())` to reset loop phase to 0; if the renderer is stopped (after a previous Stop), call `renderer.start()` |
| Continue | `0xFB` | if the renderer is stopped, call `renderer.start()` (do NOT reset phase) |
| Stop | `0xFC` | call `renderer.stop()` to freeze the canvas at the current frame |

This matches DAW semantics: pressing Play sends Start → reset to bar 1; pressing Stop freezes; pressing Continue resumes from where Stop hit.

### Status states (shown in the inline hint)

| State | Trigger | Behavior |
|---|---|---|
| `synced` | clock ticks arriving for at least one beat | BPM updates live |
| `no device` | source is midi but `navigator.requestMIDIAccess()` returned no inputs (or permission denied) | coast at last-known BPM (or 120 if never synced); render keeps running |
| `no clock` | MIDI device(s) connected but no `0xF8` received in the last ~2 seconds | coast at last-known BPM; render keeps running |
| `stopped` | `0xFC` received | renderer halted; canvas frozen on last frame |

Coasting (rather than freezing) when no clock has arrived yet means the user can pick `midi`, see their canvas keep moving, and verify the source is wired before they press play in their DAW.

## Architecture

Two new modules, plus a small surface added to `bpm.js`:

### `public/js/ui/midiClock.js` (new)

Owns the MIDI transport listener. Independent of the engine's `MidiInputManager` — calls `navigator.requestMIDIAccess()` itself (idempotent at the browser level — the browser returns the same `MIDIAccess` object on subsequent calls) and attaches an `addEventListener('midimessage', …)` handler to each input. Using `addEventListener` rather than the `onmidimessage` property means our listener coexists with the engine's note/CC handler without overwriting it.

Exports:

- `class MidiClock`
  - `enable(): Promise<'ok' | 'no-device' | 'denied'>`
  - `disable(): void`
  - `onBpm(cb)` — fires with `(bpm: number)` whenever a fresh BPM is computed
  - `onTransport(cb)` — fires with `('start' | 'stop' | 'continue')` for transport messages
  - `onStatusChange(cb)` — fires with the current status string (see table above)
  - `get status()` — current status string
- pure helpers (exported for tests):
  - `parseMidiStatus(byte: number): 'clock' | 'start' | 'stop' | 'continue' | null`
  - `bpmFromTickIntervals(timestamps: number[]): number | null` — returns null if fewer than 2 ticks; otherwise computes `60_000 / (avgIntervalMs * 24)`

### `public/js/ui/bpm.js` (modified)

- Adds a source picker UI element.
- Owns the source state and `localStorage` persistence.
- Lazily instantiates a single `MidiClock` the first time the user picks `midi`.
- When source is `midi`:
  - Subscribes to `onBpm` → calls `setBpm(bpm)`.
  - Subscribes to `onTransport` → calls the renderer hooks.
  - Subscribes to `onStatusChange` → updates the inline status hint.
- When the user toggles back to `manual`, the `MidiClock` is disabled (releases inputs) and the manual interactions re-engage.

## Testing

Unit tests in `tests/unit/midiClock.test.mjs` cover the pure logic:

- `parseMidiStatus`: every transport status byte and a representative non-transport byte.
- `bpmFromTickIntervals`: 24 evenly-spaced timestamps for 120 BPM yields ≈120; uneven intervals average correctly; fewer than 2 timestamps returns null.

UI behavior (toggle wiring, persistence, transport effect on the renderer) is verified manually in the dev server, since it's tightly coupled to DOM and the renderer instance.

## Out of scope

- MIDI Song Position Pointer (`0xF2`) — would let Polymorphic jump to a specific bar mid-song; nice-to-have but not part of this slice.
- Per-device clock source selection (right now, ANY connected device's clock is used). DAW + standalone clock-source pedal users are rare enough to defer.
- Clock source other than MIDI (Ableton Link, internal sync server, etc.).

## Files touched

- `public/js/ui/midiClock.js` — new
- `public/js/ui/bpm.js` — adds source picker UI + MIDI clock subscription
- `tests/unit/midiClock.test.mjs` — new
