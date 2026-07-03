/**
 * Polymorphic - Live Coding Entry Point
 *
 * Initializes the full-page canvas shader renderer with DSL editor.
 * Hot reload functionality for live coding experience.
 */

const APP_VERSION = '0.11'

import { AboutDialog, dslTokenizer } from 'handfish'
import { PolymorphicRenderer } from './noisemaker/renderer.js'
import { ProgramState, getEffect } from './noisemaker/bundle.js'
import { restoreMediaUrls } from './noisemaker/dslSanitize.js'
import { preloadFontsForDsl } from './fontLoader.js'
import { initDocReader, toggleDocReader, showPlaceholderContent, hideDocReader, showDocReader, setApplyToEditorCallback, isDocReaderVisible, loadEffectHelp } from './docReader.js'
import { shareModal } from './shareModal.js'
import { loadFromCode, getCodeFromUrl, registerPortableEffect, getLoadedPortableEffects } from './sharingLoader.js'
import { initProgramModal, openProgramModal } from './programModal.js'
import { ImportEffectDialog } from './ui/import-effect-dialog.js'
import { importFromUrlDialog } from './ui/import-from-url-dialog.js'
import { commandPalette } from './ui/commandPalette.js'
import { buildPaletteActions } from './ui/paletteActions.js'
import { formatDsl } from './ui/formatter.js'
import { insertAtCursor, getSelectionOrBlock, blockRangeAt } from './ui/editorActions.js'
import { attachScrubber } from './ui/scrubber.js'
import { liveInputsPanel } from './ui/liveInputsPanel.js'
import { recorder } from './ui/recorder.js'
import { perfOverlay } from './ui/perfOverlay.js'
import { gallery, pickRandomExample } from './ui/gallery.js'
import { snapshotHistory } from './ui/snapshotHistory.js'
import { tempoController } from './ui/tempo.js'
import { statusRow } from './ui/statusRow.js'
import { shortcutsDialog } from './ui/shortcutsDialog.js'
import { outputPicker } from './ui/outputPicker.js'
import { configureViewportWindow, openViewportWindow } from './ui/viewportWindow.js'
import { scenes } from './ui/scenes.js'
import { attachTouchControls } from './ui/touchControls.js'
import { applyEmbedMode } from './ui/embedMode.js'
import { parseErrorLocation } from './ui/errorBanner.js'
import { createPolymorphicOnlineAdapter } from './onlineAdapter.js'
import './ui/codeEditor.js'  // Polymorphic editor CSS; handfish registers and owns the element behavior.
import './ui/effectControls.js' // Register <effect-controls> custom element
import { findCallSiteAtOffset, reresolveCallSite } from './ui/effectClickResolver.js'

// DOM elements
const canvas = document.getElementById('canvas')
const loadingEl = document.getElementById('loading')
const errorEl = document.getElementById('error')
const dslOverlay = document.getElementById('dsl-overlay')
const dslEditor = document.getElementById('dsl-editor')
dslEditor?.setTokenizer?.(dslTokenizer)
const compilerErrorEl = document.getElementById('compiler-error')
const docReaderClose = document.querySelector('.doc-reader-close')

// Menu bar elements
const codeToggleBtn = document.getElementById('code-toggle-btn')
const docToggleBtn = document.getElementById('doc-toggle-btn')
const fullscreenBtnMenu = document.getElementById('fullscreen-btn-menu')
const playPauseBtnMenu = document.getElementById('play-pause-btn-menu')
const inputsToggleBtn = document.getElementById('inputs-toggle-btn')
const recordToggleBtn = document.getElementById('record-toggle-btn')
const perfToggleBtn = document.getElementById('perf-toggle-btn')
const galleryBtn = document.getElementById('gallery-btn')

// Menu items
const resetMenuItem = document.getElementById('resetMenuItem')
const shareProgram = document.getElementById('shareProgram')
const copyProgram = document.getElementById('copyProgram')
const pasteProgram = document.getElementById('pasteProgram')
const saveProgram = document.getElementById('saveProgram')
const loadProgram = document.getElementById('loadProgram')
const deleteProgram = document.getElementById('deleteProgram')
const savePNG = document.getElementById('savePNG')
const saveJPG = document.getElementById('saveJPG')
const aboutMenuItem = document.getElementById('aboutMenuItem')
const docsMenuItem = document.getElementById('docsMenuItem')
const takeOnlineMenuItem = document.getElementById('takeOnlineMenuItem')
const joinSessionMenuItem = document.getElementById('joinSessionMenuItem')
const goOfflineMenuItem = document.getElementById('goOfflineMenuItem')
const onlineSessionStatus = document.getElementById('online-session-status')
const joinSessionDialog = document.getElementById('join-session-dialog')

// Renderer reference (set after initialization)
let renderer = null

// ProgramState (single source of truth for effect parameter values)
let programState = null

// Seance online collaboration adapter. Lazily loads/connects the SDK only when
// the user takes or joins a session, or when ?seance= activates on boot.
let onlineAdapter = null

// Effect controls panel element (created on-demand and inserted in #dsl-overlay)
let controlsPanel = null

// The currently-open call site (when controlsPanel is showing)
let activeCallSite = null

// Flag to suppress reactive sync while we mutate the DSL programmatically
let suppressDslReact = false

// Hot reload state
let hotReloadTimeout = null

// Single-flight compile gate. Three paths can fire near-simultaneously
// (forcerecompile / forceevalblock / scheduleHotReload). While a compile is
// in progress we drop the manual paths and re-arm the debounced one so the
// GL state never flips mid-compile.
let _compileInFlight = false

// Original DSL (for reset functionality)
let originalDsl = ''

// Playback state
let isPlaying = false

// True when the current sketch was loaded via ?code= (a sharing URL). When
// true, we skip URL-stamping on each compile so we don't accidentally
// shadow the short link with a verbose ?dsl=. The user can still manually
// share via the share modal.
let loadedFromShareCode = false

// =========================================================================
// Imported Effect Storage (for the "edit in <app>" menu options)
// =========================================================================

/**
 * Store for the last imported effect files.
 * This allows us to transport the effect to other apps via sharing-is-caring.
 * Structure: { files: Map<string, string>, name: string }
 */
let importedEffectStore = {
    files: new Map(),
    name: ''
}

// =========================================================================
// Import from ZIP Dialog
// =========================================================================

const importEffectDialog = new ImportEffectDialog()

// Set up the callback for when an effect is imported from ZIP
importEffectDialog.onEffectImport(async ({ name, files }) => {
    // Parse definition - handle both JSON and JS formats
    const defContent = files['definition.json'] || files['definition.js']
    if (!defContent) {
        throw new Error('No definition file found in ZIP')
    }

    let definition
    if (files['definition.json']) {
        // JSON format - parse directly
        try {
            definition = JSON.parse(defContent)
        } catch (e) {
            throw new Error('Failed to parse definition.json: ' + e.message)
        }
    } else {
        // JS format - extract properties via regex (like noisedeck does)
        definition = parseDefinitionJs(defContent, name)
    }

    // Build shaders object
    const shaders = {}
    for (const [path, content] of Object.entries(files)) {
        if (path.startsWith('glsl/') && path.endsWith('.glsl')) {
            const programName = path.slice(5, -5) // Remove 'glsl/' and '.glsl'
            if (!shaders[programName]) shaders[programName] = {}
            shaders[programName].glsl = content
        } else if (path.startsWith('wgsl/') && path.endsWith('.wgsl')) {
            const programName = path.slice(5, -5) // Remove 'wgsl/' and '.wgsl'
            if (!shaders[programName]) shaders[programName] = {}
            shaders[programName].wgsl = content
        }
    }

    // Determine passes - use stored passes from definition if available,
    // otherwise create correct pass structure based on effect type (same as shade/foundry)
    let passes
    if (definition.passes && Array.isArray(definition.passes) && definition.passes.length > 0) {
        passes = definition.passes
    } else {
        // Create correct pass structure based on starter flag
        const firstProgram = Object.keys(shaders)[0]
        const isStarter = definition.starter === true
        
        if (isStarter) {
            // Starter effect: no input, just output
            passes = [
                {
                    name: 'render',
                    program: firstProgram,
                    inputs: {},
                    outputs: { color: 'outputTex' }
                }
            ]
        } else {
            // Filter effect: takes input, produces output
            passes = [
                {
                    name: 'render',
                    program: firstProgram,
                    inputs: { inputTex: 'inputTex' },
                    outputs: { color: 'outputTex' }
                }
            ]
        }
    }

    // Build effect data for registerPortableEffect
    const effectData = {
        name: definition.name || definition.func || name,
        func: definition.func || definition.name || name,
        namespace: 'user',
        description: definition.description || '',
        tags: definition.tags || ['user'],
        globals: definition.globals || {},
        passes,
        shaders,
        asyncInit: async () => {}
    }

    // Register the effect
    registerPortableEffect(effectData)

    // Store the imported files for the "edit in <app>" menu options
    importedEffectStore.files.clear()
    importedEffectStore.name = effectData.func || name
    for (const [path, content] of Object.entries(files)) {
        importedEffectStore.files.set(path, content)
    }
    // Store definition.json if only definition.js was present
    if (!files['definition.json'] && definition) {
        importedEffectStore.files.set('definition.json', JSON.stringify(definition, null, 2))
    }

    // Get DSL from imported files or generate one
    let dsl = files['dsl.txt']
    if (!dsl) {
        dsl = `search user\n\n${effectData.func}().write(o0)`
    }

    // Update the DSL editor
    if (dslEditor) {
        dslEditor.value = dsl
        publishLocalDsl('import-effect')
    }

    // Compile and run
    const result = await recompileShader()
    if (!result.success) {
        showCompilerError(result.error)
    } else {
        hideCompilerError()
    }

    // Show success message
    console.log(`[Polymorphic] Imported effect: ${effectData.func}`)
    
    // Show toast notification
    showImportToast(`Effect "${effectData.func}" imported!`)
})

/**
 * Show a temporary toast notification
 * @param {string} message
 */
