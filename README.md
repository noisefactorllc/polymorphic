# Polymorphic

Live shader coding environment using the Noisemaker DSL (Polymorphic language).

## Quick Start

1. Start the development server:

```bash
npm install
npm start
```

2. Open http://localhost:3000 in your browser

## Features

- **Full-page Canvas**: Shader renders to fill the entire viewport
- **Live Code Editor**: Toggle with `#` button, hot reload as you type
- **Fullscreen Mode**: Click `⛶` button in upper right corner
- **Reset**: Restore original program with `reset` button

## Keyboard Shortcuts

- **Ctrl/Cmd + Enter**: Force recompile shader immediately

## URL Parameters

You can load a custom shader program via URL:

```
http://localhost:3000?dsl=noise().write(o0)
```

## Development

### Project Structure

```
polymorphic/
├── public/
│   ├── index.html          # Main application page
│   └── js/
│       ├── embed.js        # Application entry point
│       ├── fontLoader.js   # Dynamic font loading
│       └── noisemaker/
│           ├── bundle.js   # ESM bundle loader
│           └── renderer.js # Shader renderer wrapper
└── package.json
```

### Shader Bundles

Noisemaker shaders are loaded at runtime from the CDN (shaders.noisedeck.app). No local vendor files are needed.

## Portable Effects

Polymorphic supports the Portable Effects Format for creating and sharing custom shader effects.

See the **[Portable Effects Format](https://github.com/noisedeck/portable)** repository for:
- Effect format specification
- Parameter definitions
- Example effects

## Credits

Built on [Noisemaker](https://noisemaker.app) shader technology by [Noise Factor](https://noisefactor.io).
