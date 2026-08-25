# Polymorphic

Live shader-coding environment built on the Noisemaker DSL — a browser-based
visual instrument for live coding, VJ sets, and generative art. The canvas is
the hero: code renders to a full-page WebGL2/WebGPU surface you edit live.

## Quick Start

1. Start the development server:

```bash
npm install
npm start
```

2. Open http://localhost:3000 in your browser.

(`npm start` and `npm run dev` both serve `public/` on port 3000.)

## Features

- **Full-page canvas** — the shader fills the viewport; toolbar/editor float on top.
- **Live editor** — hot-reloads as you type; evaluate the whole program or a
  single block, with snapshot history (undo/redo of successful programs).
- **Inline number scrubbing** — Alt-drag any numeric literal to tweak it live.
- **Command palette** (`⌘/Ctrl + K`) — searchable actions for everything.
- **Inspiration gallery** — browse and load example sketches.
- **Scenes** — save/recall up to 9 programs with the number keys.
- **Live inputs** — microphone (audio-reactive), MIDI (CC + clock), webcam, and
  screen capture as shader sources.
- **Media & text sources** — `media(url: "…")` for images/video, plus `text(…)`.
- **BPM / tap tempo** — clock from manual tap or MIDI for tempo-synced motion.
- **Recording** — capture the canvas to WebM video (quality presets) and save
  PNG/JPG stills.
- **Output picker** — preview and switch between the 8 render surfaces (`o0`–`o7`).
- **Sharing** — publish a sketch to a short link, or pass it in the URL.
- **Performance mode** (`⌘/Ctrl + ⇧ + H`) — hide all UI for clean projection.
- **Performance overlay** — live FPS, frame time, pass count, and backend.
- **WebGL2 and WebGPU** backends; installable as a PWA (offline-capable).

Press `?` in the app for the full keyboard-shortcut reference.

## Keyboard Shortcuts (highlights)

| Action | Keys |
| --- | --- |
| Recompile whole program | `⌘/Ctrl + ↵` |
| Evaluate current block | `⌘/Ctrl + ⇧ + ↵` or `Alt + ↵` |
| Step back / forward through history | `⌘/Ctrl + Alt + ← / →` |
| Format DSL | `⌘/Ctrl + ⇧ + F` |
| Scrub a number | `Alt + drag` (`⇧` fine, `⌘/Ctrl` coarse) |
| Command palette | `⌘/Ctrl + K` |
| Save / recall scene N | `⌘/Ctrl + ⇧ + 1–9` / `1–9` |
| Tap tempo | `T` |
| Performance mode | `⌘/Ctrl + ⇧ + H` |
| Show all shortcuts | `?` |

## URL Parameters

| Parameter | Effect |
| --- | --- |
| `?dsl=<program>` | Load a DSL program directly, e.g. `?dsl=noise().write(o0)` |
| `?code=<id>` | Load a shared composition (short link from the share action) |
| `?backend=webgpu` \| `webgl2` | Force the rendering backend (default WebGL2) |
| `?embed=1` | Embed mode — chromeless canvas for iframes |

## Development

### Project Structure

```
polymorphic/
├── public/
│   ├── index.html            # Main application page
│   ├── sw.js                 # Service worker (PWA / offline)
│   ├── data/                 # Bundled gallery examples
│   └── js/
│       ├── embed.js          # Application entry point + wiring
│       ├── fontLoader.js     # Dynamic font loading for text effects
│       ├── docReader.js, shareModal.js, sharingLoader.js, …
│       ├── noisemaker/
│       │   ├── bundle.js      # ESM loader for the CDN shader engine
│       │   ├── renderer.js    # PolymorphicRenderer wrapper (text/media textures)
│       │   └── dslSanitize.js # DSL helpers (engine-compat sanitizing)
│       └── ui/                # Panels & controls: command palette, gallery,
│                              # recorder, scenes, live inputs, bpm, output
│                              # picker, perf overlay, scrubber, … (~26 modules)
├── tests/unit/               # node:test unit tests (run: node --test tests/unit/*.test.mjs)
└── package.json
```

### Shader Bundles

The Noisemaker shader engine and effects are loaded at runtime from the CDN
(`shaders.noisedeck.app/1`). No local vendor files are needed.

## The Book of Polymorphic DSL

`polymorphic.noisedeck.app/book` is an illustrated reference to every effect in
the engine: one page each, showing the program that demonstrates it running
full-screen, with an account of what its shader is doing. Pages are editable in
place and tear off into Polymorphic.

Programs come from the engine, not from hand-authoring.
`scripts/extract-book-data.mjs` imports the shipped effect bundles and the core
engine from `shaders.noisedeck.app/1` and runs the same routine Noisedeck's
effect browser uses, so each page demonstrates the default program the engine
itself derives.

`book/curation.json` holds the editorial decisions on top of that, and the
extract applies them so a re-extract keeps them: effects that get no page
because they need a camera, a microphone or a MIDI keyboard, and the handful
whose derived default demonstrates nothing on a page (a blur on a field with no
edges, a motion blur on a still frame, an overlay on a flat fill). Each entry
carries its reason, and a stale one fails the extract.

Run it after a Noisemaker release and commit the diff:

```bash
npm run book:extract      # refresh book/data/effects.json from the CDN
npm run build             # render book/ into dist/book/ (offline)
npm run dev               # serve public/ with the book mounted at /book
```

Prose lives in `book/content/<chapter>/<effect>.md`, one file per effect, ending
with a `Further reading:` block of `- Label | https://url` lines that send the
reader to the paper, the algorithm, or the history behind the effect. The build
fails if a file is missing or has no links.

`npm test` checks the data and the prose offline. `npm run test:e2e` walks every
page in a browser and fails on a compile error, a blank canvas, or writing too
tall for the plate. `npm run check:links` fetches every further-reading URL and
reports what no longer resolves; it needs the network, so it is not part of
`npm test`. Run it after adding links, and periodically after that.

Output goes to `dist/book/`, never into `public/`. The standalone desktop and
mobile pipeline stages `public/` straight from the working checkout without
running a build, so a generated `public/book/` would ride into three shipped
apps on whichever machine happened to have built it. The deploy rsyncs
`dist/book/` to the same document root as a second step.

## Portable Effects

Polymorphic supports the Portable Effects Format for creating and sharing custom
shader effects.

See the **[Portable Effects Format](https://github.com/noisefactorllc/portable)**
repository for:
- Effect format specification
- Parameter definitions
- Example effects

## Credits

Built on [Noisemaker](https://noisemaker.app) shader technology by
[Noise Factor](https://noisefactor.io).
