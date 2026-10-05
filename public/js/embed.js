/**
 * Polymorphic - Live Coding Entry Point
 *
 * Initializes the full-page canvas shader renderer with DSL editor.
 * Hot reload functionality for live coding experience.
 */

const APP_VERSION = '0.11'

import { AboutDialog, dslTokenizer, initEscapeHandler, initializeTooltips, formatShortcut, hasOpenEscapeables } from 'handfish'

// One global Escape handler for handfish components (menu bar, dialogs).
// Required once per app by the handfish escape-stack contract.
initEscapeHandler()
initializeTooltips()
import { PolymorphicRenderer } from './noisemaker/renderer.js'
import { ProgramState, getEffect } from './noisemaker/bundle.js'
import { restoreMediaUrls } from './noisemaker/dslSanitize.js'
import { insertImageSource } from './noisemaker/imageSource.js'
import { preloadFontsForDsl } from './fontLoader.js'
import { initDocReader, toggleDocReader, showPlaceholderContent, hideDocReader, showDocReader, setApplyToEditorCallback, isDocReaderVisible, loadEffectHelp } from './docReader.js'
import { shareModal } from './shareModal.js'
import { loadFromCode, getCodeFromUrl, registerPortableEffect, getLoadedPortableEffects, portableDefinition, setRuntimeRenderer } from './sharingLoader.js'
import { initProgramModal, openProgramModal } from './programModal.js'
import { programs } from './programs.js'
import { storeImageFile, getProgramImage, hasImageText, storeImageText, storeDslImages, migrateProgramImages } from './programImages.js'
import { ImportEffectDialog } from './ui/import-effect-dialog.js'
import { importFromUrlDialog } from './ui/import-from-url-dialog.js'
import { commandPalette } from './ui/commandPalette.js'
import { buildPaletteActions } from './ui/paletteActions.js'
import { formatDsl } from './ui/formatter.js'
import { insertAtCursor, getSelectionOrBlock, blockRangeAt } from './ui/editorActions.js'
import { attachScrubber } from './ui/scrubber.js'
import { getCursorIdleHider } from './ui/cursorIdle.js'
import { liveInputsPanel } from './ui/liveInputsPanel.js'
import { recorder } from './ui/recorder.js'
import { perfOverlay } from './ui/perfOverlay.js'
import { gallery, pickRandomExample } from './ui/gallery.js'
import { snapshotHistory } from './ui/snapshotHistory.js'
import { tempoController } from './ui/tempo.js'
import { statusRow } from './ui/statusRow.js'
import { shortcutsDialog } from './ui/shortcutsDialog.js'
import { outputPicker, switchOutputSurface, surfacesWrittenInDsl, effectiveRenderTarget } from './ui/outputPicker.js'
import { initializeSyncOutputController, createSyncOutputConnectionProvider } from './syncOutput.js'
import { createSyncOutputDialog } from './ui/syncOutputDialog.js'
import { resolveBackendPreference, isWebGPUFallback, WEBGPU_FALLBACK_MESSAGE } from './backendFallback.js'
import { configureViewportWindow, openViewportWindow } from './ui/viewportWindow.js'
import { scenes } from './ui/scenes.js'
import { attachTouchControls } from './ui/touchControls.js'
import { applyEmbedMode } from './ui/embedMode.js'
import { parseErrorLocation, formatErrorLabel } from './ui/errorBanner.js'
import { createPolymorphicOnlineAdapter } from './onlineAdapter.js'
import './ui/codeEditor.js'  // Polymorphic editor CSS; handfish registers and owns the element behavior.
import './ui/effectControls.js' // Register <effect-controls> custom element
import { findCallSiteAtOffset, reresolveCallSite } from './ui/effectClickResolver.js'

const ONLINE_COLLABORATION_FEATURE = 'onlineCollaboration'

// DOM elements
const canvas = document.getElementById('canvas')
const loadingEl = document.getElementById('loading')
const errorEl = document.getElementById('error')
const dslOverlay = document.getElementById('dsl-overlay')
const dslEditor = document.getElementById('dsl-editor')
dslEditor?.setTokenizer?.(dslTokenizer)
const compilerErrorEl = document.getElementById('compiler-error')
const docReaderClose = document.querySelector('.doc-reader-close')

const seanceDialog = document.getElementById('seanceDialog')
const onlineCollaborationEnabled = isFeatureEnabled(ONLINE_COLLABORATION_FEATURE)

// Renderer reference (set after initialization)
let renderer = null
let compositionImages = []
let syncOutputDialog = null
let syncOutputController = null

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

// Online-collaboration UI visibility (kill-switch; see setOnlineCollaborationUiVisible)
let onlineCollabUiVisible = isFeatureEnabled(ONLINE_COLLABORATION_FEATURE)

const menuBarEl = document.getElementById('menu')

function refreshMenuBar() {
    menuBarEl?.refresh?.()
}

