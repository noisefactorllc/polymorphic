/**
 * Documentation Reader Panel
 * 
 * Renders markdown documentation in a side panel.
 */

const APP_VERSION = '0.11'

let docReaderPanel = null;
let docReaderContent = null;
let dslOverlay = null;
let effectManifest = null;
let applyToEditorCallback = null;

// Base URL for fetching effect help files from the shaders CDN.
const EFFECTS_BASE_URL = 'https://shaders.noisedeck.app/1/effects';

/**
 * Set the callback for applying code to editor
 * @param {function} callback - Function that accepts DSL string
 */
export function setApplyToEditorCallback(callback) {
    applyToEditorCallback = callback;
}

/**
 * Initialize the doc reader panel references
 */
export function initDocReader() {
    docReaderPanel = document.getElementById('doc-reader-panel');
    docReaderContent = document.getElementById('doc-reader-content');
    dslOverlay = document.getElementById('dsl-overlay');
    
    // Set up click handlers for effect links
    if (docReaderContent) {
        docReaderContent.addEventListener('click', handleDocClick);
    }
    
    // Load the effect manifest
    loadManifest();
}

/**
 * Handle clicks within the doc reader content
 */
function handleDocClick(e) {
    const link = e.target.closest('a');
    if (!link) return;
    
    const href = link.getAttribute('href');
    if (!href) return;
    
    // Check if this is an effect link
    if (href.startsWith('#effect:')) {
        e.preventDefault();
        const effectPath = href.slice(8); // Remove '#effect:'
        loadEffectHelp(effectPath);
        return;
    }
    
    // Check if this is an apply-to-editor link
    if (href.startsWith('#apply:')) {
        e.preventDefault();
        const index = parseInt(href.slice(7), 10);
        applyCodeBlockToEditor(index);
        return;
    }

    // External links — open in a new tab (and harden against tab-nabbing)
    if (/^https?:\/\//i.test(href)) {
        link.target = '_blank';
        if (!link.rel) link.rel = 'noopener noreferrer';
    }
}

/**
 * Load and display help for a specific effect by dynamically importing its bundle
 * @param {string} effectPath - e.g., 'synth/noise'
 */
export async function loadEffectHelp(effectPath) {
    const [namespace, effectName] = effectPath.split('/');
    const moduleUrl = `${EFFECTS_BASE_URL}/${namespace}/${effectName}.js`;
    
    try {
        const module = await import(moduleUrl);
        const effect = module.default;
        const helpContent = module.help || effect?.help;
        
        if (!helpContent) {
            renderDocContent(`# ${effectName}\n\n*Documentation not available for this effect.*\n\n[← Back to Reference](#back)`);
            return;
        }
        
        // Strip outer markdown code fence if present (bundle format uses this)
        let cleanHelp = helpContent;
        const fenceMatch = cleanHelp.match(/^````markdown\n([\s\S]*)\n````$/);
        if (fenceMatch) {
            cleanHelp = fenceMatch[1];
        }
        
        // Strip existing h1 header from help content if present (we'll add our own)
        cleanHelp = cleanHelp.replace(/^#\s+[^\n]+\n+/, '');
        
        // Build header with effect info
        // Use module.effectName (exported by bundle) or fallback to effectName from path
        // Do NOT use effect.name as it may be minified
        let headerMarkdown = `# ${module.effectName || effectName}\n\n`;
        
        if (effect?.description) {
            headerMarkdown += `${effect.description}\n\n`;
        }
        
        if (namespace) {
            headerMarkdown += `**Namespace:** \`${namespace}\`\n\n`;
        }
        
        if (effect?.tags?.length > 0) {
            headerMarkdown += `**Tags:** ${effect.tags.map(t => `\`${t}\``).join(' ')}\n\n`;
        }
        
        const backLink = '\n\n---\n\n[← Back to Reference](#back)';
        renderDocContent(headerMarkdown + cleanHelp + backLink);
    } catch (err) {
        console.error('Failed to load effect help:', err);
        renderDocContent(`# ${effectPath}\n\n*Failed to load documentation.*\n\n[← Back to Reference](#back)`);
    }
}