function showImportToast(message) {
    // Remove any existing toast
    const existing = document.querySelector('.import-toast')
    if (existing) existing.remove()

    const toast = document.createElement('div')
    toast.className = 'import-toast'
    toast.textContent = message
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(102, 126, 234, 0.95);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: toast-in 0.3s ease;
    `
    document.body.appendChild(toast)

    // Add animation keyframes if not present
    if (!document.getElementById('import-toast-styles')) {
        const style = document.createElement('style')
        style.id = 'import-toast-styles'
        style.textContent = `
            @keyframes toast-in {
                from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `
        document.head.appendChild(style)
    }

    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0'
        toast.style.transition = 'opacity 0.3s ease'
        setTimeout(() => toast.remove(), 300)
    }, 4000)
}

/**
 * Parse a definition.js class file and extract effect properties
 * @param {string} jsContent - The JS class content
 * @param {string} fallbackName - Fallback effect name
 * @returns {object} Parsed definition object
 */
function parseDefinitionJs(jsContent, fallbackName) {
    const def = {
        name: fallbackName,
        namespace: 'user',
        func: fallbackName,
        description: '',
        tags: ['user'],
        globals: {},
        passes: []
    }

    // Extract name
    const nameMatch = jsContent.match(/name\s*[=:]\s*['"]([^'"]+)['"]/)
    if (nameMatch) def.name = nameMatch[1]

    // Extract func
    const funcMatch = jsContent.match(/func\s*[=:]\s*['"]([^'"]+)['"]/)
    if (funcMatch) def.func = funcMatch[1]
    else def.func = def.name

    // Extract namespace
    const nsMatch = jsContent.match(/namespace\s*[=:]\s*['"]([^'"]+)['"]/)
    if (nsMatch) def.namespace = nsMatch[1]

    // Extract description
    const descMatch = jsContent.match(/description\s*[=:]\s*['"]([^'"]+)['"]/)
    if (descMatch) def.description = descMatch[1]

    // Extract globals - look for globals = { ... } or globals: { ... }
    const globalsMatch = jsContent.match(/globals\s*[=:]\s*(\{[\s\S]*?\})\s*[;,]?\s*(?=\n\s*(?:passes|constructor|\})|$)/)
    if (globalsMatch) {
        try {
            def.globals = eval('(' + globalsMatch[1] + ')')
        } catch (e) {
            console.warn('[Import] Could not parse globals:', e)
        }
    }

    // Extract passes
    const passesMatch = jsContent.match(/passes\s*[=:]\s*(\[[\s\S]*?\])\s*[;,]?\s*(?=\n\s*(?:globals|constructor|\})|$)/)
    if (passesMatch) {
        try {
            def.passes = eval('(' + passesMatch[1] + ')')
        } catch (e) {
            console.warn('[Import] Could not parse passes:', e)
        }
    }

    // Extract tags
    const tagsMatch = jsContent.match(/tags\s*[=:]\s*(\[[^\]]*\])/)
    if (tagsMatch) {
        try {
            def.tags = eval('(' + tagsMatch[1] + ')')
        } catch (e) {
            console.warn('[Import] Could not parse tags:', e)
        }
    }

    return def
}

/**
 * Default DSL program for new sessions
 */
const DEFAULT_DSL = `search synth, filter

perlin(scale: 75, octaves: 2)
  .adjust(
    mode: hsv,
    rotation: 120,
    hueRange: 40
  )
  .write(o0)

render(o0)`

/**
 * Show compiler error with line-level span wrapping
 */
function showCompilerError(errorText) {
    if (!compilerErrorEl) return
    const loc = parseErrorLocation(errorText)
    let label = errorText
    if (loc) label = `line ${loc.line}:${loc.col} — ${errorText}`
    const escaped = label.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    compilerErrorEl.innerHTML = `<span>${escaped}</span>`
    compilerErrorEl.classList.add('visible')
}

/**
 * Hide compiler error
 */
function hideCompilerError() {
    if (!compilerErrorEl) return
    compilerErrorEl.classList.remove('visible')
}

/**
 * Toggle play/pause state
 */
function togglePlayPause() {
    if (!renderer || !playPauseBtnMenu) return
    
    isPlaying = !isPlaying
    
    if (isPlaying) {
        renderer.start()
        playPauseBtnMenu.textContent = 'pause'
        playPauseBtnMenu.setAttribute('data-title', 'pause')
        playPauseBtnMenu.setAttribute('aria-label', 'Pause animation')
        canvas.classList.remove('paused')
    } else {
        renderer.stop()
        playPauseBtnMenu.textContent = 'play_arrow'
        playPauseBtnMenu.setAttribute('data-title', 'play')
        playPauseBtnMenu.setAttribute('aria-label', 'Play animation')
        canvas.classList.add('paused')
    }
}

/**
 * Wire drag-and-drop for image/video files. Dropping a media file:
 *  - For images: inserts a media(url: "<data-url>").write(o0) snippet
 *  - For videos: hands the file off to the live inputs panel as the active
 *    video source.
 */
function setupFileDrop() {
    const dropTarget = document.body
    let dragCounter = 0

    const overlay = document.createElement('div')
    overlay.className = 'file-drop-overlay'
    overlay.innerHTML = `
        <div class="file-drop-message">
            <span class="icon-material">file_upload</span>
            <span>Drop image or video to use as source</span>
        </div>
    `
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(102, 126, 234, 0.18);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 6000;
        display: none;
        justify-content: center; align-items: center;
        pointer-events: none;
    `
    overlay.querySelector('.file-drop-message').style.cssText = `
        background: rgba(15,17,22,0.95);
        border: 2px dashed rgba(165,184,255,0.6);
        color: #fff;
        padding: 1.5rem 2rem;
        border-radius: 12px;
        font-size: 1rem;
        display: flex;
        align-items: center;
        gap: 0.65rem;
        font-family: 'Nunito', sans-serif;
    `
    overlay.querySelector('.icon-material').style.fontSize = '24px'
    document.body.appendChild(overlay)

    dropTarget.addEventListener('dragenter', (e) => {
        e.preventDefault()
        if (!hasDraggedFiles(e)) return
        dragCounter++
        overlay.style.display = 'flex'
    })
    dropTarget.addEventListener('dragover', (e) => {
        if (hasDraggedFiles(e)) e.preventDefault()
    })
    dropTarget.addEventListener('dragleave', (e) => {
        // Match the dragenter guard so non-files drags don't underflow the counter
        if (!hasDraggedFiles(e)) return
        dragCounter = Math.max(0, dragCounter - 1)
        if (dragCounter === 0) overlay.style.display = 'none'
    })
    dropTarget.addEventListener('drop', async (e) => {
        if (!hasDraggedFiles(e)) return
        e.preventDefault()
        dragCounter = 0
        overlay.style.display = 'none'
        const file = e.dataTransfer.files[0]
        if (!file) return
        await handleDroppedFile(file)
    })
}

function hasDraggedFiles(e) {
    const types = e.dataTransfer?.types || []
    for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true
    }
    return false
}

async function handleDroppedFile(file) {
    if (file.type.startsWith('image/')) {
        const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader()
            r.onload = () => res(r.result)
            r.onerror = rej
            r.readAsDataURL(file)
        })
        if (dslEditor) {
            insertAtCursor(dslEditor, `\n\nmedia(url: "${dataUrl}").write(o0)\n\nrender(o0)`)
            publishLocalDsl('drop-media')
            showToast(`Loaded image: ${file.name}`, 'success')
        }
        return
    }
    if (file.type.startsWith('video/')) {
        await liveInputsPanel.useVideoFile(file)
        showToast(`Using video: ${file.name}`, 'success')
        return
    }
    showToast(`Unsupported file type: ${file.type || 'unknown'}`, 'warning')
}

/**
 * Toggle performance mode — hides every panel, menu, and overlay so only the
 * canvas is visible. Useful for projection / VJ sets / clean recording.
 */
function togglePerformanceMode() {
    document.body.classList.toggle('performance-mode')
    const on = document.body.classList.contains('performance-mode')
    showToast(on ? 'Performance mode — press ⌘⇧H or Esc to exit' : 'Performance mode off', 'info')
}

/**
 * Toggle fullscreen mode
 */
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        // Enter fullscreen
        document.documentElement.requestFullscreen().catch(err => {
            console.error('Failed to enter fullscreen:', err)
        })
    } else {
        // Exit fullscreen
        document.exitFullscreen().catch(err => {
            console.error('Failed to exit fullscreen:', err)
        })
    }
}

/**
 * Update fullscreen button icon based on current state
 */
function updateFullscreenButton() {
    if (!fullscreenBtnMenu) return
    fullscreenBtnMenu.textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen'
}

/**
 * About Dialog (handfish AboutDialog component)
 */
const aboutDialog = new AboutDialog({
    name: 'Polymorphic',
    version: APP_VERSION,
    tagline: 'Live Shader Coding Environment',
    logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" fill="currentColor"><g transform="translate(0,600) scale(0.1,-0.1)"><path d="M3920 5709 c-248 -32 -507 -143 -790 -337 -282 -194 -349 -237 -426 -273 -178 -84 -313 -93 -571 -35 -246 55 -390 46 -560 -33 -133 -63 -288 -192 -382 -320 -151 -205 -169 -380 -64 -639 102 -254 266 -430 506 -542 337 -158 633 -99 816 161 65 92 103 201 147 417 41 204 68 288 126 390 147 257 354 383 577 352 107 -14 189 -57 273 -142 238 -242 203 -643 -87 -978 -132 -153 -293 -269 -673 -487 -263 -151 -533 -321 -692 -439 -277 -204 -450 -460 -499 -738 -31 -172 11 -257 146 -297 39 -11 45 -10 81 13 93 62 198 105 337 139 76 19 118 23 275 23 160 -1 197 -4 270 -23 105 -28 224 -84 309 -145 71 -50 103 -57 164 -31 52 22 93 60 111 105 21 53 39 292 31 415 -3 55 -13 161 -22 235 -24 208 -22 397 5 493 41 145 108 258 269 455 228 278 568 616 908 902 265 223 372 356 411 513 22 93 15 298 -15 412 -33 123 -65 181 -151 267 -111 111 -197 146 -409 168 -119 12 -327 11 -421 -1z"/><path d="M2316 1660 c-220 -35 -399 -121 -519 -250 -119 -128 -163 -247 -154 -415 9 -173 75 -340 187 -473 57 -67 152 -147 214 -179 113 -58 273 -77 416 -49 347 68 650 439 650 796 0 152 -41 242 -166 361 -165 157 -418 241 -628 209z"/></g></svg>`,
    titleFont: "'Comfortaa', 'Comfortaa Block', 'Nunito', 'Nunito Block'",
    repo: 'noisefactorllc/polymorphic',
    ecosystem: 'Polymorphic is a free tool by <a href="https://noisefactor.io/" target="_blank" rel="noopener">Noise Factor</a>, powered by the <a href="https://noisemaker.app/" target="_blank" rel="noopener">Noisemaker</a> open source engine. <a href="https://noisedeck.app/" target="_blank" rel="noopener">Noisedeck</a> is our video synth.',
})