// Config for the shared handfish <menu-bar>. Handlers are the same closures
// the old per-id listeners ran; dynamic fields are pulled on menu open,
// after every activation, and on refreshMenuBar().
if (menuBarEl) {
    menuBarEl.config = {
        ariaLabel: 'Polymorphic menu',
        regions: {
            left: [
                {
                    type: 'menu',
                    id: 'logoMenu',
                    trigger: {
                        html: '<svg id="logo" width="1.25em" height="1.5em" viewBox="0 0 600 600" fill="currentColor"><g transform="translate(0,600) scale(0.1,-0.1)"><path d="M3920 5709 c-248 -32 -507 -143 -790 -337 -282 -194 -349 -237 -426 -273 -178 -84 -313 -93 -571 -35 -246 55 -390 46 -560 -33 -133 -63 -288 -192 -382 -320 -151 -205 -169 -380 -64 -639 102 -254 266 -430 506 -542 337 -158 633 -99 816 161 65 92 103 201 147 417 41 204 68 288 126 390 147 257 354 383 577 352 107 -14 189 -57 273 -142 238 -242 203 -643 -87 -978 -132 -153 -293 -269 -673 -487 -263 -151 -533 -321 -692 -439 -277 -204 -450 -460 -499 -738 -31 -172 11 -257 146 -297 39 -11 45 -10 81 13 93 62 198 105 337 139 76 19 118 23 275 23 160 -1 197 -4 270 -23 105 -28 224 -84 309 -145 71 -50 103 -57 164 -31 52 22 93 60 111 105 21 53 39 292 31 415 -3 55 -13 161 -22 235 -24 208 -22 397 5 493 41 145 108 258 269 455 228 278 568 616 908 902 265 223 372 356 411 513 22 93 15 298 -15 412 -33 123 -65 181 -151 267 -111 111 -197 146 -409 168 -119 12 -327 11 -421 -1z"/><path d="M2316 1660 c-220 -35 -399 -121 -519 -250 -119 -128 -163 -247 -154 -415 9 -173 75 -340 187 -473 57 -67 152 -147 214 -179 113 -58 273 -77 416 -49 347 68 650 439 650 796 0 152 -41 242 -166 361 -165 157 -418 241 -628 209z"/></g></svg>',
                        ariaLabel: 'Polymorphic menu',
                    },
                    items: [
                        { id: 'aboutMenuItem', label: 'about Polymorphic', onSelect: () => aboutDialog.show() },
                        { type: 'separator' },
                        { id: 'docsMenuItem', label: 'documentation', onSelect: () => showDocReader() },
                    ],
                },
                {
                    type: 'menu',
                    id: 'fileMenu',
                    trigger: { label: 'file', id: 'fileMenuTitle' },
                    items: [
                        {
                            id: 'savePNG',
                            label: 'quick save as png',
                            onSelect: () => {
                                if (canvas) {
                                    const link = document.createElement('a')
                                    link.download = 'polymorphic.png'
                                    link.href = canvas.toDataURL('image/png')
                                    link.click()
                                }
                            },
                        },
                        {
                            id: 'saveJPG',
                            label: 'quick save as jpg',
                            onSelect: () => {
                                if (canvas) {
                                    const link = document.createElement('a')
                                    link.download = 'polymorphic.jpg'
                                    link.href = canvas.toDataURL('image/jpeg', 0.95)
                                    link.click()
                                }
                            },
                        },
                        { type: 'separator' },
                        { id: 'importFromZipMenuItem', label: 'import effect from zip...', onSelect: () => importEffectDialog.open() },
                    ],
                },
                {
                    type: 'menu',
                    id: 'editMenu',
                    trigger: { label: 'edit', id: 'editMenuTitle' },
                    items: [
                        { id: 'resetMenuItem', label: 'reset to original', onSelect: () => resetDsl() },
                    ],
                },
                {
                    type: 'menu',
                    id: 'viewMenu',
                    trigger: { label: 'view', id: 'viewMenuTitle' },
                    items: [
                        { type: 'checkbox', id: 'viewMenuItem-editor', classes: 'view-item', label: 'code editor',
                          checked: () => dslOverlay?.style.display !== 'none',
                          onSelect: () => toggleDslOverlay() },
                        { type: 'checkbox', id: 'viewMenuItem-docs', classes: 'view-item', label: 'documentation',
                          checked: () => isDocReaderVisible(),
                          onSelect: () => { toggleDocReader() } },
                        { type: 'checkbox', id: 'viewMenuItem-live-inputs', classes: 'view-item', label: 'live inputs',
                          shortcut: formatShortcut('Mod+I'),
                          checked: () => liveInputsPanel.isOpen(),
                          onSelect: () => { liveInputsPanel.toggle() } },
                        { type: 'checkbox', id: 'viewMenuItem-surface-pips', classes: 'view-item', label: 'surface pips',
                          checked: () => outputPicker.isEnabled(),
                          onSelect: () => outputPicker.toggle() },
                        { type: 'separator' },
                        { type: 'checkbox', id: 'viewMenuItem-perf', classes: 'view-item', label: 'performance overlay',
                          checked: () => perfOverlay.isOpen(),
                          onSelect: () => { perfOverlay.toggle() } },
                        { type: 'checkbox', id: 'viewMenuItem-status', classes: 'view-item', label: 'status row',
                          shortcut: formatShortcut('Mod+;'),
                          checked: () => statusRow.isOpen(),
                          onSelect: () => statusRow.toggle() },
                        { type: 'separator' },
                        { id: 'viewMenuItem-gallery', classes: 'view-item', label: 'gallery…',
                          onSelect: () => gallery.open().catch(err => console.error('[Gallery] open failed:', err)) },
                        { id: 'viewMenuItem-shortcuts', classes: 'view-item', label: 'keyboard shortcuts…',
                          shortcut: '?',
                          onSelect: () => shortcutsDialog.open() },
                        { type: 'separator' },
                        { type: 'checkbox', id: 'viewMenuItem-performance-mode', classes: 'view-item', label: 'performance mode',
                          shortcut: formatShortcut('Mod+Shift+H'),
                          checked: () => document.body.classList.contains('performance-mode'),
                          onSelect: () => togglePerformanceMode() },
                        { type: 'checkbox', id: 'viewMenuItem-fullscreen', classes: 'view-item', label: 'fullscreen',
                          checked: () => !!document.fullscreenElement,
                          onSelect: () => toggleFullscreen() },
                        { type: 'separator' },
                        { id: 'viewMenuItem-open-viewport-window', classes: 'view-item', label: 'open viewport window', onSelect: () => openViewportWindow() },
                        { id: 'syncOutputMenuItem', classes: 'view-item', label: 'send to Sync...', onSelect: () => syncOutputDialog?.open() },
                    ],
                },
                {
                    type: 'menu',
                    id: 'programMenu',
                    trigger: { label: 'program', id: 'programMenuTitle' },
                    items: [
                        {
                            id: 'copyProgram',
                            label: 'copy program',
                            onSelect: async () => {
                                const dsl = dslEditor?.value || ''
                                try {
                                    await navigator.clipboard.writeText(dsl)
                                    console.log('Program copied to clipboard')
                                } catch (err) {
                                    console.error('Failed to copy program:', err)
                                }
                            },
                        },
                        {
                            id: 'pasteProgram',
                            label: 'paste program',
                            onSelect: async () => {
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
                            },
                        },
                        { type: 'separator' },
                        { id: 'saveProgram', label: 'save program', onSelect: () => openProgramModal('save') },
                        { id: 'loadProgram', label: 'load program', onSelect: () => openProgramModal('load') },
                        { id: 'deleteProgram', label: 'delete program', onSelect: () => openProgramModal('delete') },
                        { type: 'separator' },
                        { id: 'editInNoisedeckMenuItem', label: 'edit in Noisedeck...', onSelect: () => handleEditInNoisedeck() },
                        { id: 'editInNoodlesMenuItem', label: 'edit in Noodles...', onSelect: () => handleEditInNoodles() },
                        { type: 'separator' },
                        {
                            id: 'importFromUrlMenuItem',
                            label: 'import from url...',
                            onSelect: () => {
                                importFromUrlDialog.open({
                                    onLoad: (composition) => handleLoadFromUrl(composition)
                                })
                            },
                        },
                        {
                            id: 'shareProgram',
                            label: 'share publicly...',
                            onSelect: () => {
                                const dsl = dslEditor?.value || ''
                                shareModal.open({ dsl, canvas, images: renderer?.images || [], hasLiveMedia: liveInputsPanel.hasLiveMedia })
                            },
                        },
                        { type: 'separator', id: 'onlineCollabMenuSeparator', hidden: () => !onlineCollabUiVisible },
                        {
                            id: 'goOnlineMenuItem',
                            // The dialog is modal, so while it is closed this
                            // label was the only thing on screen that could
                            // say a session is live, and it always read "go
                            // online...". Someone could be broadcasting every
                            // keystroke with nothing telling them so.
                            label: () => onlineSessionMenuLabel(),
                            hidden: () => !onlineCollabUiVisible,
                            onSelect: () => seanceDialog?.show(),
                        },
                    ],
                },
            ],
            center: [],
            right: [
                { type: 'button', id: 'gallery-btn', icon: 'collections', tooltip: 'gallery', ariaLabel: 'Open inspiration gallery',
                  onSelect: () => gallery.open().catch(err => console.error('[Gallery] open failed:', err)) },
                { type: 'button', id: 'inputs-toggle-btn', icon: 'tune',
                  tooltip: () => `live inputs (${formatShortcut('Mod+I')})`,
                  ariaLabel: 'Toggle live inputs',
                  active: () => liveInputsPanel.isOpen(),
                  onSelect: () => liveInputsPanel.toggle() },
                { type: 'button', id: 'record-toggle-btn', icon: 'fiber_manual_record', tooltip: () => recorder.isRecording() ? 'stop recording' : 'record', ariaLabel: 'Toggle recording',
                  active: () => recorder.isRecording(),
                  onSelect: () => { if (recorder.isRecording()) recorder.stop(); else recorder.start() } },
                { type: 'button', id: 'perf-toggle-btn', icon: 'speed', tooltip: 'performance overlay', ariaLabel: 'Toggle performance overlay',
                  active: () => perfOverlay.isOpen(),
                  onSelect: () => perfOverlay.toggle() },
                { type: 'button', id: 'doc-toggle-btn', icon: 'info', tooltip: 'documentation', ariaLabel: 'Toggle documentation',
                  active: () => isDocReaderVisible(),
                  onSelect: () => { toggleDocReader() } },
                { type: 'button', id: 'code-toggle-btn', icon: 'code', tooltip: 'code editor', ariaLabel: 'Toggle code view',
                  active: () => dslOverlay?.style.display !== 'none',
                  onSelect: () => toggleDslOverlay() },
                { type: 'button', id: 'fullscreen-btn-menu', icon: () => document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen',
                  tooltip: 'fullscreen', ariaLabel: 'Toggle fullscreen',
                  onSelect: () => toggleFullscreen() },
                { type: 'button', id: 'play-pause-btn-menu',
                  icon: () => isPlaying ? 'pause' : 'play_arrow',
                  tooltip: () => isPlaying ? 'pause' : 'play',
                  ariaLabel: () => isPlaying ? 'Pause animation' : 'Play animation',
                  onSelect: () => togglePlayPause() },
            ],
        },
    }
}