/**
 * Load the effect manifest from the vendor directory
 */
async function loadManifest() {
    const manifestUrl = `${EFFECTS_BASE_URL}/manifest.json`;
    
    try {
        const response = await fetch(manifestUrl);
        if (!response.ok) {
            console.warn('Failed to load effect manifest:', response.status);
            return;
        }
        
        effectManifest = await response.json();
        
        // Re-render the placeholder content now that we have the manifest
        showPlaceholderContent();
    } catch (err) {
        console.error('Failed to load effect manifest:', err);
    }
}

/**
 * Generate markdown for effect lists organized by namespace from manifest
 */
function generateEffectListMarkdown() {
    if (!effectManifest) {
        return '*Loading effect list...*\n';
    }
    
    // Group effects by namespace
    const namespaces = {};
    
    for (const effectId of Object.keys(effectManifest)) {
        // effectId is like "synth/noise" or "filter/blur"
        const slashIndex = effectId.indexOf('/');
        if (slashIndex === -1) continue;
        
        const ns = effectId.substring(0, slashIndex);
        const effectName = effectId.substring(slashIndex + 1);
        
        if (!namespaces[ns]) {
            namespaces[ns] = [];
        }
        namespaces[ns].push(effectName);
    }
    
    // Sort namespaces in a logical order
    const nsOrder = ['synth', 'filter', 'mixer', 'render', 'points', 'synth3d', 'filter3d', 'classicNoisedeck', 'classicNoisemaker'];
    const sortedNs = nsOrder.filter(ns => namespaces[ns]);
    
    // Add any namespaces not in the predefined order
    for (const ns of Object.keys(namespaces)) {
        if (!sortedNs.includes(ns)) {
            sortedNs.push(ns);
        }
    }
    
    let markdown = '';
    
    for (const ns of sortedNs) {
        const effects = namespaces[ns].sort();
        const effectLinks = effects.map(e => `[${e}](#effect:${ns}/${e})`).join(' · ');
        markdown += `**${ns}:** ${effectLinks}\n\n`;
    }
    
    return markdown;
}

/**
 * Show the documentation reader panel
 */
export function showDocReader() {
    if (!docReaderPanel) return;
    docReaderPanel.classList.add('visible');
    if (dslOverlay) {
        dslOverlay.classList.add('doc-open');
    }
}

/**
 * Hide the documentation reader panel
 */
export function hideDocReader() {
    if (!docReaderPanel) return;
    docReaderPanel.classList.remove('visible');
    if (dslOverlay) {
        dslOverlay.classList.remove('doc-open');
    }
}

/**
 * Toggle the documentation reader panel visibility
 * @returns {boolean} Whether the panel is now visible
 */
export function toggleDocReader() {
    if (!docReaderPanel) return false;
    const visible = docReaderPanel.classList.toggle('visible');
    // Keep the editor's `.doc-open` class in sync so it narrows/widens
    // alongside the panel. Without this, closing then re-opening the docs
    // leaves the editor stuck at full width.
    if (dslOverlay) {
        dslOverlay.classList.toggle('doc-open', visible);
    }
    return visible;
}

/**
 * Check if the doc reader is currently visible
 * @returns {boolean}
 */
export function isDocReaderVisible() {
    return docReaderPanel?.classList.contains('visible') ?? false;
}

/**
 * Apply a code block to the editor by index
 * @param {number} index - The index of the code block
 */
function applyCodeBlockToEditor(index) {
    if (!applyToEditorCallback) return;
    
    const codeBlocks = docReaderContent.querySelectorAll('pre code');
    if (index < 0 || index >= codeBlocks.length) return;
    
    const code = codeBlocks[index].textContent;
    applyToEditorCallback(code);
}