fetch('./deployment-meta.json', { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) return
    const data = await res.json()
    const hash = data.git_hash?.trim().slice(0, 8) || 'LOCAL'
    const deployed = data.date ? new Date(data.date * 1000) : null
    aboutDialog.setBuild({ hash, deployed })
}).catch(() => {})

aboutDialog.setNoisemakerFromUrl('https://shaders.noisedeck.app/1/deployment-meta.json')

/**
 * Show error message
 */
function showError(message) {
    loadingEl.classList.remove('visible')
    errorEl.textContent = message
    errorEl.style.display = 'block'
}

/**
 * Show loading state
 */
function showLoading() {
    loadingEl.classList.add('visible')
}

/**
 * Hide loading and show canvas
 */
function showCanvas() {
    loadingEl.classList.remove('visible')
    canvas.classList.add('visible')
    
    // Show DSL editor by default
    if (codeToggleBtn) {
        codeToggleBtn.classList.add('active')
    }
    if (dslEditor) {
        dslEditor.focus()
    }
    
    isPlaying = true
}

function publishLocalDsl(source) {
    try {
        onlineAdapter?.updateLocalText(source)
    } catch (err) {
        console.debug('[Polymorphic] Online local text update failed:', err)
    }
}

async function applyCurrentDslFromOnline(source = 'remote') {
    if (hotReloadTimeout) {
        clearTimeout(hotReloadTimeout)
        hotReloadTimeout = null
    }
    const result = await recompileShader()
    if (!result.success) {
        console.warn(`Online ${source} compile failed:`, result.error)
        showCompilerError(result.error)
    } else {
        hideCompilerError()
        outputPicker.setDsl(dslEditor?.value || '').catch(err => console.debug('[outputPicker] setDsl failed:', err))
    }
    return result
}

function setupOnlineCollaboration() {
    if (!dslEditor || onlineAdapter) return
    onlineAdapter = createPolymorphicOnlineAdapter({
        editor: dslEditor,
        sessionStatus: onlineSessionStatus,
        joinDialog: joinSessionDialog,
        takeOnlineMenuItem,
        joinSessionMenuItem,
        goOfflineMenuItem,
        getCurrentDsl: () => dslEditor?.value || '',
        applyCurrentDsl: applyCurrentDslFromOnline,
        showToast,
    })
    onlineAdapter.wireUi()
}

async function joinOnlineSessionFromUrlIfPresent() {
    if (!onlineAdapter) return
    try {
        await onlineAdapter.joinFromUrl()
    } catch (err) {
        console.error('[Polymorphic] Failed to join Seance session from URL:', err)
        showToast(`Could not join session: ${err.message}`, 'error')
    }
}

/**
 * Update reset button visibility based on whether DSL has been modified
 * (No longer used - reset is now a menu item, but kept for API compatibility)
 */
function updateResetButtonVisibility() {
    // No-op: reset functionality moved to Edit menu
}

/**
 * Reset DSL to original value
 */
async function resetDsl() {
    if (!dslEditor) return
    dslEditor.value = originalDsl
    publishLocalDsl('reset')
    // Update reset button visibility
    updateResetButtonVisibility()
    // Recompile with original DSL
    const result = await recompileShader()
    if (!result.success) {
        showCompilerError(result.error)
    } else {
        hideCompilerError()
    }
}

// =========================================================================
// Edit in other apps
// =========================================================================

const SHARE_API_URL = 'https://sharing.noisedeck.app/api/embed/shorten'
const NOISEDECK_URL = 'https://noisedeck.app'
const NOODLES_URL = 'https://noodles.noisedeck.app'