// Menu bar elements
const codeToggleBtn = document.getElementById('code-toggle-btn')
const docToggleBtn = document.getElementById('doc-toggle-btn')
const inputsToggleBtn = document.getElementById('inputs-toggle-btn')
const recordToggleBtn = document.getElementById('record-toggle-btn')
const perfToggleBtn = document.getElementById('perf-toggle-btn')

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
const goOnlineMenuItem = document.getElementById('goOnlineMenuItem')

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

function isFeatureEnabled(name) {
    // onlineCollaboration ships enabled by default (2026-07-05); the flag
    // machinery stays as a code-level kill-switch — remove the default to
    // re-gate it. ?features= / localStorage still force-enable other flags.
    const DEFAULTS = { onlineCollaboration: true }
    if (DEFAULTS[name]) return true
    const params = new URLSearchParams(window.location.search)
    const fromUrl = (params.get('features') || '').split(',').map(s => s.trim()).filter(Boolean)
    if (fromUrl.includes(name)) return true
    try {
        return localStorage.getItem(`feature.${name}`) === 'true'
    } catch {
        return false
    }
}

/**
 * Label for the collaboration menu item, which doubles as the app's only
 * always-visible session indicator.
 */
function onlineSessionMenuLabel() {
    const status = onlineAdapter?.getStatus?.() || 'offline'
    const sessionId = onlineAdapter?.getSessionId?.() || ''
    const isReconnecting = onlineAdapter?.isReconnecting?.() || false
    if (isReconnecting) return sessionId ? `reconnecting: ${sessionId}...` : 'reconnecting...'
    if (status === 'connecting') return 'connecting...'
    if (status === 'readonly') return `online (read-only): ${sessionId}...`
    if (status === 'online') return `online: ${sessionId}...`
    return 'go online...'
}

function setOnlineCollaborationUiVisible(visible) {
    onlineCollabUiVisible = visible
    refreshMenuBar()
    if (!visible && seanceDialog) seanceDialog.hide?.()
}

setOnlineCollaborationUiVisible(onlineCollaborationEnabled)

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
        ...portableDefinition({ ...definition, name: definition.name || definition.func || name }),
        passes,
        shaders
    }

    // Register the effect (shared contract validates and may reject the ZIP)
    await registerPortableEffect(effectData)

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
    if (result.superseded) return
    if (!result.success) {
        showCompilerError(result.error)
    } else {
        hideCompilerError()
    }

    // Show success message
    console.log(`[Polymorphic] Imported effect: ${effectData.func}`)
    
    // Show toast notification (the shared token-based toast helper)
    showToast(`Effect "${effectData.func}" imported!`)
})

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

let activeErrorLoc = null
let markerTimeout = null
let markerObserver = null
let hasActiveErrorMarker = false

function applyErrorLineMarker() {
    if (!activeErrorLoc || !dslEditor) return
    // Drop stale markers first so a re-application after a Handfish re-render
    // or formatter run can never leave highlights straddling two lines.
    if (hasActiveErrorMarker) {
        const stale = dslEditor.querySelectorAll?.('.error-line')
        if (stale) {
            for (const el of stale) el.classList.remove('error-line')
        }
    }
    let line = activeErrorLoc.line
    let lineEl = dslEditor.querySelector?.(`.code-editor-display [data-line-number="${line}"]`)
    if (!lineEl) {
        // Clamp the reported line into the document: some compilers report
        // line = lineCount + 1 for EOF errors (e.g. an unclosed block), and a
        // formatter run may shift the marker after the diagnostic was captured.
        const displayLineCount = dslEditor.querySelectorAll?.('.code-editor-display .code-line')?.length || 0
        const gutterCount = dslEditor.querySelectorAll?.('.code-editor-gutter .line-number')?.length || 0
        const maxLine = Math.max(displayLineCount, gutterCount)
        const clamped = Math.max(1, Math.min(line, maxLine))
        if (maxLine > 0 && clamped !== line) {
            line = clamped
            lineEl = dslEditor.querySelector?.(`.code-editor-display [data-line-number="${line}"]`)
        }
    }
    let applied = false
    if (lineEl) {
        lineEl.classList.add('error-line')
        applied = true
    }
    const gutterEl = dslEditor.querySelector?.('.code-editor-gutter')
    if (gutterEl) {
        const lineNumbers = gutterEl.querySelectorAll?.('.line-number')
        let targetGutter = (lineNumbers && lineNumbers[line - 1]) ||
                           gutterEl.children?.[line - 1]
        if (!targetGutter) {
            // Out-of-range line (EOF diagnostic): clamp to the last gutter entry.
            const count = (lineNumbers && lineNumbers.length) || (gutterEl.children && gutterEl.children.length) || 0
            if (count > 0) targetGutter = (lineNumbers && lineNumbers[count - 1]) || gutterEl.children[count - 1]
        }
        if (targetGutter) {
            targetGutter.classList.add('error-line')
            applied = true
        }
    }
    if (applied) {
        hasActiveErrorMarker = true
    }
}

function attachMarkerObserver() {
    if (markerObserver || !dslEditor) return
    try {
        if (typeof MutationObserver !== 'undefined') {
            markerObserver = new MutationObserver(() => {
                if (activeErrorLoc) {
                    applyErrorLineMarker()
                }
            })
            markerObserver.observe(dslEditor, { childList: true, subtree: true })
        }
    } catch {
        // MutationObserver unavailable in non-browser harness
    }
}

function detachMarkerObserver() {
    if (markerObserver) {
        try { markerObserver.disconnect() } catch {}
        markerObserver = null
    }
}

function setErrorLineMarker(loc) {
    clearErrorLineMarker()
    activeErrorLoc = loc
    applyErrorLineMarker()
    attachMarkerObserver()
    if (markerTimeout) clearTimeout(markerTimeout)
    markerTimeout = setTimeout(() => {
        if (activeErrorLoc === loc) applyErrorLineMarker()
        markerTimeout = null
    }, 200)
}

function clearErrorLineMarker() {
    activeErrorLoc = null
    detachMarkerObserver()
    if (markerTimeout) {
        clearTimeout(markerTimeout)
        markerTimeout = null
    }
    // Fast path: if no error markers have been applied, avoid expensive DOM queries during typing
    if (!hasActiveErrorMarker || !dslEditor) return
    hasActiveErrorMarker = false
    const prevLineEls = dslEditor.querySelectorAll?.('.code-editor-display .error-line')
    if (prevLineEls) {
        for (const el of prevLineEls) el.classList.remove('error-line')
    }
    const prevGutterEls = dslEditor.querySelectorAll?.('.code-editor-gutter .error-line')
    if (prevGutterEls) {
        for (const el of prevGutterEls) el.classList.remove('error-line')
    }
}