/**
 * Render markdown content in the doc reader
 * @param {string} markdown - The markdown content to render
 */
export function renderDocContent(markdown) {
    if (!docReaderContent) return;
    
    // Use the globally loaded marked library
    if (typeof marked !== 'undefined') {
        docReaderContent.innerHTML = marked.parse(markdown);
        
        // Add build info at the end
        const addBuildInfo = (hash = 'LOCAL', dateStr = 'n/a') => {
            // Remove any existing build info first
            const existing = docReaderContent.querySelector('.doc-build-info');
            if (existing) existing.remove();
            
            const buildInfo = document.createElement('div');
            buildInfo.className = 'doc-build-info';
            buildInfo.style.cssText = 'font-family: \'Noto Sans Mono\', \'Noto Sans Mono Block\'; font-size: 9px; color: #444; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 1em; margin-top: 1em;';
            buildInfo.textContent = `version ${APP_VERSION.replace(/-.*$/, '')} / build: ${hash} / deployed: ${dateStr}`;
            docReaderContent.appendChild(buildInfo);
        };
        
        fetch('/deployment-meta.json')
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(meta => {
                const hash = meta.git_hash ? meta.git_hash.trim().slice(0, 8) : 'LOCAL';
                let dateStr = 'n/a';
                
                if (meta.date) {
                    const date = new Date(meta.date * 1000);
                    const pad = (n) => String(n).padStart(2, '0');
                    dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
                }
                
                addBuildInfo(hash, dateStr);
            })
            .catch(() => addBuildInfo());
        
        // Add "Apply to editor" links after code blocks that have a search directive
        const codeBlocks = docReaderContent.querySelectorAll('pre');
        codeBlocks.forEach((pre, index) => {
            const codeEl = pre.querySelector('code');
            const code = codeEl ? codeEl.textContent : pre.textContent;
            
            // Only show link if code contains a search directive
            if (!/^\s*search\s+/m.test(code)) return;
            
            const applyLink = document.createElement('a');
            applyLink.href = `#apply:${index}`;
            applyLink.className = 'apply-to-editor-link';
            applyLink.textContent = '→ Apply to editor';
            pre.insertAdjacentElement('afterend', applyLink);
        });
        
        // Handle back links
        const backLinks = docReaderContent.querySelectorAll('a[href="#back"]');
        backLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                showPlaceholderContent();
            });
        });
        
        // Scroll to top when content changes
        docReaderContent.scrollTop = 0;
    } else {
        // Fallback: display as preformatted text
        docReaderContent.innerHTML = `<pre>${markdown}</pre>`;
    }
}

/**
 * Show placeholder documentation content
 */