/**
 * Show a toast notification (styled like the import toast)
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 */
function showToast(message, type = 'info') {
    // Remove any existing toast
    const existing = document.querySelector('.polymorphic-toast')
    if (existing) existing.remove()

    const colors = {
        info: 'rgba(102, 126, 234, 0.95)',
        success: 'rgba(74, 222, 128, 0.95)',
        warning: 'rgba(251, 191, 36, 0.95)',
        error: 'rgba(239, 68, 68, 0.95)'
    }

    const toast = document.createElement('div')
    toast.className = 'polymorphic-toast'
    toast.textContent = message
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: toast-in 0.3s ease;
    `
    document.body.appendChild(toast)

    // Add animation keyframes if not present
    if (!document.getElementById('polymorphic-toast-styles')) {
        const style = document.createElement('style')
        style.id = 'polymorphic-toast-styles'
        style.textContent = `
            @keyframes toast-in {
                from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `
        document.head.appendChild(style)
    }

    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0'
        toast.style.transition = 'opacity 0.3s ease'
        setTimeout(() => toast.remove(), 300)
    }, 4000)
}

/**
 * Generic handler to share and open in another app
 * @param {string} appName - Name of the target app (for messages)
 * @param {string} appUrl - Base URL of the target app
 */
async function handleEditInApp(appName, appUrl) {
    // Get DSL from editor
    let dsl = dslEditor?.value || ''
    if (!dsl) {
        showToast('Nothing to edit. Create an effect first!', 'warning')
        return
    }

    showToast(`Opening in ${appName}...`, 'info')

    try {
        // Capture screenshot
        let screenshot = null
        try {
            const targetWidth = 1200
            const targetHeight = 630
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = targetWidth
            tempCanvas.height = targetHeight
            const ctx = tempCanvas.getContext('2d')
            const sourceAspect = canvas.width / canvas.height
            const targetAspect = targetWidth / targetHeight
            let sx, sy, sw, sh
            if (sourceAspect > targetAspect) {
                sh = canvas.height
                sw = canvas.height * targetAspect
                sx = (canvas.width - sw) / 2
                sy = 0
            } else {
                sw = canvas.width
                sh = canvas.width / targetAspect
                sx = 0
                sy = (canvas.height - sh) / 2
            }
            ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
            screenshot = tempCanvas.toDataURL('image/jpeg', 0.85)
        } catch (err) {
            console.warn(`[${appName}] Screenshot capture failed:`, err)
        }

        // Collect all effect ZIPs
        const effectZips = []

        // First, check importedEffectStore (from ZIP import)
        const defJson = importedEffectStore.files.get('definition.json')
        const glslFiles = Array.from(importedEffectStore.files.keys()).filter(
            p => p.startsWith('glsl/') && p.endsWith('.glsl')
        )
        const wgslFiles = Array.from(importedEffectStore.files.keys()).filter(
            p => p.startsWith('wgsl/') && p.endsWith('.wgsl')
        )

        if (defJson && (glslFiles.length > 0 || wgslFiles.length > 0)) {
            try {
                // Load JSZip if needed
                if (!window.JSZip) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script')
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
                        script.onload = resolve
                        script.onerror = () => reject(new Error('Failed to load JSZip'))
                        document.head.appendChild(script)
                    })
                }

                const zip = new window.JSZip()
                zip.file('definition.json', defJson)

                // Add all GLSL shaders
                for (const path of glslFiles) {
                    zip.file(path, importedEffectStore.files.get(path))
                }

                // Add all WGSL shaders
                for (const path of wgslFiles) {
                    zip.file(path, importedEffectStore.files.get(path))
                }

                // Add help.md if present
                const helpMd = importedEffectStore.files.get('help.md')
                if (helpMd) {
                    zip.file('help.md', helpMd)
                }

                const zipBlob = await zip.generateAsync({ type: 'blob' })
                const reader = new FileReader()
                const effectZip = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result.split(',')[1])
                    reader.onerror = reject
                    reader.readAsDataURL(zipBlob)
                })
                effectZips.push(effectZip)
            } catch (err) {
                console.warn(`[${appName}] Effect ZIP creation failed:`, err)
            }
        }

        // Also check for effects loaded from sharing URLs
        // Skip if we already packaged from importedEffectStore (avoid duplicates)
        const alreadyPackagedName = importedEffectStore.name || null
        const loadedEffects = getLoadedPortableEffects()
        for (const [effectId, effectData] of loadedEffects) {
            const effectFunc = effectData.func || effectData.name
            // Skip if already packaged from importedEffectStore
            if (alreadyPackagedName && effectFunc === alreadyPackagedName) {
                continue
            }
            // Check if effect is referenced in DSL
            if (dsl.includes(effectFunc)) {
                try {
                    // Load JSZip if needed
                    if (!window.JSZip) {
                        await new Promise((resolve, reject) => {
                            const script = document.createElement('script')
                            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
                            script.onload = resolve
                            script.onerror = () => reject(new Error('Failed to load JSZip'))
                            document.head.appendChild(script)
                        })
                    }

                    const zip = new window.JSZip()

                    // Create definition.json
                    const definition = {
                        name: effectData.name || effectData.func,
                        func: effectData.func || effectData.name,
                        namespace: effectData.namespace || 'user',
                        description: effectData.description || '',
                        tags: effectData.tags || ['user'],
                        globals: effectData.globals || {},
                        passes: effectData.passes || []
                    }
                    zip.file('definition.json', JSON.stringify(definition, null, 2))

                    // Add shaders
                    const shaders = effectData.shaders || {}
                    for (const [programName, shader] of Object.entries(shaders)) {
                        if (shader.glsl) {
                            zip.file(`glsl/${programName}.glsl`, shader.glsl)
                        }
                        if (shader.wgsl) {
                            zip.file(`wgsl/${programName}.wgsl`, shader.wgsl)
                        }
                        if (shader.vertex) {
                            zip.file(`glsl/${programName}.vert`, shader.vertex)
                        }
                        if (shader.fragment) {
                            zip.file(`glsl/${programName}.frag`, shader.fragment)
                        }
                    }

                    const zipBlob = await zip.generateAsync({ type: 'blob' })
                    const reader = new FileReader()
                    const sharingEffectZip = await new Promise((resolve, reject) => {
                        reader.onload = () => resolve(reader.result.split(',')[1])
                        reader.onerror = reject
                        reader.readAsDataURL(zipBlob)
                    })
                    effectZips.push(sharingEffectZip)
                    console.log(`[${appName}] Packaged sharing effect: ${effectFunc}`)
                } catch (err) {
                    console.warn(`[${appName}] Failed to package sharing effect ${effectFunc}:`, err)
                }
            }
        }

        // Build payload
        const payload = {
            dsl,
            title: importedEffectStore.name || 'Polymorphic Effect',
            description: 'Created with Polymorphic',
            ttlMinutes: 60  // Reduced TTL for edit-in-app links
        }
        if (screenshot) payload.screenshot = screenshot
        if (effectZips.length > 0) payload.effects = effectZips

        // Upload to sharing service
        const response = await fetch(SHARE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.details || errorData.error || `HTTP ${response.status}`)
        }

        const result = await response.json()
        console.log(`[${appName}] Share result:`, result)

        // Open the target app with the short code
        const targetUrl = `${appUrl}/?code=${result.code}`
        window.open(targetUrl, '_blank')

        showToast(`Opened in ${appName}`, 'success')
    } catch (error) {
        console.error(`[${appName}] Error:`, error)
        showToast(`Failed to open in ${appName}: ${error.message}`, 'error')
    }
}

/**
 * Share the effect and open Noisedeck in a new window
 */
async function handleEditInNoisedeck() {
    return handleEditInApp('Noisedeck', NOISEDECK_URL)
}

/**
 * Share the effect and open Noodles in a new window
 */
async function handleEditInNoodles() {
    return handleEditInApp('Noodles', NOODLES_URL)
}

/**
 * Handle loading a composition from a sharing URL
 * @param {object} composition - The loaded composition data
 */
function handleLoadFromUrl(composition) {
    if (!composition) return
    
    console.log('[Polymorphic] Loaded composition from URL:', composition.title || 'Untitled')
    
    // Set DSL from composition
    if (composition.dsl && dslEditor) {
        dslEditor.value = composition.dsl
        publishLocalDsl('import-url')
        
        // Trigger rebuild
        recompileShader().catch(err => {
            console.error('[Polymorphic] Failed to build loaded DSL:', err)
        })
    }
    
    showToast(`Loaded: ${composition.title || 'Imported composition'}`, 'success')
}

/**
 * Toggle DSL overlay visibility
 */
function toggleDslOverlay() {
    if (!dslOverlay) return
    const isHidden = dslOverlay.style.display === 'none'
    dslOverlay.style.display = isHidden ? '' : 'none'
    if (codeToggleBtn) {
        codeToggleBtn.classList.toggle('active', isHidden)
    }
    // Hide compiler error when editor is closed
    if (!isHidden) {
        hideCompilerError()
    }
    // Focus the editor when shown
    if (isHidden && dslEditor) {
        dslEditor.focus()
    }
}

/**
 * Get DSL from URL parameters, embed, or null if there's no caller-provided sketch.
 * Callers fall back to a random gallery example when this returns null.
 */
function getDslFromUrl() {
    if (window.EMBEDDED_DSL) {
        return window.EMBEDDED_DSL
    }
    const params = new URLSearchParams(window.location.search)
    const dsl = params.get('dsl')
    return dsl || null
}

/**
 * Resize canvas buffer to match CSS-rendered viewport size.
 * Uses 50% pixel density for high-resolution displays to maintain performance.
 */
function resizeCanvas() {
    const baseDpr = window.devicePixelRatio || 1
    
    // Get the CSS-rendered size from the canvas element itself
    // The canvas is 100vw x 100vh via CSS, so clientWidth/Height gives exact viewport
    // When canvas is hidden (display:none), clientWidth/Height are 0, so use window dimensions
    const cssWidth = canvas.clientWidth || window.innerWidth
    const cssHeight = canvas.clientHeight || window.innerHeight
    
    // Check if rendered size would exceed HD threshold
    const renderedWidth = cssWidth * baseDpr
    const renderedHeight = cssHeight * baseDpr
    const isHighRes = renderedWidth > 1920 || renderedHeight > 1080
    const dpr = isHighRes ? baseDpr * 0.5 : baseDpr
    
    // Calculate buffer size - matches viewport exactly
    const bufferWidth = Math.max(1, Math.floor(cssWidth * dpr))
    const bufferHeight = Math.max(1, Math.floor(cssHeight * dpr))
    
    // Always update to ensure correct size
    canvas.width = bufferWidth
    canvas.height = bufferHeight
    
    return { width: bufferWidth, height: bufferHeight }
}

/**
 * Recompile the shader with current editor content
 * @param {string} [overrideDsl] - if provided, compile this DSL instead of the editor value
 */
async function recompileShader(overrideDsl) {
    if (!renderer || !dslEditor) return { success: false, error: 'Not initialized' }

    const dsl = overrideDsl ?? dslEditor.value
    if (!dsl.trim()) {
        return { success: false, error: 'Empty program' }
    }

    try {
        // Preload any new fonts used in text effects
        await preloadFontsForDsl(dsl)

        const result = await renderer.compile(dsl)
        if (result.success) {
            syncProgramStateFromDsl(dsl)
            refreshControlsPanelAfterDslChange(dsl)
        }
        return result
    } catch (err) {
        console.error('Recompile error:', err)
        return { success: false, error: err.message }
    }
}

/**
 * Build a runnable DSL program from a snippet (e.g., a single chain).
 * - If snippet already has `search`, leave it alone.
 * - Otherwise prepend a permissive search line.
 * - If snippet has no `render(...)` call, append `render(o0)`.
 */
function buildRunnableProgram(snippet) {
    const trimmed = snippet.trim()
    if (!trimmed) return ''
    let program = trimmed
    // Auto-search if the snippet doesn't already declare one
    if (!/^\s*search\s+/m.test(program)) {
        program = 'search synth, filter, mixer, render, points\n\n' + program
    }
    // Ensure something will be rendered. If the snippet writes to o0..o7 but
    // doesn't render, append a render(o0). We don't add render if the snippet
    // already has one (renders multiple outputs is rare but allowed).
    const hasRender = /(^|\n)\s*render\s*\(/.test(program)
    const writesO = /\.write\s*\(\s*o[0-7]/.test(program)
    if (!hasRender) {
        // Pick the lowest output index that's written to, default o0
        const writes = [...program.matchAll(/\.write\s*\(\s*(o[0-7])/g)].map(m => m[1])
        const target = writes.length ? writes[0] : 'o0'
        if (writesO || writes.length) {
            program += `\n\nrender(${target})`
        }
    }
    return program
}

/**
 * Compute 1-based line number for a character index in text.
 */
function lineNumberAt(text, index) {
    let line = 1
    for (let i = 0; i < index && i < text.length; i++) {
        if (text[i] === '\n') line++
    }
    return line
}

/**
 * Push the current DSL into ProgramState. Suppresses reactive DSL writes
 * while the load is in progress.
 */
function syncProgramStateFromDsl(dsl) {
    if (!programState) return
    suppressDslReact = true
    try {
        programState.fromDsl(dsl)
    } catch (err) {
        console.warn('[Polymorphic] programState.fromDsl failed:', err)
    } finally {
        suppressDslReact = false
    }
}

/**
 * After a DSL change, re-resolve the panel's call site so its stepIndex stays
 * valid. Closes the panel if the effect can no longer be located.
 */
function refreshControlsPanelAfterDslChange(dsl) {
    if (!controlsPanel || !activeCallSite) return
    if (controlsPanel.hasAttribute('hidden')) return
    const next = reresolveCallSite(dsl, activeCallSite)
    if (!next) {
        closeControlsPanel()
        return
    }
    activeCallSite = next
    if (controlsPanel.effectInfo) {
        controlsPanel.updateEffectInfo(next.effect)
    }
}

/**
 * Resolve an effect definition for a given effect info object. Tries several
 * key forms because effects can be looked up by `namespace/name`, `namespace.name`,
 * or just `name` depending on how they were registered.
 */
function lookupEffectDef(effectInfo) {
    if (!effectInfo) return null
    const tryKey = (k) => (k ? getEffect(k) : null)
    let def = tryKey(effectInfo.fullName)
    if (def) return def
    if (effectInfo.fullName?.includes('/')) {
        def = tryKey(effectInfo.fullName.replace('/', '.'))
        if (def) return def
    }
    if (effectInfo.fullName?.includes('.')) {
        def = tryKey(effectInfo.fullName.replace('.', '/'))
        if (def) return def
    }
    if (effectInfo.namespace && effectInfo.name) {
        def = tryKey(`${effectInfo.namespace}/${effectInfo.name}`)
        if (def) return def
        def = tryKey(`${effectInfo.namespace}.${effectInfo.name}`)
        if (def) return def
    }
    def = tryKey(effectInfo.name)
    return def || null
}

/**
 * Build (lazily) the effect controls panel and append it to #dsl-overlay.
 */
function ensureControlsPanel() {
    if (controlsPanel) return controlsPanel
    if (!dslOverlay) return null

    controlsPanel = document.createElement('effect-controls')
    controlsPanel.id = 'effect-controls-panel'
    controlsPanel.programState = programState
    controlsPanel.docCallback = (effectId) => {
        loadEffectHelp(effectId)
        showDocReader()
        if (docToggleBtn) docToggleBtn.classList.add('active')
    }
    controlsPanel.enums = renderer?.canvasRenderer?.enums || {}

    controlsPanel.addEventListener('panelclose', () => closeControlsPanel())
    dslOverlay.appendChild(controlsPanel)
    return controlsPanel
}

function closeControlsPanel() {
    if (!controlsPanel) return
    controlsPanel.hide()
    activeCallSite = null
    if (dslOverlay) dslOverlay.classList.remove('controls-open')
}

/**
 * Open the controls panel for the call site found at the click caret offset.
 */
function handleEffectClick(detail) {
    const dsl = detail?.dsl ?? dslEditor?.value ?? ''
    const caret = typeof detail?.caretOffset === 'number' ? detail.caretOffset : 0
    const site = findCallSiteAtOffset(dsl, caret)
    if (!site) return

    const def = lookupEffectDef(site.effect)
    if (!def) {
        // Effect schema not (yet) loaded; do nothing rather than show an empty panel.
        return
    }

    const panel = ensureControlsPanel()
    if (!panel) return

    activeCallSite = site
    panel.enums = renderer?.canvasRenderer?.enums || {}
    panel.show({ effectInfo: site.effect, effectDef: def })
    if (dslOverlay) dslOverlay.classList.add('controls-open')
}

/**
 * Set up DSL editor with hot reload
 */
function setupDslEditor() {
    if (!dslEditor) return

    // Hot reload: recompile DSL 500ms after user stops typing
    // The code-editor component dispatches 'input' events when content changes
    dslEditor.addEventListener('input', () => {
        // Update reset button visibility
        updateResetButtonVisibility()

        // Schedule hot reload
        scheduleHotReload()
    })

    // Handle force recompile event from Ctrl/Cmd+Enter
    // The code-editor component dispatches 'forcerecompile' events
    dslEditor.addEventListener('forcerecompile', async () => {
        // Single-flight gate: drop this call if a compile is already running
        if (_compileInFlight) {
            const overlay = document.getElementById('dsl-overlay')
            if (overlay) {
                overlay.classList.remove('busy')
                void overlay.offsetWidth
                overlay.classList.add('busy')
            }
            return
        }
        // Clear pending hot reload
        if (hotReloadTimeout) {
            clearTimeout(hotReloadTimeout)
            hotReloadTimeout = null
        }
        try {
            _compileInFlight = true
            const result = await recompileShader()
            const value = dslEditor.value || ''
            const lineCount = value ? value.split('\n').length : 1
            if (!result.success) {
                console.warn('Manual compile failed:', result.error)
                showCompilerError(result.error)
                dslEditor.flashLines?.(1, lineCount, { error: true })
            } else {
                hideCompilerError()
                dslEditor.flashLines?.(1, lineCount)
                if (value) snapshotHistory.push(value)
                outputPicker.setDsl(dslEditor.value).catch(err => console.debug('[outputPicker] setDsl failed:', err))
            }
        } finally {
            _compileInFlight = false
        }
    })

    // Cmd+Shift+Enter / Alt+Enter — evaluate current block (or selection)
    dslEditor.addEventListener('forceevalblock', async () => {
        // Single-flight gate: drop this call if a compile is already running
        if (_compileInFlight) {
            const overlay = document.getElementById('dsl-overlay')
            if (overlay) {
                overlay.classList.remove('busy')
                void overlay.offsetWidth
                overlay.classList.add('busy')
            }
            return
        }
        if (hotReloadTimeout) {
            clearTimeout(hotReloadTimeout)
            hotReloadTimeout = null
        }
        const sel = getSelectionOrBlock(dslEditor)
        if (!sel || !sel.text.trim()) {
            // Fall through to whole-program eval
            try {
                _compileInFlight = true
                const result = await recompileShader()
                if (!result.success) showCompilerError(result.error)
                else hideCompilerError()
            } finally {
                _compileInFlight = false
            }
            return
        }

        const program = buildRunnableProgram(sel.text)
        try {
            _compileInFlight = true
            const result = await recompileShader(program)
            const value = dslEditor.value || ''
            const startLine = lineNumberAt(value, sel.start)
            const endLine = lineNumberAt(value, Math.max(sel.start, sel.end - 1))
            if (!result.success) {
                console.warn('Block eval failed:', result.error)
                showCompilerError(result.error)
                dslEditor.flashLines?.(startLine, endLine, { error: true })
            } else {
                hideCompilerError()
                dslEditor.flashLines?.(startLine, endLine)
            }
        } finally {
            _compileInFlight = false
        }
    })

    // Cmd/Ctrl+Shift+F — format the DSL
    dslEditor.addEventListener('format', () => {
        const before = dslEditor.value
        const after = formatDsl(before)
        if (after === before) return
        const ta = dslEditor.getTextarea?.()
        const sel = ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null
        if (before.trim()) snapshotHistory.push(before)
        dslEditor.value = after
        publishLocalDsl('format')
        if (ta && sel) {
            const len = after.length
            ta.selectionStart = Math.min(sel.start, len)
            ta.selectionEnd = Math.min(sel.end, len)
        }
        scheduleHotReload()
    })

    // Open the controls panel when the user clicks on an effect call name.
    // The 'effectclick' event is for synthetic dispatch (tests/external code);
    // for real mouse clicks we listen to the textarea directly because the
    // active <code-editor> implementation may come from the handfish bundle
    // and not include the polymorphic-local click handler.
    dslEditor.addEventListener('effectclick', (e) => {
        handleEffectClick(e.detail)
    })
    const clickTextarea = typeof dslEditor.getTextarea === 'function' ? dslEditor.getTextarea() : null
    if (clickTextarea) {
        clickTextarea.addEventListener('click', () => {
            handleEffectClick({
                caretOffset: clickTextarea.selectionStart,
                dsl: dslEditor.value
            })
        })
    }
}

/**
 * Initialize ProgramState and wire it to push DSL/recompile updates.
 */
function setupProgramState() {
    if (!renderer) return
    programState = new ProgramState({ renderer: renderer.canvasRenderer })

    // When a parameter changes (via the panel), regenerate DSL and write it
    // back to the editor so the user sees their edit reflected. The renderer's
    // pipeline already received the live uniform update from ProgramState
    // itself, so non-`define` params update without recompile — feedback
    // surfaces and particle state are preserved.
    programState.on('change', () => {
        if (suppressDslReact) return
        if (!dslEditor || !programState) return
        let newDsl
        try {
            newDsl = programState.toDsl()
        } catch (err) {
            console.warn('[Polymorphic] programState.toDsl failed:', err)
            return
        }
        if (!newDsl) return
        // toDsl() regenerates from the engine's media-url-stripped DSL, so it
        // drops media() urls. Carry them back from the current editor text so a
        // parameter tweak doesn't silently strip the image on save/share/re-run.
        // The engine's currentDsl stays the stripped version (what it compiled).
        const editorDsl = restoreMediaUrls(dslEditor.value, newDsl)
        if (editorDsl === dslEditor.value) return
        suppressDslReact = true
        try {
            dslEditor.value = editorDsl
            if (renderer?.canvasRenderer) {
                renderer.canvasRenderer.currentDsl = newDsl
            }
        } finally {
            suppressDslReact = false
        }
        publishLocalDsl('program-state')
    })

    // For `define` params (those that affect shader compilation), ProgramState
    // emits 'recompileNeeded'. Honour it by triggering a recompile.
    programState.on('recompileNeeded', () => {
        if (suppressDslReact) return
        if (hotReloadTimeout) {
            clearTimeout(hotReloadTimeout)
            hotReloadTimeout = null
        }
        recompileShader().then((result) => {
            if (!result.success) {
                showCompilerError(result.error)
            } else {
                hideCompilerError()
            }
        })
    })
}

/**
 * Schedule a hot reload after a delay
 */
function scheduleHotReload() {
    // Clear any pending recompile
    if (hotReloadTimeout) {
        clearTimeout(hotReloadTimeout)
    }

    // Schedule recompile 500ms after typing stops
    hotReloadTimeout = setTimeout(async () => {
        hotReloadTimeout = null
        // Single-flight gate: if a compile is already in progress, re-arm
        // this timer for another 500ms instead of stomping on it.
        if (_compileInFlight) {
            scheduleHotReload()
            return
        }
        try {
            _compileInFlight = true
            const result = await recompileShader()
            if (!result.success) {
                console.warn('Hot reload compile failed:', result.error)
                showCompilerError(result.error)
            } else {
                hideCompilerError()
                // Snapshot the successful program state and stamp the URL so the
                // current sketch is shareable just by copying the URL.
                if (dslEditor?.value) {
                    snapshotHistory.push(dslEditor.value)
                    stampUrl(dslEditor.value)
                }
                outputPicker.setDsl(dslEditor?.value || '').catch(err => console.debug('[outputPicker] setDsl failed:', err))
            }
        } finally {
            _compileInFlight = false
        }
    }, 500)
}

/**
 * Update the browser URL to encode the current DSL.
 * Skipped entirely when the page was loaded via ?code= (we don't want to
 * shadow a short link with a verbose ?dsl=).
 *
 * Uses ?dsl= for short programs (encoded under 2KB) so the URL stays
 * pasteable. For oversize programs, we strip any stale ?dsl= so the URL
 * doesn't carry an old, smaller version.
 *
 * Throttled to once per 500ms to avoid spamming history entries while typing.
 */
let urlStampTimeout = null
function stampUrl(dsl) {
    if (loadedFromShareCode) return
    if (urlStampTimeout) return
    urlStampTimeout = setTimeout(() => {
        urlStampTimeout = null
        try {
            const url = new URL(window.location.href)
            const oversize = encodeURIComponent(dsl).length > 2000
            if (oversize) {
                // Drop any stale ?dsl= so the URL doesn't look right but
                // load wrong on next paste. Other params (?backend, etc.)
                // are preserved.
                if (url.searchParams.has('dsl')) {
                    url.searchParams.delete('dsl')
                    window.history.replaceState(null, '', url)
                }
                return
            }
            url.searchParams.set('dsl', dsl)
            // Use replaceState so we don't blow up the browser history with
            // every keystroke — the snapshot history covers in-app rewinds.
            window.history.replaceState(null, '', url)
        } catch (err) {
            console.debug('[Polymorphic] URL stamp failed:', err)
        }
    }, 500)
}

/**
 * Step backward in snapshot history (older successful program).
 */
function snapshotBack() {
    const prev = snapshotHistory.back()
    if (prev != null && dslEditor) {
        snapshotHistory.silence(() => {
            dslEditor.value = prev
        })
        publishLocalDsl('snapshot-back')
        // Recompile immediately, but don't re-snapshot
        if (hotReloadTimeout) { clearTimeout(hotReloadTimeout); hotReloadTimeout = null }
        recompileShader().then(r => {
            if (!r.success) showCompilerError(r.error)
            else hideCompilerError()
        })
    }
}

/**
 * Step forward in snapshot history (newer successful program).
 */
function snapshotForward() {
    const next = snapshotHistory.forward()
    if (next != null && dslEditor) {
        snapshotHistory.silence(() => {
            dslEditor.value = next
        })
        publishLocalDsl('snapshot-forward')
        if (hotReloadTimeout) { clearTimeout(hotReloadTimeout); hotReloadTimeout = null }
        recompileShader().then(r => {
            if (!r.success) showCompilerError(r.error)
            else hideCompilerError()
        })
    }
}

/**
 * Start the shader renderer
 */
async function startShader() {
    let dsl = null
    let title = null

    // Check for ?code= parameter to load from sharing API
    const code = getCodeFromUrl()
    if (code) {
        loadedFromShareCode = true
        showLoading()
        try {
            // Load composition and register any portable effects
            const composition = await loadFromCode(code)
            dsl = composition.dsl
            title = composition.title
        } catch (err) {
            console.error('Failed to load composition:', err)
            showError(`Failed to load shared composition: ${err.message}`)
            return
        }
    }

    // Fall back to other DSL sources
    if (!dsl) {
        dsl = getDslFromUrl()
    }

    // Fresh visit (no sketch in URL): boot a random gallery example.
    // Falls back to the bundled DEFAULT_DSL if the gallery fetch fails.
    if (!dsl) {
        try {
            const example = await pickRandomExample()
            if (example?.dsl) dsl = example.dsl
        } catch (err) {
            console.warn('[Polymorphic] Random example load failed:', err)
        }
    }

    if (!dsl) dsl = DEFAULT_DSL

    showLoading()

    // Set up canvas sizing
    const { width, height } = resizeCanvas()

    // Determine backend preference: ?backend= URL param wins, else localStorage,
    // else default WebGL2.
    const params = new URLSearchParams(window.location.search)
    const urlBackend = params.get('backend')
    const storedBackend = (() => { try { return localStorage.getItem('polymorphic-backend') } catch { return null } })()
    const preferWebGPU = (urlBackend === 'webgpu') || (!urlBackend && storedBackend === 'webgpu')

    // Create renderer
    renderer = new PolymorphicRenderer(canvas, {
        width,
        height,
        loopDuration: 10,
        preferWebGPU,
        onError: (err) => {
            console.error('Render error:', err)
        }
    })

    try {
        // Preload fonts used in text effects
        await preloadFontsForDsl(dsl)

        // Initialize the renderer
        await renderer.init()

        // ProgramState needs the underlying CanvasRenderer (with manifest/enums).
        // Set it up before any compile so we can populate state from the result.
        setupProgramState()

        // Initialize panels that depend on the renderer
        liveInputsPanel.init({
            renderer,
            onInsert: (snippet) => {
                if (dslEditor) insertAtCursor(dslEditor, snippet)
                publishLocalDsl('live-inputs')
                liveInputsPanel.flashSnippet?.(snippet)
            }
        })

        outputPicker.init({
            onSwitch: (idx) => {
                if (!dslEditor) return
                const next = dslEditor.value.replace(/render\s*\(\s*o[0-7]\s*\)/g, `render(o${idx})`)
                dslEditor.value = next
                publishLocalDsl('output-picker')
                scheduleHotReload()
            }
        })

        attachTouchControls({
            canvas,
            dslEditor,
            onTogglePerformanceMode: togglePerformanceMode
        })

        // Drag-and-drop image/video files anywhere → become a media() source
        setupFileDrop(canvas)
        perfOverlay.init({ renderer, canvas })
        statusRow.init({
            renderer,
            hooks: {
                mic: () => commandPalette.open(),
                midi: () => commandPalette.open(),
                source: () => liveInputsPanel.open(),
                recording: () => recorder.toggle(),
                fps: () => perfOverlay.toggle()
            }
        })

        // Tempo is the shared handfish <tempo-bar> component: tap, BPM, divider,
        // four beat dots, phase reset + slider all live in the element, and its
        // BeatScheduler runs the beat clock. We host it inside the status row so
        // it inherits the row's show/hide (performance/embed mode) behaviour.
        // The divider persists under polymorphic's existing localStorage key.
        const tempoBar = document.createElement('tempo-bar')
        tempoBar.id = 'tempo-bar'
        tempoBar.setAttribute('bpm', '120')
        tempoBar.setAttribute('divider', '4')
        tempoBar.setAttribute('storage-key', 'polymorphic.bpm.divider')
        tempoBar.setAttribute('min-bpm', '20') // polymorphic's range (shared default is 40–300)
        tempoBar.setAttribute('max-bpm', '400')
        statusRow.mount(tempoBar)

        // The controller keeps the two things <tempo-bar> doesn't own:
        // renderer loopDuration sync, and MIDI-clock follow (source manual↔midi).
        tempoController.init({ tempoBar, renderer })

        // Beat-pulse visual: flash the tempo-bar on each downbeat so the BPM
        // indication stays visually live (replaces the old bpm-chip dot pulse).
        tempoBar.addEventListener('beat', (e) => {
            if (!e.detail?.isDownbeat) return
            tempoBar.classList.remove('tempo-beat')
            void tempoBar.offsetWidth
            tempoBar.classList.add('tempo-beat')
        })

        // Keep Polymorphic's T-key tap-tempo shortcut. The component has its own
        // Tap button, but the keyboard shortcut must still fire — gated to
        // manual source and suppressed while an editor/input is focused.
        const isEditingFocus = () => {
            const el = document.activeElement
            if (!el || el === document.body) return false
            const tag = (el.tagName || '').toUpperCase()
            if (tag === 'TEXTAREA' || tag === 'INPUT') return true
            if (el.isContentEditable) return true
            // handfish's <code-editor> wraps a contenteditable shadow root.
            if (typeof el.closest === 'function' && el.closest('code-editor')) return true
            return false
        }
        document.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
            if (e.key !== 't' && e.key !== 'T') return
            if (isEditingFocus()) return
            tempoController.tap()
        })
        // Wire recorder state into status row. "standard" preset records at
        // 720p/60fps/8Mbps — keeps the encoder happy for fast generative
        // shaders. Switch via the command palette ("Recording: high quality"
        // / "Recording: low quality").
        recorder.init({
            canvas,
            quality: 'standard',
            onChange: ({ recording }) => {
                recordToggleBtn?.classList.toggle('recording', recording)
                recordToggleBtn?.setAttribute('data-title', recording ? 'stop recording' : 'record')
                statusRow.setRecording(recording)
            }
        })

        // Compile the DSL program
        const result = await renderer.compile(dsl)

        if (!result.success) {
            showError(`Shader error: ${result.error}`)
            return
        }

        // Initialize ProgramState from the compiled DSL
        syncProgramStateFromDsl(dsl)

        // Show canvas and start rendering
        showCanvas()
        renderer.start()

        // Store original DSL and populate editor
        originalDsl = dsl
        if (dslEditor) {
            dslEditor.value = dsl
        }

        outputPicker.setDsl(dsl).catch(err => console.debug('[outputPicker] setDsl failed:', err))

        await joinOnlineSessionFromUrlIfPresent()

        // Handle resize — coalesce bursts of resize events into at most one
        // canvas resize per frame. Dragging a window edge fires `resize` many
        // times a second, and each renderer.resize() reallocates GPU buffers
        // and re-renders text/media textures; collapsing to one-per-frame keeps
        // dragging smooth. The rAF reads the latest size, so the settled
        // dimensions are always applied.
        let resizeRaf = null
        window.addEventListener('resize', () => {
            if (resizeRaf) return
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null
                const { width, height } = resizeCanvas()
                renderer.resize(width, height)
            })
        })

        // Clean up on page unload
        window.addEventListener('beforeunload', () => {
            renderer.dispose()
        })

    } catch (err) {
        console.error('Initialization error:', err)
        showError(`Failed to initialize: ${err.message}`)
    }
}

/**
 * Set up menu bar dropdowns and handlers
 */
function setupMenuBar() {
    const menus = document.querySelectorAll('#menuLeft .menu')
    
    // Toggle dropdown on click
    menus.forEach(menu => {
        const title = menu.querySelector('.menu-title')
        const items = menu.querySelector('.menu-items')
        
        if (title && items) {
            title.addEventListener('click', (e) => {
                e.stopPropagation()
                
                // Close other menus
                menus.forEach(m => {
                    if (m !== menu) {
                        m.querySelector('.menu-items')?.classList.add('hide')
                    }
                })
                
                // Toggle this menu
                items.classList.toggle('hide')
            })
        }
    })
    
    // Close menus when clicking outside
    document.addEventListener('click', () => {
        menus.forEach(menu => {
            menu.querySelector('.menu-items')?.classList.add('hide')
        })
    })
    
    // Menu item handlers
    
    // Program menu
    if (shareProgram) {
        shareProgram.addEventListener('click', () => {
            const dsl = dslEditor?.value || ''
            shareModal.open({ dsl, canvas })
        })
    }

    // Edit in Noisedeck
    const editInNoisedeckMenuItem = document.getElementById('editInNoisedeckMenuItem')
    if (editInNoisedeckMenuItem) {
        editInNoisedeckMenuItem.addEventListener('click', () => {
            handleEditInNoisedeck()
            // Close menus
            document.querySelectorAll('#menuLeft .menu-items').forEach(el => el.classList.add('hide'))
        })
    }

    // Edit in Noodles
    const editInNoodlesMenuItem = document.getElementById('editInNoodlesMenuItem')
    if (editInNoodlesMenuItem) {
        editInNoodlesMenuItem.addEventListener('click', () => {
            handleEditInNoodles()
            // Close menus
            document.querySelectorAll('#menuLeft .menu-items').forEach(el => el.classList.add('hide'))
        })
    }
    
    // Import from URL
    const importFromUrlMenuItem = document.getElementById('importFromUrlMenuItem')
    if (importFromUrlMenuItem) {
        importFromUrlMenuItem.addEventListener('click', () => {
            importFromUrlDialog.open({
                onLoad: (composition) => handleLoadFromUrl(composition)
            })
            document.querySelectorAll('#menuLeft .menu-items').forEach(el => el.classList.add('hide'))
        })
    }
    
    if (copyProgram) {
        copyProgram.addEventListener('click', async () => {
            const dsl = dslEditor?.value || ''
            try {
                await navigator.clipboard.writeText(dsl)
                console.log('Program copied to clipboard')
            } catch (err) {
                console.error('Failed to copy program:', err)
            }
        })
    }
    
    if (pasteProgram) {
        pasteProgram.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText()
                if (dslEditor && text) {
                    dslEditor.value = text
                    publishLocalDsl('paste')
                    updateResetButtonVisibility()
                    scheduleHotReload()
                }
            } catch (err) {
                console.error('Failed to paste program:', err)
            }
        })
    }
    
    // Save/Load/Delete program handlers
    if (saveProgram) {
        saveProgram.addEventListener('click', () => {
            openProgramModal('save')
        })
    }
    
    if (loadProgram) {
        loadProgram.addEventListener('click', () => {
            openProgramModal('load')
        })
    }
    
    if (deleteProgram) {
        deleteProgram.addEventListener('click', () => {
            openProgramModal('delete')
        })
    }
    
    // Edit menu
    if (resetMenuItem) {
        resetMenuItem.addEventListener('click', resetDsl)
    }
    
    // Import from ZIP
    const importFromZipMenuItem = document.getElementById('importFromZipMenuItem')
    if (importFromZipMenuItem) {
        importFromZipMenuItem.addEventListener('click', () => {
            importEffectDialog.open()
            // Close menus
            document.querySelectorAll('#menuLeft .menu-items').forEach(el => el.classList.add('hide'))
        })
    }
    
    // File menu
    if (savePNG) {
        savePNG.addEventListener('click', () => {
            if (canvas) {
                const link = document.createElement('a')
                link.download = 'polymorphic.png'
                link.href = canvas.toDataURL('image/png')
                link.click()
            }
        })
    }
    
    if (saveJPG) {
        saveJPG.addEventListener('click', () => {
            if (canvas) {
                const link = document.createElement('a')
                link.download = 'polymorphic.jpg'
                link.href = canvas.toDataURL('image/jpeg', 0.95)
                link.click()
            }
        })
    }
    
    // Logo menu
    if (aboutMenuItem) {
        aboutMenuItem.addEventListener('click', () => {
            aboutDialog.show()
        })
    }

    if (docsMenuItem) {
        docsMenuItem.addEventListener('click', () => {
            showDocReader()
            if (docToggleBtn) {
                docToggleBtn.classList.add('active')
            }
        })
    }

    // View menu — toggleable panels with checkmark indicators
    setupViewMenu()
    
    // Right side icon buttons
    if (codeToggleBtn) {
        codeToggleBtn.addEventListener('click', toggleDslOverlay)
    }
    
    if (docToggleBtn) {
        docToggleBtn.addEventListener('click', () => {
            const isVisible = toggleDocReader()
            docToggleBtn.classList.toggle('active', isVisible)
        })
    }
    
    if (fullscreenBtnMenu) {
        fullscreenBtnMenu.addEventListener('click', toggleFullscreen)
    }
    
    if (playPauseBtnMenu) {
        playPauseBtnMenu.addEventListener('click', togglePlayPause)
    }

    if (inputsToggleBtn) {
        inputsToggleBtn.addEventListener('click', () => {
            liveInputsPanel.toggle()
            inputsToggleBtn.classList.toggle('active', liveInputsPanel.isOpen())
        })
    }

    if (recordToggleBtn) {
        recordToggleBtn.addEventListener('click', () => {
            if (recorder.isRecording()) recorder.stop()
            else recorder.start()
        })
    }

    if (perfToggleBtn) {
        perfToggleBtn.addEventListener('click', () => {
            perfOverlay.toggle()
            perfToggleBtn.classList.toggle('active', perfOverlay.isOpen())
        })
    }

    if (galleryBtn) {
        galleryBtn.addEventListener('click', () => {
            gallery.open().catch(err => console.error('[Gallery] open failed:', err))
        })
    }

    // Snapshot history shortcuts (Cmd/Ctrl+Alt+Left/Right)
    document.addEventListener('keydown', (e) => {
        const mod = e.metaKey || e.ctrlKey
        if (mod && e.altKey) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault()
                snapshotBack()
                return
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault()
                snapshotForward()
                return
            }
        }
        // Cmd/Ctrl+; toggles the status row
        if (mod && !e.shiftKey && !e.altKey && e.key === ';') {
            e.preventDefault()
            statusRow.toggle()
        }
        // Cmd/Ctrl+Shift+H toggles performance mode (hide all UI)
        if (mod && e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H')) {
            e.preventDefault()
            togglePerformanceMode()
        }
        // Cmd/Ctrl+Shift+F — format the DSL (only when editor is focused so we
        // don't steal Find from other contexts)
        if (mod && e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
            const active = document.activeElement
            const inEditor = active && (active.tagName === 'TEXTAREA' || active.closest?.('code-editor'))
            if (inEditor) {
                e.preventDefault()
                dslEditor?.dispatchEvent(new CustomEvent('format', { bubbles: true, composed: true }))
            }
        }
        // Esc exits performance mode
        if (e.key === 'Escape' && document.body.classList.contains('performance-mode')) {
            e.preventDefault()
            document.body.classList.remove('performance-mode')
            showToast('Performance mode off', 'info')
        }
        // Scene shortcuts: 1..9 recalls, Cmd/Ctrl+Shift+1..9 saves.
        // `e.key` for Shift+Digit1 may be either '1' (Linux/Windows under
        // Playwright) or '!' (macOS / shifted glyph), so accept both via
        // `e.code` ('Digit1'..'Digit9') as the canonical signal.
        const sceneCodeMatch = /^Digit([1-9])$/.exec(e.code || '')
        if (sceneCodeMatch) {
            const slot = parseInt(sceneCodeMatch[1], 10)
            const sceneMod = e.ctrlKey || e.metaKey
            if (sceneMod && e.shiftKey) {
                // Save current to slot — works even when editor is focused,
                // since live coders save mid-edit.
                const dsl = dslEditor?.value || ''
                if (dsl.trim()) {
                    scenes.save(slot, dsl)
                    showToast(`Saved scene ${slot}`, 'success')
                }
                e.preventDefault()
                return
            }
            if (!sceneMod && !e.shiftKey && !e.altKey) {
                // Bare-digit recall: only fire when the user isn't typing, so
                // we don't intercept a digit headed for a text field or the code
                // editor. Use the same robust focus check as elsewhere — handfish's
                // <code-editor> exposes a light-DOM textarea today, but guard the
                // host and contenteditable too so this stays correct if that changes.
                const el = e.target
                if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ||
                           el.isContentEditable || el.closest?.('code-editor'))) return
                const dsl = scenes.load(slot)
                if (dsl && dslEditor) {
                    dslEditor.value = dsl
                    publishLocalDsl('scene-load')
                    scheduleHotReload()
                    showToast(`Loaded scene ${slot}`, 'info')
                }
                e.preventDefault()
            }
        }
    })
    gallery.init({
        onLoad: (example) => {
            if (!dslEditor) return
            dslEditor.value = example.dsl
            originalDsl = example.dsl
            publishLocalDsl('gallery')
            scheduleHotReload()
            dslEditor.focus()
        }
    })
    
    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', () => {
        updateFullscreenButton()
        // Trigger resize to handle adaptive pixel density
        if (renderer) {
            const { width, height } = resizeCanvas()
            renderer.resize(width, height)
        }
    })
}

/**
 * Initialize the app
 */
function init() {
    // Apply embed mode FIRST so panels never get a chance to render visibly
    // when running in an iframe via ?embed=1
    applyEmbedMode()

    // Initialize doc reader and show by default
    initDocReader()
    setApplyToEditorCallback((code) => {
        if (dslEditor) {
            dslEditor.value = code;
            publishLocalDsl('doc-reader')
            updateResetButtonVisibility();
            scheduleHotReload();
        }
    });
    showPlaceholderContent()
    showDocReader()
    if (docToggleBtn) {
        docToggleBtn.classList.add('active')
    }
    
    // Initialize program modal
    initProgramModal({
        getDsl: () => dslEditor?.value || '',
        setDsl: (dsl) => {
            if (dslEditor) {
                dslEditor.value = dsl
                publishLocalDsl('program-load')
                updateResetButtonVisibility()
                scheduleHotReload()
            }
        }
    })
    
    // Set up menu bar
    setupMenuBar()

    // Set up online collaboration menu/status wiring. The SDK itself is loaded
    // lazily only when a session action occurs or ?seance= activates on boot.
    setupOnlineCollaboration()
    
    // Set up doc reader close button
    if (docReaderClose) {
        docReaderClose.addEventListener('click', () => {
            hideDocReader()
            if (docToggleBtn) {
                docToggleBtn.classList.remove('active')
            }
        })
    }
    
    // Set up compiler error click-to-jump (or fallback copy)
    if (compilerErrorEl) {
        compilerErrorEl.addEventListener('click', () => {
            const text = compilerErrorEl.textContent
            const loc = parseErrorLocation(text)
            if (loc && dslEditor) {
                const ta = dslEditor.getTextarea?.()
                if (!ta) return
                const lines = ta.value.split('\n')
                let offset = 0
                for (let i = 0; i < Math.min(loc.line - 1, lines.length); i++) {
                    offset += lines[i].length + 1
                }
                offset += Math.max(0, loc.col - 1)
                ta.focus()
                ta.selectionStart = ta.selectionEnd = offset
            } else {
                navigator.clipboard?.writeText(text).catch(() => {})
            }
        })
    }
    
    // Set up DSL editor with hot reload
    setupDslEditor()

    // Inline number scrubbing — Alt+drag any numeric literal
    if (dslEditor) {
        let scrubbing = false
        attachScrubber(dslEditor, {
            onScrubStart: () => { scrubbing = true },
            onScrubEnd: () => { scrubbing = false },
            recompile: async () => {
                // While scrubbing we want immediate compile; debounce is too slow
                if (hotReloadTimeout) {
                    clearTimeout(hotReloadTimeout)
                    hotReloadTimeout = null
                }
                const r = await recompileShader()
                if (!r.success) showCompilerError(r.error)
                else hideCompilerError()
            }
        })
    }

    // Initialize the command palette (Cmd/Ctrl+K)
    setupCommandPalette()

    // Shortcuts dialog (?)
    shortcutsDialog.init()

    // Debug surface — useful for tests (Playwright reaches in to check
    // panel state) and for power users poking around in the console.
    // None of these references prevent GC of anything that matters.
    if (typeof window !== 'undefined') {
        window.__poly = {
            liveInputsPanel,
            recorder,
            perfOverlay,
            tempoController,
            get tempoBar() { return document.getElementById('tempo-bar') },
            statusRow,
            commandPalette,
            gallery,
            snapshotHistory,
            shortcutsDialog,
            get onlineAdapter() { return onlineAdapter },
            get renderer() { return renderer },
            get programState() { return programState }
        }
    }

    // Start shader immediately (no consent screen for Polymorphic)
    startShader()
}

/**
 * Wire the View menu — toggle panels and reflect their state with a check.
 *
 * Each menu item with a `data-view-toggle` attribute owns a panel-toggle
 * action. When the menu's parent is opened (click on its title), we refresh
 * the check states from the actual panel visibility. Clicking an item
 * toggles the panel and re-syncs.
 */
function setupViewMenu() {
    const menu = document.getElementById('viewMenuTitle')?.closest('.menu')
    if (!menu) return

    // Map each toggle id to (read state, toggle action) functions.
    const toggles = {
        'editor':           { is: () => dslOverlay?.style.display !== 'none', do: () => toggleDslOverlay() },
        'docs':             { is: () => isDocReaderVisible(),                do: () => {
            const visible = toggleDocReader()
            docToggleBtn?.classList.toggle('active', visible)
        }},
        'live-inputs':      { is: () => liveInputsPanel.isOpen(),            do: () => {
            liveInputsPanel.toggle()
            inputsToggleBtn?.classList.toggle('active', liveInputsPanel.isOpen())
        }},
        'surface-pips':     { is: () => outputPicker.isEnabled(),            do: () => outputPicker.toggle() },
        'perf':             { is: () => perfOverlay.isOpen(),                do: () => {
            perfOverlay.toggle()
            perfToggleBtn?.classList.toggle('active', perfOverlay.isOpen())
        }},
        'status':           { is: () => statusRow.isOpen(),                  do: () => statusRow.toggle() },
        'performance-mode': { is: () => document.body.classList.contains('performance-mode'), do: () => togglePerformanceMode() },
        'fullscreen':       { is: () => !!document.fullscreenElement,        do: () => toggleFullscreen() }
    }

    function refreshChecks() {
        for (const [id, { is }] of Object.entries(toggles)) {
            const item = document.querySelector(`[data-view-toggle="${id}"]`)
            if (!item) continue
            item.classList.toggle('checked', !!is())
            const check = item.querySelector('.view-check')
            if (check) check.textContent = is() ? '✓' : ''
        }
    }

    // Refresh when the View menu opens
    const title = document.getElementById('viewMenuTitle')
    title?.addEventListener('click', () => {
        // Use rAF so the dropdown's `.hide` toggle (handled by the generic
        // menu-bar listener) has time to apply before we read state.
        requestAnimationFrame(refreshChecks)
    })

    // Wire each toggle item
    for (const [id, { do: action }] of Object.entries(toggles)) {
        const item = document.querySelector(`[data-view-toggle="${id}"]`)
        item?.addEventListener('click', () => {
            action()
            refreshChecks()
        })
    }

    // One-shot actions (gallery, shortcuts) — open and let the generic menu
    // close-on-click handler dismiss the dropdown.
    document.getElementById('viewMenuItem-gallery')?.addEventListener('click', () => {
        gallery.open().catch(err => console.error('[Gallery] open failed:', err))
    })
    document.getElementById('viewMenuItem-shortcuts')?.addEventListener('click', () => {
        shortcutsDialog.open()
    })

    // Viewport window: opens a popup mirror of the canvas for full-screen
    // display on a secondary monitor. Idempotent — focuses an existing popup.
    configureViewportWindow({ canvas })
    document.getElementById('viewMenuItem-open-viewport-window')?.addEventListener('click', () => {
        openViewportWindow()
    })

    // Initial state
    refreshChecks()

    // Listen for fullscreen changes externally so the check stays accurate
    document.addEventListener('fullscreenchange', refreshChecks)
}

/**
 * Initialize the command palette and register the basic action set.
 */
function setupCommandPalette() {
    commandPalette.init({
        onInsert: (snippet, opts) => {
            if (!dslEditor) return
            if (opts?.as === 'starter') {
                // Starter snippets are full programs — replace the editor content
                dslEditor.value = snippet
                publishLocalDsl('palette-starter')
                scheduleHotReload()
                dslEditor.focus()
            } else {
                insertAtCursor(dslEditor, snippet)
                publishLocalDsl('palette-insert')
            }
        }
    })

    // Build the action list with high-level UI hooks. The deps object only
    // exposes callable verbs — never the underlying singletons — so the
    // registry stays decoupled from embed.js's internals.
    const actions = buildPaletteActions({
        forceRecompile: () => dslEditor?.dispatchEvent(new CustomEvent('forcerecompile', { bubbles: true, composed: true })),
        forceEvalBlock: () => dslEditor?.dispatchEvent(new CustomEvent('forceevalblock', { bubbles: true, composed: true })),
        formatDsl: () => dslEditor?.dispatchEvent(new CustomEvent('format', { bubbles: true, composed: true })),
        resetDsl: () => resetDsl(),
        toggleFullscreen: () => toggleFullscreen(),
        togglePlayPause: () => togglePlayPause(),
        toggleEditor: () => toggleDslOverlay(),
        toggleDocs: () => {
            const visible = toggleDocReader()
            if (docToggleBtn) docToggleBtn.classList.toggle('active', visible)
        },
        savePNG: () => savePNG?.click?.(),
        saveJPG: () => saveJPG?.click?.(),
        shareProgram: () => shareProgram?.click?.(),
        loadProgram: () => openProgramModal('load'),
        saveProgram: () => openProgramModal('save'),
        openDocs: () => {
            showDocReader()
            docToggleBtn?.classList.add('active')
        },
        toggleLiveInputs: () => {
            liveInputsPanel.toggle()
            inputsToggleBtn?.classList.toggle('active', liveInputsPanel.isOpen())
        },
        enableMic: () => {
            liveInputsPanel.open()
            inputsToggleBtn?.classList.add('active')
            const btn = document.querySelector('.live-inputs-panel [data-id=audio-toggle]')
            if (btn && !btn.classList.contains('active')) btn.click()
        },
        connectMidi: () => {
            liveInputsPanel.open()
            inputsToggleBtn?.classList.add('active')
            const btn = document.querySelector('.live-inputs-panel [data-id=midi-toggle]')
            if (btn && !btn.classList.contains('active')) btn.click()
        },
        toggleRecording: () => {
            if (recorder.isRecording()) recorder.stop()
            else recorder.start()
        },
        setRecordingQuality: (preset) => {
            recorder.setQualityPreset(preset)
            const labels = {
                high: 'high (1080p / 16Mbps)',
                standard: 'standard (720p / 8Mbps)',
                low: 'low (480p / 3Mbps)'
            }
            showToast(`Recording quality: ${labels[preset] ?? preset}`, 'info')
        },
        useWebcam: () => {
            liveInputsPanel.open()
            inputsToggleBtn?.classList.add('active')
            document.querySelector('.live-inputs-panel .source-btn[data-source="webcam"]')?.click()
        },
        useScreenCapture: () => {
            liveInputsPanel.open()
            inputsToggleBtn?.classList.add('active')
            document.querySelector('.live-inputs-panel .source-btn[data-source="screen"]')?.click()
        },
        togglePerfOverlay: () => {
            perfOverlay.toggle()
            perfToggleBtn?.classList.toggle('active', perfOverlay.isOpen())
        },
        openGallery: () => gallery.open(),
        shuffleExample: async () => {
            const ex = await pickRandomExample()
            if (ex && dslEditor) {
                dslEditor.value = ex.dsl
                originalDsl = ex.dsl
                publishLocalDsl('shuffle')
                scheduleHotReload()
                dslEditor.focus()
            }
        },
        snapshotBack: () => snapshotBack(),
        snapshotForward: () => snapshotForward(),
        tapTempo: () => tempoController.tap(),
        toggleBpmSource: () => tempoController.toggleSource(),
        toggleStatusRow: () => statusRow.toggle(),
        showShortcuts: () => shortcutsDialog.open(),
        togglePerformanceMode: () => togglePerformanceMode(),
        switchBackend: (target) => switchBackend(target),
        hushSurfaces: () => hushSurfaces()
    })
    for (const a of actions) commandPalette.registerAction(a)
}

/** Switch shader backend by setting a localStorage flag and reloading. */
function switchBackend(target) {
    try { localStorage.setItem('polymorphic-backend', target) } catch { /* ignore */ }
    showToast(`Switching to ${target}…`, 'info')
    setTimeout(() => window.location.reload(), 300)
}

/**
 * Reset surfaces o0..o7 by recompiling. The pipeline reallocates surface
 * textures on each compile, which clears any feedback state. We also briefly
 * suspend the renderer to avoid showing a partial frame.
 */
async function hushSurfaces() {
    if (!renderer || !dslEditor) return
    const dsl = dslEditor.value
    if (!dsl?.trim()) return
    renderer.stop()
    const r = await recompileShader()
    if (r.success) {
        renderer.start()
        showToast('Surfaces cleared', 'success')
    } else {
        renderer.start()
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
} else {
    init()
}