/**
 * Show compiler error with line-level span wrapping and editor diagnostic marker
 */
function showCompilerError(errorText) {
    if (!compilerErrorEl) return
    const loc = parseErrorLocation(errorText)
    const label = formatErrorLabel(errorText, loc)
    const escaped = label.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    compilerErrorEl.innerHTML = `<span>${escaped}</span>`
    compilerErrorEl.classList.add('visible')
    if (loc) {
        compilerErrorEl.title = `Click to jump to line ${loc.line}, column ${loc.col}`
        setErrorLineMarker(loc)
    } else {
        compilerErrorEl.removeAttribute('title')
        clearErrorLineMarker()
    }
}

/**
 * Hide compiler error and clear editor diagnostic markers
 */
function hideCompilerError() {
    if (compilerErrorEl) {
        compilerErrorEl.classList.remove('visible')
        compilerErrorEl.removeAttribute('title')
    }
    clearErrorLineMarker()
}

/**
 * Toggle play/pause state
 */
function togglePlayPause() {
    if (!renderer) return

    isPlaying = !isPlaying

    if (isPlaying) {
        renderer.start()
        canvas.classList.remove('paused')
    } else {
        renderer.stop()
        canvas.classList.add('paused')
    }
    refreshMenuBar()
}

/**
 * Wire drag-and-drop for image/video files. Dropping a media file:
 *  - For images: stores the file in IndexedDB and inserts a
 *    media(url: "image:<sha256>").write(o0) snippet
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
        background: color-mix(in srgb, var(--hf-accent, var(--accent3, #667eea)) 18%, transparent);
        backdrop-filter: var(--hf-glass-blur-sm, blur(4px));
        -webkit-backdrop-filter: var(--hf-glass-blur-sm, blur(4px));
        z-index: 6000;
        display: none;
        justify-content: center; align-items: center;
        pointer-events: none;
    `
    overlay.querySelector('.file-drop-message').style.cssText = `
        background: color-mix(in srgb, var(--hf-bg-surface, #0f1116) 95%, transparent);
        border: 2px dashed color-mix(in srgb, var(--hf-accent, var(--accent3, #a5b8ff)) 60%, transparent);
        color: var(--hf-text-bright, #fff);
        padding: var(--hf-space-6, 1.5rem) var(--hf-space-8, 2rem);
        border-radius: var(--hf-radius-lg, 12px);
        font-size: var(--hf-size-md, 1rem);
        display: flex;
        align-items: center;
        gap: var(--hf-space-2, 0.65rem);
        font-family: var(--hf-font-family, 'Nunito', sans-serif);
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
        try {
            await handleDroppedFile(file)
        } catch (err) {
            // A failed drop must never surface as an unhandled promise
            // rejection (FileReader failures, missing synth/media effect
            // after a network hiccup, unusable video source). The user only
            // sees silence otherwise.
            console.error('File drop failed:', err)
            showToast(`Couldn't use ${file.name || 'file'}: ${err?.message || err}`, 'warning')
        }
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
        const url = await storeImageFile(file)
        if (dslEditor) {
            await insertImageFile(url)
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

/** Make a stored image, named `image:<sha256>`, the program's media source. */
async function insertImageFile(url) {
    await liveInputsPanel.stopMediaSource()
    await renderer.inner.loadEffects(['synth/media'])
    // Sharing and an online session read the program's images from
    // renderer.images; resolving the stored image puts it there.
    await renderer.resolveImage(url.slice('image:'.length))
    insertImageSource(dslEditor, url, getEffect('synth.media').globals)
}

/**
 * Toggle performance mode — hides every panel, menu, and overlay so only the
 * canvas is visible. Useful for projection / VJ sets / clean recording.
 */
