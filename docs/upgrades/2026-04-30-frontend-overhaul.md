# Polymorphic Frontend Overhaul — Beat Hydra Plan

**Goal:** Take Polymorphic from "live tech demo" to a fully-blown live-coding frontend that meets and exceeds Hydra's UX. Lure Hydra users in with the better product. Stage locally, do not push.

## Inventory: what we already have under the hood

The Noisemaker engine bundle (`shaders.noisedeck.app/1`) already exposes a far richer surface than we currently wire up. Highlights:

- **174 effects** across 8 namespaces (synth/filter/mixer/points/synth3d/filter3d/render/classicNoisedeck). Hydra has ~50 functions.
- **Audio FFT in DSL today**: `audio(band: low|mid|high|vol, min:.., max:..)` driven by `AudioInputManager` → mic.
- **MIDI in DSL today**: `midi(channel:.., min:.., max:..)` driven by `MidiInputManager`.
- **Built-in oscillators**: `osc(type: sine|tri|saw|sawInv|square|noise, min, max, speed, offset)`.
- **Webcam / video / image inputs**: `media(...)` effect; `UIController._createMediaInputSection` already supports file/camera selection.
- **8 surfaces** `o0..o7` with feedback (Hydra has 4: `o0..o3`).
- `currentFPS`, `getFrameTimeStats`, `lastRenderTime`, `lastTime`, `lastPassCount`, `setLoopDuration`, `setUniform`, `setTileRegion` — full perf instrumentation.
- DSL compile/parse/lex/unparse/expand exposed; `extractEffectsFromDsl` returns structured info per call.
- WebGL2 + WebGPU backends, automatic context-loss recovery, capabilities API.

Translation: most of what Hydra's frontend offers, our engine *already supports* — we just haven't surfaced it. The frontend is the bottleneck.

## Inventory: what Hydra's frontend ships

(From general knowledge; the dossier agent will fill in more — but these are the headline items.)

- **Functional JS API**: `osc(60, 0.1, 1.5).color(1,0.5,1).out()`. Inline JS escape hatch for arbitrary expressions.
- **Block / line evaluation**: select code, `Ctrl+Shift+Enter` evaluates that block. Re-evaluate any line live without restarting the program. THE killer live-coding affordance.
- **Webcam / video / pubsub sources**: `s0.initCam()`, `s0.initVideo("url")`, `s0.initStream("name")`. Trivial one-liners.
- **Audio reactivity**: `a.fft[0]` indexable in any expression; `a.show()` toggles a debug overlay.
- **Random sketch loader**: pulls from a community gallery. Default landing page IS a random example.
- **Built-in tutorial** sketches.
- **CodeMirror editor**: vim mode option, find/replace, multi-cursor, autocompletion.
- **Hydra-vsync / pubsub**: peer-to-peer collab, send your output to other Hydra instances.
- **Recording**: `vidRecorder.start()` records WebM.
- **Hide UI for performance**: clean canvas-only mode.
- **Embed**: iframe + `?code=...` short-link friendly URLs.

## The gap

We have better tech and a richer effect library; they have a more performant live-coding workflow and a community-bred set of features. To beat them on their home court, we need to ship:

### Tier 1 — live-coding power features (must-have)

1. **Block evaluation**. Cmd+Enter on a selection compiles just that block. Cmd+Shift+Enter compiles the whole program. Visual flash of evaluated region. This single feature is what makes Hydra feel "alive" and ours "static". It maps cleanly onto our DSL — we just route the selection text through `compile()` instead of the full editor value.
2. **Inline number scrubbing**. Alt+drag any number literal to scrub it live. Alt+Shift+drag for finer steps. While dragging, hot-reload is paused and we mutate the literal in place; on release, normal hot reload resumes. Power-user feature, instantly recognisable as "premium".
3. **Effect autocomplete + command palette**. `Ctrl+Space` triggers a fuzzy effect picker; `Ctrl+K` opens a command palette (programs, examples, settings, recording, etc). Fed from the manifest already loaded in `docReader`.
4. **Audio + MIDI panel** with live levels. Single button toggles each input on/off. Shows real-time meters: low/mid/high/vol bars from `AudioInputManager`, recent MIDI CCs from `MidiInputManager`. Provides sample DSL snippets to inject (`audio(band: low, min:..., max:...)`).
5. **Webcam / file / video media**. Wire the existing `UIController._createMediaInputSection` (or call its underlying API) into a "Sources" panel: pick webcam/file/video, get a `media(...)` snippet to drop into your DSL.
6. **Recording**. `MediaRecorder` over `canvas.captureStream()` → WebM download. Tap to start, tap to stop, indicator is the menu bar's record icon.