export function showPlaceholderContent() {
    const placeholder = `# Welcome to Polymorphic

## By [Noise Factor](https://noisefactor.io)

Polymorphic is a high-level composition language that compiles into a WebGL2 or WebGPU shader graph. It powers the open source [Noisemaker engine](https://noisemaker.app/), and is at the core of [Noisedeck](https://noisedeck.app/) and [Layers](https://layers.noisefactor.io/). It's designed for flexibility and expressiveness.

Check out the [Book of Polymorphic DSL](/book).

> **Full language spec:** [docs.noisemaker.app](https://docs.noisemaker.app/shaders/language/)

---

## Quick Start

Every program starts by declaring which effect collections (namespaces) to use:

\`\`\`
search synth
noise().write(o0)
\`\`\`

This creates a noise pattern and displays it. That's it!

---

## Core Concepts

### Chains

Effects are chained together with dots. The output of one effect flows into the next:

\`\`\`
search synth, filter
noise().palette().lighting().write(o0)
\`\`\`

### Surfaces and Mixers

\`o0\` through \`o7\` are your canvases. Use \`.write()\` to draw to them:

\`\`\`
search mixer, synth

noise(ridges: true)
  .write(o0)

noise(seed: 2, ridges: true)
  .blendMode(tex: read(o0), mode: mix)
  .write(o1)
\`\`\`

Reading from a surface before writing creates a **feedback loop** — it shows the previous frame.

---

## Arguments

Effects accept parameters either by position or by name:

\`\`\`
noise(4, 3)
noise(octaves: 4, scaleX: 75)
\`\`\`

You can do math in arguments:

\`\`\`
noise(scaleX: 50 + 25, octaves: 2 * 2)
\`\`\`

### Colors

Use hex codes for colors: \`#f00\` (red), \`#00ff00\` (green), \`#0000ff80\` (blue, 50% alpha)

### Vectors

Some effects need multi-value parameters:

\`\`\`
effect(offset: vec2(0.5, 0.25))
\`\`\`

---

## Variables

Save effects or partial setups to reuse later:

\`\`\`
let wobble = osc(type: oscKind.sine, min: 25, max: 100)
noise(scaleX: wobble).write(o0)
\`\`\`

---

## Animation

### Oscillators

Make parameters change over time:

\`\`\`
noise(scaleX: osc(type: oscKind.sine, min: 25, max: 100)).write(o0)
\`\`\`

**Oscillator types:** \`sine\`, \`tri\`, \`saw\`, \`sawInv\`, \`square\`, \`noise\`

**Parameters:**
- \`min\`, \`max\` — output range
- \`speed\` — cycles per loop (default: 1)
- \`offset\` — phase offset 0–1

### Live Input (early wip)

Drive parameters from MIDI or audio:

\`\`\`
noise(scaleX: midi(channel: 1, min: 10, max: 100)).write(o0)
noise(scaleX: audio(band: audioBand.low, min: 25, max: 100)).write(o0)
\`\`\`

---

## Namespaces

### Built-in (always available)
\`read\`, \`write\`, \`read3d\`, \`write3d\`, \`render\`, \`render3d\`

### Effect Collections
- **synth** — generators: noise, shapes, fractals, cellular automata
- **filter** — transforms: blur, color, distortion, edges
- **mixer** — blend two images together
- **render** — feedback loops, particle rendering
- **points** — particle simulations: physarum, flocking, flow
- **synth3d** — 3D volume generators
- **filter3d** — 3D volume processors
- **classicNoisedeck** — legacy effects from Noisedeck Classic
- **classicNoisemaker** — ported Python Noisemaker effects

---

## Subchains

Group related effects together:

\`\`\`
noise()
  .subchain(name: "color grading") {
    .palette()
    .adjust(rotation: 45)
  }
  .write(o0)
\`\`\`

---

## Palettes

Color palettes apply to many effects. Use the \`palette\` enum to reference them:

\`\`\`
search synth, filter
noise().palette(index: vaporwave).write(o0)
\`\`\`

**Available palettes:**

\`afterimage\` · \`barstow\` · \`bloob\` · \`blueSkies\` · \`brushedMetal\` · \`burningSky\` · \`california\` · \`columbia\` · \`cottonCandy\` · \`darkSatin\` · \`dealerHat\` · \`dreamy\` · \`eventHorizon\` · \`fiveG\` · \`ghostly\` · \`grayscale\` · \`hazySunset\` · \`heatmap\` · \`hypercolor\` · \`jester\` · \`justBlue\` · \`justCyan\` · \`justGreen\` · \`justPurple\` · \`justRed\` · \`justYellow\` · \`mars\` · \`modesto\` · \`moss\` · \`neptune\` · \`netOfGems\` · \`organic\` · \`papaya\` · \`radioactive\` · \`royal\` · \`santaCruz\` · \`seventiesShirt\` · \`sherbet\` · \`sherbetDouble\` · \`silvermane\` · \`skykissed\` · \`solaris\` · \`spooky\` · \`springtime\` · \`sproingtime\` · \`sulphur\` · \`summoning\` · \`superhero\` · \`toxic\` · \`tropicalia\` · \`tungsten\` · \`vaporwave\` · \`vibrant\` · \`vintage\` · \`vintagePhoto\`

---

## Fonts

The \`text()\` effect supports web fonts. Use quoted strings for font names:

\`\`\`
search synth, filter
gradient().pixels().text(text: "GAME OVER", font: "Press Start 2P", color: #ff0000ff).write(o0)
\`\`\`

Fonts are loaded dynamically from our CDN. Names are matched flexibly (case-insensitive, spaces/dashes optional).

**Sans-Serif:**
\`Inter\` · \`Roboto\` · \`Roboto Condensed\` · \`Roboto Flex\` · \`Noto Sans\` · \`Noto Sans Display\` · \`Source Sans 3\` · \`IBM Plex Sans\` · \`Work Sans\` · \`Open Sans\` · \`PT Sans\` · \`Fira Sans\` · \`Cabin\` · \`Exo 2\` · \`Karla\` · \`Atkinson Hyperlegible\` · \`Space Grotesk\` · \`Outfit\` · \`Lato\` · \`Encode Sans\` · \`Red Hat Display\` · \`Barlow\` · \`Raleway\` · \`Lexend\` · \`Rubik\` · \`Signika\` · \`Poppins\` · \`Quicksand\` · \`Nunito\` · \`Comfortaa\` · \`Baloo 2\` · \`Asap\` · \`Jaldi\` · \`Josefin Sans\` · \`Jost\` · \`League Spartan\` · \`Chivo\` · \`Syne\`

**Serif:**
\`Noto Serif\` · \`Crimson Pro\` · \`Source Serif 4\` · \`Playfair Display\` · \`Merriweather\` · \`EB Garamond\` · \`Literata\` · \`Cardo\` · \`PT Serif\` · \`Lora\` · \`Fraunces\` · \`Cormorant\` · \`Cormorant Garamond\` · \`Cormorant SC\` · \`Cormorant Infant\` · \`Cormorant Upright\` · \`Bitter\` · \`Zilla Slab\` · \`Roboto Slab\` · \`Arvo\` · \`Newsreader\` · \`Alice\` · \`Radley\` · \`Fanwood Text\` · \`Alegreya\` · \`Alegreya SC\` · \`Playfair Display SC\`

**Monospace:**
\`JetBrains Mono\` · \`Fira Code\` · \`Cascadia Code\` · \`Source Code Pro\` · \`IBM Plex Mono\` · \`Noto Sans Mono\` · \`Victor Mono\` · \`Courier Prime\` · \`Hack\` · \`Inconsolata\` · \`Recursive\` · \`Monaspace\`

**Display & Decorative:**
\`Workbench\` · \`Bungee\` · \`Bungee Inline\` · \`Press Start 2P\` · \`Orbitron\` · \`Audiowide\` · \`Rama Gothic\` · \`Tomorrow\` · \`Varta\` · \`Yanone Kaffeesatz\`

**Handwriting & Script:**
\`Shadows Into Light\` · \`Caveat\` · \`Amatic SC\` · \`Dancing Script\` · \`Yellowtail\` · \`Pacifico\` · \`Sacramento\` · \`Satisfy\` · \`Indie Flower\` · \`Gloria Hallelujah\`

**Symbols:**
\`Noto Color Emoji\` · \`Noto Symbols\` · \`Noto Music\` · \`Noto Sans Math\`

---

## 3D Volumes

Generate and render 3D content:

\`\`\`
search synth3d, render
noise3d().write3d(vol0, geo0)
read3d(vol0, geo0).render3d().write(o0)
\`\`\`

---

## Effect Reference

`;
    
    // Generate effect lists from manifest
    const effectListMarkdown = generateEffectListMarkdown();
    
    renderDocContent(placeholder + effectListMarkdown);
}