function togglePerformanceMode() {
    document.body.classList.toggle('performance-mode')
    const on = document.body.classList.contains('performance-mode')
    if (on) getCursorIdleHider().start()
    else getCursorIdleHider().stop()
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
    // The menu bar's fullscreen button pulls document.fullscreenElement.
    refreshMenuBar()
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
 * Boot-seeded editor focus vs. bare-digit scene recall. showCanvas() focuses
 * the editor before the user has interacted so live coders can type right
 * after boot, but that seed must not look like typing to the scene shortcuts:
 * until the user actually interacts — pointer down, or any key other than a
 * bare scene digit — a bare digit recalls its scene instead of inserting
 * itself into the program. The seed never weakens genuine typing suppression:
 * the first real interaction ends it and the editor behaves as before.
 */
let userInteracted = false
let bootFocusSeed = false

function seedBootEditorFocus() {
    if (!dslEditor) return
    dslEditor.focus()
    if (!userInteracted) {
        bootFocusSeed = true
    }
}

function endBootFocusSeed() {
    userInteracted = true
    bootFocusSeed = false
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
    seedBootEditorFocus()

    isPlaying = true
    refreshMenuBar()
}

// Whether the canvas is up and the render loop is running. A boot compile
// failure deliberately skips showCanvas()/renderer.start() — there is no
// compiled program to draw — but everything else about the app must come up,
// and the next successful compile (hot reload, scene load, remote edit, …)
// has to start the loop. All of those paths funnel through recompileShader,
// which calls this on success; on a normally-booted page it is a no-op.
let renderLoopStarted = false

function ensureRenderLoopStarted() {
    if (renderLoopStarted) return
    renderLoopStarted = true
    showCanvas()
    renderer.start()
}

async function publishLocalDsl(source) {
    try {
        await onlineAdapter?.updateLocalText(source)
    } catch (err) {
        console.debug('[Polymorphic] Online local text update failed:', err)
        showToast(err.message || 'Could not share image', 'error')
    }
}

// A peer types at the SDK's proposal cadence, roughly nine edits a second.
// Compiling each one drove nine full shader builds a second on every other
// participant, while local typing has always waited for a 500ms pause. Remote
// text now settles the same way, and a burst compiles once.
const REMOTE_COMPILE_DEBOUNCE_MS = 250
let remoteCompileTimer = null
let remoteCompilePending = null
let programStateDsl = null

async function applyCurrentDslFromOnline(source = 'remote') {
    if (remoteCompilePending) {
        remoteCompilePending.source = source
        remoteCompilePending.version++
        return remoteCompilePending.promise
    }

    const pending = { source, version: 0 }
    pending.promise = new Promise((resolve) => {
        remoteCompileTimer = setTimeout(async () => {
            remoteCompileTimer = null
            let result
            let version
            do {
                version = pending.version
                result = await runOnlineCompile(pending.source)
                if (version !== pending.version) {
                    // Keep continuous peer typing from driving shader builds
                    // back-to-back when each build outlasts an edit interval.
                    await new Promise(resolve => setTimeout(resolve, REMOTE_COMPILE_DEBOUNCE_MS))
                }
            } while (version !== pending.version)
            remoteCompilePending = null
            resolve(result)
        }, REMOTE_COMPILE_DEBOUNCE_MS)
    })
    remoteCompilePending = pending
    return pending.promise
}

async function runOnlineCompile(source) {
    if (hotReloadTimeout) {
        clearTimeout(hotReloadTimeout)
        hotReloadTimeout = null
    }
    // Single-flight gate (same contract as the other compile paths): wait
    // out any in-flight compile instead of racing it. The remote text is
    // already in the editor, so whichever apply runs last compiles the
    // latest text.
    while (_compileInFlight) {
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    let result
    try {
        _compileInFlight = true
        result = await recompileShader()
    } finally {
        _compileInFlight = false
    }
    if (result.superseded) return result
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
    if (!onlineCollaborationEnabled) return
    if (!dslEditor || onlineAdapter) return
    onlineAdapter = createPolymorphicOnlineAdapter({
        editor: dslEditor,
        dialog: seanceDialog,
        getCurrentDsl: () => dslEditor?.value || '',
        validatePublication: () => liveInputsPanel.hasLiveMedia
            ? { ok: false, reason: 'Only image sources can go online; stop the camera or video first' } : true,
        prepareImages: async dsl => {
            if (liveInputsPanel.hasLiveMedia) throw new Error('Only image sources can go online; stop the camera or video first')
            if (!/\burl\b/.test(dsl)) return { dsl, images: [] }
            const target = renderer
            const tools = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
            const prepared = await tools.prepareImagesForShare(dsl, tools.getReferencedImages(dsl, target.images || []))
            for (const image of prepared.images) if (!target.images.some(asset => asset.id === image.id)) target.images.push(image)
            return prepared
        },
        imageBlob: async image => (await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')).imageToBlob(image),
        applyCurrentDsl: applyCurrentDslFromOnline,
        showToast,
        // Keep the menu label (the only always-visible session indicator) in
        // step with the connection.
        onStatus: (status) => {
            refreshMenuBar()
            if (status === 'connecting' && !onlineAdapter?.isReconnecting?.()) {
                showToast('Connecting to session...', 'info')
            }
        },
        onReconnecting: () => refreshMenuBar(),
        onReconnected: () => refreshMenuBar(),
        onDisconnect: () => refreshMenuBar(),
        onModeration: () => refreshMenuBar(),
        onRemoteEdit: (frame) => flashRemoteEdit(frame),
        onRemoteMedia: (urls) => warnAboutRemoteMedia(urls),
        onRemoteRejected: (inspection) => {
            showToast('A remote update was refused: the program was too large', 'warning')
            console.warn('[Polymorphic] refused remote document:', inspection.reason)
        },
    })
    onlineAdapter.wireUi()
    // "go online..." is a menu-bar item wired via its config (seanceDialog.show)
}

// Remote text arrives in the same editor the local user types in, and until
// now it looked exactly like something they had written themselves. Handfish's
// editor has a distinct flash tone for it.
function flashRemoteEdit(frame) {
    const edit = frame?.edit
    if (!edit || !dslEditor?.flashLines) return
    const value = dslEditor.value || ''
    const startLine = lineNumberAt(value, edit.start)
    const endLine = lineNumberAt(value, Math.max(edit.start, edit.start + (edit.text?.length || 0) - 1))
    dslEditor.flashLines(startLine, endLine, { tone: 'remote' })
}

// Anyone holding the link can add a media() url, and this browser will fetch
// it: that discloses the viewer's address to a host the peer chose. Say so
// once per session rather than fetching silently.
let warnedAboutRemoteMedia = false
function warnAboutRemoteMedia(urls) {
    if (warnedAboutRemoteMedia || !urls?.length) return
    warnedAboutRemoteMedia = true
    showToast('This session loads media from another site. Go offline if you did not expect that.', 'warning')
    console.warn('[Polymorphic] remote media sources in session text:', urls)
}

async function joinOnlineSessionFromUrlIfPresent() {
    if (!onlineCollaborationEnabled) return
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
    if (result.superseded) return
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
        info: 'var(--hf-blue, rgba(102, 126, 234, 0.95))',
        success: 'var(--hf-green, rgba(74, 222, 128, 0.95))',
        warning: 'var(--hf-yellow, rgba(251, 191, 36, 0.95))',
        error: 'var(--hf-red, rgba(239, 68, 68, 0.95))'
    }
    const textColor = type === 'warning' ? 'var(--hf-color-1, #111)' : 'var(--hf-text-bright, #fff)'

    const toast = document.createElement('div')
    toast.className = 'polymorphic-toast'
    toast.dataset.type = type
    toast.setAttribute('role', 'status')
    toast.setAttribute('aria-live', 'polite')
    toast.textContent = message
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type] || colors.info};
        color: ${textColor};
        padding: var(--hf-space-3, 12px) var(--hf-space-6, 24px);
        border-radius: var(--hf-radius, 8px);
        font-size: var(--hf-size-base, 14px);
        font-family: inherit;
        z-index: 10001;
        box-shadow: var(--hf-shadow-lg, 0 4px 12px rgba(0,0,0,0.3));
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
                    const definition = portableDefinition(effectData)
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

        if (liveInputsPanel.hasLiveMedia) throw new Error('Only image sources can be shared; stop the camera or video first')
        if (/\burl\b/.test(payload.dsl)) {
            const { prepareImagesForShare, getReferencedImages } = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
            Object.assign(payload, await prepareImagesForShare(payload.dsl, getReferencedImages(payload.dsl, renderer.images || [])))
        }

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
    renderer.images = composition.images || []
    
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
    refreshMenuBar()
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
let shaderCompileQueue = Promise.resolve()
let shaderCompileVersion = 0

async function recompileShader(overrideDsl) {
    if (!renderer || !dslEditor) return { success: false, error: 'Not initialized' }

    const dsl = overrideDsl ?? dslEditor.value
    const editorDsl = dslEditor.value
    if (!dsl.trim()) {
        return { success: false, error: 'Empty program' }
    }

    const version = ++shaderCompileVersion
    const previous = shaderCompileQueue
    let release
    shaderCompileQueue = new Promise(resolve => { release = resolve })
    const superseded = () => version !== shaderCompileVersion || dslEditor.value !== editorDsl
    try {
        // All entry points share the renderer, including history and parameter
        // changes that do not participate in the editor's busy indicator.
        await previous
        if (superseded()) return { success: false, superseded: true }
        // Preload any new fonts used in text effects
        await preloadFontsForDsl(dsl)
        if (superseded()) return { success: false, superseded: true }

        if (/\burl\b/.test(dsl)) {
            const tools = renderer._imageTools || await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
            if (tools.getMediaSources(dsl).some(source => source.url && source.url !== 'live')) await liveInputsPanel.stopMediaSource()
            if (superseded()) return { success: false, superseded: true }
        }

        const result = await renderer.compile(dsl)
        if (result.success) {
            // This is the program actually installed by the renderer, even
            // when a newer draft is waiting. Keep controls truthful if that
            // next draft fails; programStateDsl prevents rewriting its text.
            syncProgramStateFromDsl(dsl)
            refreshControlsPanelAfterDslChange(dsl)
            // A boot that failed to compile reaches its first success here:
            // bring the canvas up and start the loop (no-op once running).
            ensureRenderLoopStarted()
        }
        if (superseded()) return { success: false, superseded: true }
        return result
    } catch (err) {
        if (superseded()) return { success: false, superseded: true }
        console.error('Recompile error:', err)
        return { success: false, error: err.message }
    } finally {
        release()
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
        renderer.applyImageDimensions(programState)
        programStateDsl = dsl
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
        // Clear stale diagnostic line markers when user edits code
        clearErrorLineMarker()

        // Update reset button visibility
        updateResetButtonVisibility()

        // Schedule hot reload
        scheduleHotReload()
    })

    // Handle force recompile event from Ctrl/Cmd+Enter
    // The code-editor component dispatches 'forcerecompile' events
    dslEditor.addEventListener('forcerecompile', async () => {
        // Clear pending hot reload
        if (hotReloadTimeout) {
            clearTimeout(hotReloadTimeout)
            hotReloadTimeout = null
        }
        // Single-flight gate: wait out any in-flight compile instead of dropping user action
        while (_compileInFlight) {
            await new Promise(resolve => setTimeout(resolve, 25))
        }
        try {
            _compileInFlight = true
            const result = await recompileShader()
            if (result.superseded) return
            const value = dslEditor.value || ''
            const lineCount = value ? value.split('\n').length : 1
            if (!result.success) {
                console.warn('Manual compile failed:', result.error)
                showCompilerError(result.error)
                const loc = parseErrorLocation(result.error)
                if (loc) {
                    dslEditor.flashLines?.(loc.line, loc.line, { error: true })
                } else {
                    dslEditor.flashLines?.(1, lineCount, { error: true })
                }
            } else {
                hideCompilerError()
                dslEditor.flashLines?.(1, lineCount)
                if (value) pushSnapshot(value)
                outputPicker.setDsl(dslEditor.value).catch(err => console.debug('[outputPicker] setDsl failed:', err))
            }
        } finally {
            _compileInFlight = false
        }
    })

    // Cmd+Shift+Enter / Alt+Enter — evaluate current block (or selection)
    dslEditor.addEventListener('forceevalblock', async () => {
        if (hotReloadTimeout) {
            clearTimeout(hotReloadTimeout)
            hotReloadTimeout = null
        }
        // Single-flight gate: wait out any in-flight compile instead of dropping user action
        while (_compileInFlight) {
            await new Promise(resolve => setTimeout(resolve, 25))
        }
        const sel = getSelectionOrBlock(dslEditor)
        if (!sel || !sel.text.trim()) {
            // Fall through to whole-program eval
            try {
                _compileInFlight = true
                const result = await recompileShader()
                if (result.superseded) return
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
            if (result.superseded) return
            const value = dslEditor.value || ''
            const startLine = lineNumberAt(value, sel.start)
            const endLine = lineNumberAt(value, Math.max(sel.start, sel.end - 1))
            if (!result.success) {
                console.warn('Block eval failed:', result.error)
                const loc = parseErrorLocation(result.error)
                if (loc) {
                    const headerLines = /^\s*search\s+/m.test(sel.text.trim()) ? 0 : 2
                    const leadingWs = sel.text.slice(0, sel.text.length - sel.text.trimStart().length)
                    const leadingLines = (leadingWs.match(/\n/g) || []).length
                    const snippetLine = loc.line - headerLines
                    const docLine = Math.max(startLine, Math.min(endLine, startLine + leadingLines + (snippetLine - 1)))
                    const docLoc = { line: docLine, col: loc.col }

                    const mappedError = result.error.replace(/\bline\s+\d+/i, `line ${docLine}`)
                    showCompilerError(mappedError)
                    dslEditor.flashLines?.(docLine, docLine, { error: true })
                    setErrorLineMarker(docLoc)
                } else {
                    showCompilerError(result.error)
                    dslEditor.flashLines?.(startLine, endLine, { error: true })
                }
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
        if (before.trim()) pushSnapshot(before)
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
        suppressDslReact = true
        try { renderer.applyImageDimensions(programState) } finally { suppressDslReact = false }
        if (!dslEditor || !programState) return
        // Parameter controls still describe the last successful compile while
        // a newer draft is loading (or has a compile error).
        if (dslEditor.value !== programStateDsl) return
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
        const editorDsl = (renderer._imageTools?.restoreMediaUrls || restoreMediaUrls)(dslEditor.value, newDsl)
        if (editorDsl === dslEditor.value) return
        suppressDslReact = true
        try {
            dslEditor.value = editorDsl
            programStateDsl = editorDsl
            if (renderer?.canvasRenderer) {
                renderer.canvasRenderer.currentDsl = newDsl
            }
        } finally {
            suppressDslReact = false
        }
        publishLocalDsl('program-state')

        // Text overlays are rasterized here, not by a shader, so a panel edit
        // to a text parameter has to redraw them, in its newly chosen font.
        preloadFontsForDsl(editorDsl)
            .catch(err => console.warn('[Polymorphic] font preload failed:', err))
            .then(() => {
                if (dslEditor.value === editorDsl) renderer?.refreshTextTextures(editorDsl)
            })
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
            if (result.superseded) return
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
            if (result.superseded) return
            if (!result.success) {
                console.warn('Hot reload compile failed:', result.error)
                showCompilerError(result.error)
            } else {
                hideCompilerError()
                // Snapshot the successful program state and stamp the URL so the
                // current sketch is shareable just by copying the URL.
                if (dslEditor?.value) {
                    pushSnapshot(dslEditor.value)
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
 * Record a successfully compiled program in snapshot history, which lives in
 * localStorage. A program that carries an image as base64 text (pasted, or
 * from an older link) is recorded with the image stored in IndexedDB and named
 * by reference; when the image cannot be stored, the program is not recorded.
 */
function pushSnapshot(dsl) {
    if (!hasImageText(dsl)) {
        snapshotHistory.push(dsl)
        return
    }
    storeImageText(dsl).then(
        stored => snapshotHistory.push(stored),
        err => console.warn('[Polymorphic] Snapshot not recorded; its image could not be stored:', err)
    )
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
            if (r.superseded) return
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
            if (r.superseded) return
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
            compositionImages = composition.images || []
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
    const storedBackend = (() => { try { return localStorage.getItem('polymorphic-backend') } catch { return null } })()
    const { urlBackend, preferWebGPU } = resolveBackendPreference(window.location.search, storedBackend)

    // Graphics context loss recovery (Domain 4): a GPU reset (driver update,
    // GPU process crash, tab backgrounded under memory pressure) fires
    // `webglcontextlost` on the canvas. The renderer stops its loop and asks
    // the browser for a fresh context; on `webglcontextrestored` we recompile
    // the editor's current DSL — compile() recreates every GPU resource — and
    // restart the loop. Editor text, scene snapshots and program state live
    // outside the renderer, so nothing but the loop needs saving here.
    let contextRecoveryInFlight = false

    // Shared by the WebGL context-restored path and the WebGPU device.lost
    // path: recompile the editor's current DSL (recreating every GPU resource
    // on a fresh context/device) and restart the loop.
    async function recoverGraphics() {
        if (contextRecoveryInFlight) return
        contextRecoveryInFlight = true
        try {
            const dsl = dslEditor?.value || originalDsl || ''
            const result = await renderer.recoverFromContextLoss(dsl)
            if (result.success) {
                showToast('Graphics restored — your program is live again', 'success')
            } else {
                showToast(`Could not restore your program after a graphics reset: ${result.error}`, 'error')
            }
        } catch (err) {
            console.error('Context loss recovery failed:', err)
            showToast('Could not restore your program after a graphics reset', 'error')
        } finally {
            contextRecoveryInFlight = false
        }
    }

    // Create renderer
    renderer = new PolymorphicRenderer(canvas, {
        width,
        height,
        loopDuration: 10,
        preferWebGPU,
        onError: (err) => {
            console.error('Render error:', err)
        },
        onContextLost: () => {
            showToast('Graphics context lost — recovering your program…', 'warning')
        },
        onContextRestored: () => {
            return recoverGraphics()
        },
        onDeviceLost: (info) => {
            showToast('GPU device lost — recovering your program…', 'warning')
            console.warn('WebGPU device lost:', info?.reason || info || 'unknown reason')
            return recoverGraphics()
        }
    })
    renderer.images = compositionImages
    // Portable effects registered after boot update the renderer's live state.
    setRuntimeRenderer(renderer.canvasRenderer)
    renderer.resolveImage = async id => {
        // Saved images are files in IndexedDB; the rest come from the online session.
        const stored = await getProgramImage(id)
        const blob = stored || await onlineAdapter.getImage(id)
        const tools = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
        // A stored image that sharing would refuse, such as one over its size
        // limit, still renders.
        const image = await tools.prepareImage(blob).catch(error => { if (!stored) throw error })
        if (image && !renderer.images.some(asset => asset.id === image.id)) renderer.images.push(image)
        return blob
    }
    syncOutputController?.dispose()
    syncOutputController = initializeSyncOutputController({
        renderer: renderer.inner,
        getCanvas: () => canvas,
        connectionProvider: createSyncOutputConnectionProvider({
            transport: typeof window !== 'undefined' ? window.__POLYMORPHIC_SYNC_TRANSPORT__ : undefined
        })
    })
    syncOutputDialog?.destroy()
    syncOutputDialog = createSyncOutputDialog({ controller: syncOutputController })

    try {
        // Preload fonts used in text effects
        await preloadFontsForDsl(dsl)

        // Initialize the renderer
        await renderer.init()

        // Notify user if WebGPU was requested (via URL param or stored preference)
        // but the environment does not support it and fell back to WebGL2.
        if (isWebGPUFallback({ preferWebGPU, actualBackend: renderer.backend })) {
            showToast(WEBGPU_FALLBACK_MESSAGE, 'info')
            if (storedBackend === 'webgpu') {
                try { localStorage.removeItem('polymorphic-backend') } catch { /* ignore */ }
            }
        }

        // ProgramState needs the underlying CanvasRenderer (with manifest/enums).
        // Set it up before any compile so we can populate state from the result.
        setupProgramState()

        // Initialize panels that depend on the renderer
        liveInputsPanel.init({
            renderer,
            onInsert: async (snippet, opts) => {
                if (dslEditor) {
                    if (opts?.as === 'image') await insertImageFile(snippet)
                    else insertAtCursor(dslEditor, snippet)
                }
                publishLocalDsl('live-inputs')
                liveInputsPanel.flashSnippet?.(snippet)
            }
        })

        outputPicker.init({
            onSwitch: (idx, opts) => switchOutput(idx, opts)
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
            onChange: ({ recording, stoppedReason }) => {
                recordToggleBtn?.classList.toggle('recording', recording)
                refreshMenuBar()
                statusRow.setRecording(recording)
                if (!recording && stoppedReason && stoppedReason !== 'manual') {
                    if (stoppedReason === 'duration_limit') {
                        showToast('Recording stopped: reached 15-minute duration limit', 'info')
                    } else if (stoppedReason === 'memory_limit') {
                        showToast('Recording stopped: reached memory safety limit', 'info')
                    }
                }
            }
        })

        // Compile the DSL program
        const result = await renderer.compile(dsl)

        if (result.success) {
            // Initialize ProgramState from the compiled DSL
            syncProgramStateFromDsl(dsl)

            // Show canvas and start rendering
            ensureRenderLoopStarted()
        } else {
            // A broken boot program (?dsl= or ?code=) must land in the same
            // recoverable state as a hot-reload compile failure: the app stays
            // alive, the error surfaces through the recoverable compiler-error
            // banner (not the terminal #error dead end), and the next
            // successful compile — hot reload, scene load, remote edit — starts
            // the canvas and loop via recompileShader. A ?code= visitor who
            // merely followed a link could never recover from the dead end.
            loadingEl.classList.remove('visible')
            showCompilerError(result.error)
        }

        // Store original DSL and populate editor — with the broken program too,
        // so the editor shows what failed and fixing it recovers the app.
        originalDsl = dsl
        if (dslEditor) {
            dslEditor.value = dsl
        }

        if (result.success) {
            outputPicker.setDsl(dsl).catch(err => console.debug('[outputPicker] setDsl failed:', err))
        }

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

        // Clean up on page unload. `pagehide` (not `beforeunload`) is the
        // reliable teardown signal on iOS Safari, and its `persisted` flag
        // tells us the page is only being frozen for the bfcache — disposing
        // the GL context there would leave a dead canvas on restore.
        window.addEventListener('pagehide', (e) => {
            if (e.persisted) return
            syncOutputController?.dispose()
            liveInputsPanel.dispose()
            renderer.dispose()
        })

    } catch (err) {
        console.error('Initialization error:', err)
        if (storedBackend === 'webgpu') {
            try { localStorage.removeItem('polymorphic-backend') } catch { /* ignore */ }
        }
        showError(`Failed to initialize: ${err.message}`)
    }
}

/**
 * Set up menu bar dropdowns and handlers
 */
function setupMenuBar() {
    // Menu structure, items, and buttons live in the shared <menu-bar>
    // component config (assigned at module scope above). What remains here is
    // the app-level keyboard map and listeners that outlive any menu.

    // Viewport window popup mirror needs the canvas reference.
    configureViewportWindow({ canvas })

    // Snapshot history shortcuts (Cmd/Ctrl+Alt+Left/Right)
    document.addEventListener('keydown', (e) => {
        // Any keypress other than a bare scene digit ends the boot focus seed
        // (see seedBootEditorFocus): from then on, digits headed for the
        // editor are genuine typing again.
        if (!/^Digit[1-9]$/.test(e.code || '') || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
            endBootFocusSeed()
        }
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
        // Cmd/Ctrl+I toggles the live inputs panel
        if (mod && !e.shiftKey && !e.altKey && (e.key === 'i' || e.key === 'I')) {
            e.preventDefault()
            liveInputsPanel.toggle()
            refreshMenuBar()
            return
        }
        // Cmd/Ctrl+; toggles the status row
        if (mod && !e.shiftKey && !e.altKey && e.key === ';') {
            e.preventDefault()
            statusRow.toggle()
            refreshMenuBar()
            return
        }
        // Cmd/Ctrl+Shift+H toggles performance mode (hide all UI)
        if (mod && e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H')) {
            e.preventDefault()
            togglePerformanceMode()
            return
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
        // Esc exits performance mode (only when no dialog, modal, menu, or escapeable was dismissed)
        if (e.key === 'Escape' && document.body.classList.contains('performance-mode')) {
            if (e.defaultPrevented || hasOpenEscapeables() || document.querySelectorAll('dialog[open]').length > 0) {
                return
            }
            e.preventDefault()
            document.body.classList.remove('performance-mode')
            getCursorIdleHider().stop()
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
                    // Images first: a saved scene must never name an image that is not stored.
                    storeDslImages(dsl, renderer?.images).then(stored => {
                        const res = scenes.save(slot, stored)
                        if (res && res.success === false) {
                            if (res.quotaExceeded) {
                                showToast(`Could not save scene ${slot}: storage quota exceeded`, 'error')
                            } else {
                                showToast(`Could not save scene ${slot}: storage error`, 'error')
                            }
                        } else {
                            showToast(`Saved scene ${slot}`, 'success')
                        }
                    }, error => showToast(`Could not save scene ${slot}: ${error.message}`, 'error'))
                } else {
                    showToast(`Cannot save empty scene ${slot}`, 'warning')
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
                           el.isContentEditable || el.closest?.('code-editor'))) {
                    // The editor is focused, but a boot-seeded focus the user
                    // has never interacted with is not typing: right after
                    // boot a bare digit recalls its scene rather than editing
                    // the program. Any real interaction has already ended the
                    // seed (see endBootFocusSeed), so this cannot swallow a
                    // digit the user meant for the editor.
                    if (!bootFocusSeed) return
                }
                const dsl = scenes.load(slot)
                if (dsl) renderer.images = scenes.images(slot)
                if (dsl && dslEditor) {
                    dslEditor.value = dsl
                    publishLocalDsl('scene-load')
                    scheduleHotReload()
                    showToast(`Loaded scene ${slot}`, 'info')
                } else if (!dsl) {
                    showToast(`Scene ${slot} is empty`, 'info')
                }
                e.preventDefault()
            }
        }
    })
    // Pointer interaction ends the boot focus seed too (see endBootFocusSeed).
    document.addEventListener('pointerdown', endBootFocusSeed, { capture: true })
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
    refreshMenuBar()
    
    // Initialize program modal
    initProgramModal({
        getDsl: () => dslEditor?.value || '',
        prepareDsl: dsl => storeDslImages(dsl, renderer?.images),
        setDsl: (dsl, images = []) => {
            if (renderer) renderer.images = images
            if (dslEditor) {
                dslEditor.value = dsl
                publishLocalDsl('program-load')
                updateResetButtonVisibility()
                scheduleHotReload()
            }
        },
        showToast
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
            refreshMenuBar()
        })
    }
    
    // Set up compiler error click-to-jump (or fallback copy)
    if (compilerErrorEl) {
        compilerErrorEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                compilerErrorEl.click()
            }
        })
        compilerErrorEl.addEventListener('click', () => {
            const text = compilerErrorEl.textContent
            const loc = parseErrorLocation(text)
            if (loc && dslEditor) {
                const ta = dslEditor.getTextarea?.()
                if (!ta) return
                const lines = ta.value.split('\n')
                const targetLineIndex = Math.max(0, Math.min(loc.line - 1, lines.length - 1))
                let offset = 0
                for (let i = 0; i < targetLineIndex; i++) {
                    offset += lines[i].length + 1
                }
                const targetLineText = lines[targetLineIndex] || ''
                const colOffset = Math.max(0, Math.min(loc.col - 1, targetLineText.length))
                offset += colOffset

                // Determine token boundary to highlight the offending identifier or token
                let endOffset = offset
                if (colOffset < targetLineText.length) {
                    const char = targetLineText[colOffset]
                    if (/[a-zA-Z0-9_]/.test(char)) {
                        while (endOffset < offset + (targetLineText.length - colOffset) &&
                               /[a-zA-Z0-9_]/.test(targetLineText[colOffset + (endOffset - offset)])) {
                            endOffset++
                        }
                    } else if (!/\s/.test(char)) {
                        endOffset = offset + 1
                    }
                }

                // Scroll error line into view if outside visible viewport
                const lineHeight = parseFloat(window.getComputedStyle?.(ta).lineHeight) || 22
                const lineTop = targetLineIndex * lineHeight
                const viewHeight = ta.clientHeight || 200
                if (lineTop < ta.scrollTop || lineTop > ta.scrollTop + viewHeight - lineHeight) {
                    ta.scrollTop = Math.max(0, lineTop - viewHeight / 3)
                    dslEditor.syncScroll?.()
                }

                ta.focus()
                ta.setSelectionRange(offset, Math.max(offset, endOffset))
                dslEditor.flashLines?.(loc.line, loc.line, { error: true })
                setErrorLineMarker(loc)
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
            getParamBounds: (funcName, paramName) => {
                if (!funcName || !paramName) return null
                const def = lookupEffectDef({ name: funcName, fullName: funcName })
                if (!def) return null
                const spec = def.globals?.[paramName] || (Array.isArray(def.params) ? def.params.find(p => p.name === paramName) : null)
                if (spec && (spec.min != null || spec.max != null)) {
                    return { min: spec.min, max: spec.max, isInt: spec.type === 'int' }
                }
                return null
            },
            recompile: async () => {
                // While scrubbing we want immediate compile; debounce is too slow
                if (hotReloadTimeout) {
                    clearTimeout(hotReloadTimeout)
                    hotReloadTimeout = null
                }
                const r = await recompileShader()
                if (r.superseded) return
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
            get syncOutputController() { return syncOutputController },
            recorder,
            perfOverlay,
            tempoController,
            get tempoBar() { return document.getElementById('tempo-bar') },
            statusRow,
            commandPalette,
            gallery,
            snapshotHistory,
            shortcutsDialog,
            outputPicker,
            switchOutput,
            cycleOutputSurface,
            hushSurfaces,
            get onlineAdapter() { return onlineAdapter },
            get renderer() { return renderer },
            get backend() { return renderer?.backend },
            showToast,
            get programState() { return programState }
        }
    }

    // Programs, scenes and snapshot history saved before images had their own
    // storage hold them as base64 text in localStorage. Move the bytes to
    // IndexedDB; non-blocking.
    migrateProgramImages([programs, scenes, snapshotHistory])
        .catch(err => console.error('Failed to move program images:', err))

    // Start shader immediately (no consent screen for Polymorphic)
    startShader()
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
        savePNG: () => document.getElementById('savePNG')?.click?.(),
        saveJPG: () => document.getElementById('saveJPG')?.click?.(),
        shareProgram: () => document.getElementById('shareProgram')?.click?.(),
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
        switchOutputSurface: (idx, opts) => switchOutput(idx, opts),
        cycleOutputSurface: (delta, opts) => cycleOutputSurface(delta, opts),
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
 * Switch active render output to surface index `idx` (0-7).
 * Updates DSL editor content, publishes local DSL, and recompiles immediately.
 * If options.resetFeedback is true, cleanly clears previous surface feedback buffers via hushSurfaces.
 *
 * @param {number} idx - Surface index (0-7)
 * @param {object} [options={}] - { resetFeedback?: boolean, clearFeedback?: boolean }
 */
async function switchOutput(idx, options = {}) {
    if (!dslEditor) return
    const resetFeedback = Boolean(options.resetFeedback || options.clearFeedback)
    const current = dslEditor.value
    const next = switchOutputSurface(current, idx)
    if (next === current && !resetFeedback) return

    dslEditor.value = next
    publishLocalDsl('output-picker')
    if (hotReloadTimeout) {
        clearTimeout(hotReloadTimeout)
        hotReloadTimeout = null
    }

    const result = resetFeedback ? await hushSurfaces() : await recompileShader()
    if (result?.success) {
        pushSnapshot(next)
        stampUrl(next)
        outputPicker.setDsl(next).catch(err => console.debug('[outputPicker] setDsl failed:', err))
    }
}

/**
 * Cycle active render output among surfaces written in the DSL.
 * @param {number} [delta=1] - Direction (+1 next, -1 previous)
 * @param {object} [options={}] - { resetFeedback?: boolean }
 */
function cycleOutputSurface(delta = 1, options = {}) {
    if (!dslEditor) return
    const dsl = dslEditor.value
    const surfaces = surfacesWrittenInDsl(dsl)
    if (surfaces.length === 0) return
    const current = effectiveRenderTarget(dsl)
    const currentIndex = current !== null ? surfaces.indexOf(current) : -1
    const nextIndex = currentIndex >= 0
        ? (currentIndex + delta + surfaces.length) % surfaces.length
        : (delta >= 0 ? 0 : surfaces.length - 1)
    const targetSurface = surfaces[nextIndex]
    switchOutput(targetSurface, options)
}

/**
 * Reset surfaces o0..o7 by recompiling. The pipeline reallocates surface
 * textures on each compile, which clears any feedback state. We also briefly
 * suspend the renderer to avoid showing a partial frame.
 */
async function hushSurfaces() {
    if (!renderer || !dslEditor) return { success: false }
    const dsl = dslEditor.value
    if (!dsl?.trim()) return { success: false }
    const wasPlaying = isPlaying
    renderer.stop()
    try {
        const r = await recompileShader()
        if (r.superseded) return r
        if (r.success) {
            showToast('Surfaces cleared', 'success')
        }
        return r
    } finally {
        if (wasPlaying) renderer.start()
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
} else {
    init()
}