### Tier 2 — performer features

7. **Tap tempo / BPM**. A global BPM knob; oscillators auto-sync via `osc(speed: bpm * 0.5)` or a dedicated `beat()` source. Tap-tempo via `t` key.
8. **Scenes (multi-program)**. Up to 9 named scenes; number keys 1-9 switch + recompile. Each scene is its own DSL program. Algorave-friendly.
9. **Crossfade between scenes**. Optional smooth blend by routing two compiled programs through alternating outputs and using `mixer.blendMode`. (Initial version: hard switch + a fade-in CSS overlay; full blend later.)
10. **Output preview pips**. Tiny floating thumbnails for `o0..o7` so you can see what each surface holds. Click to focus that output as the displayed render.
11. **Performance overlay**. FPS, ms/frame, jitter, pass count, backend (WebGL2 vs WebGPU), pixel count. Toggleable via `?` key.
12. **Snapshot history**. Every successful compile auto-snapshots the program; back/forward buttons walk you through them. Survives reload.

### Tier 3 — community / discovery

13. **Inspiration gallery**. Curated `examples.json` shipped with the app — a list of named DSL programs with thumbnails and descriptions. Land on a random one (or the default). "Shuffle" button picks another. "Edit" copies into the editor. Could later be swapped for a sharing.noisedeck.app feed.
14. **Tutorial flow**. A 5-step interactive walkthrough: `noise().write(o0)`, then add a palette, then add lighting, then add an oscillator, then add audio. Spotlights the relevant code as it goes. Onboarding for new users.
15. **Single-file embed**. `?dsl=...` already works. Add `?embed=1&hide=ui` to render a clean fullscreen embed (already partially supported via `EMBEDDED_DSL`).

### Tier 4 — polish / aesthetic

16. **Visual style refresh**. Polymorphic's chrome reads as a developer tool right now. Slim everything: smaller menu bar, ghost-pill buttons, more contrast against the canvas. Adopt a "the canvas is the hero" feel like Hydra. Keep the dark mode.
17. **Status row**. Bottom edge: shows connected MIDI device, mic state, recording state, current scene, BPM. Replaces compiler errors with a richer status feed.
18. **Cleaner default sketch**. The current default DSL is impressive but heavy. Lighten it for first-impression load — we want the user to see a *clean* visual immediately, then explore.

## Build order

I'll execute roughly in this order, validating each in the browser via Playwright before moving on:

1. Effect manifest exposed locally, autocomplete + Ctrl+K command palette
2. Block evaluation
3. Inline number scrubbing
4. Audio reactivity panel + mic toggle
5. MIDI panel + connect button
6. Sources panel: webcam + image/video files
7. Recording (WebM)
8. Performance overlay
9. Output preview pips
10. Inspiration gallery + shuffle
11. Snapshot history (undo/redo program)
12. Tap tempo / BPM
13. Visual polish + status row
14. Tutorial mode

Each is a self-contained module under `public/js/ui/`, hot-loaded by `embed.js`. The CSS lives in dedicated style modules to keep `index.html` from ballooning.

## Constraints

- Stage locally only. No `git push`, no public PRs.
- Don't break the existing default DSL or the `?dsl=` / `?code=` URL contracts.
- Keep load time tight; lazy-load anything that isn't on the critical path.
