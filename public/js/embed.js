/**
 * Polymorphic - Live Coding Entry Point
 *
 * Initializes the full-page canvas shader renderer with DSL editor.
 * Hot reload functionality for live coding experience.
 */

const APP_VERSION = '0.9.0-SNAPSHOT'

import { AboutDialog } from 'handfish'
import { PolymorphicRenderer } from './noisemaker/renderer.js'
import { preloadFontsForDsl } from './fontLoader.js'
import { initDocReader, toggleDocReader, showPlaceholderContent, hideDocReader, showDocReader, setApplyToEditorCallback } from './docReader.js'
import { shareModal } from './shareModal.js'
import { loadFromCode, getCodeFromUrl, registerPortableEffect, getLoadedPortableEffects } from './sharingLoader.js'
import { initProgramModal, openProgramModal } from './programModal.js'
import { ImportEffectDialog } from './ui/import-effect-dialog.js'
import { importFromUrlDialog } from './ui/import-from-url-dialog.js'
import './ui/codeEditor.js'  // Register <code-editor> custom element

// DOM elements
const canvas = document.getElementById('canvas')
const loadingEl = document.getElementById('loading')
const errorEl = document.getElementById('error')
const dslOverlay = document.getElementById('dsl-overlay')
const dslEditor = document.getElementById('dsl-editor')
const compilerErrorEl = document.getElementById('compiler-error')
const docReaderClose = document.querySelector('.doc-reader-close')

// Menu bar elements
const codeToggleBtn = document.getElementById('code-toggle-btn')
const docToggleBtn = document.getElementById('doc-toggle-btn')
const fullscreenBtnMenu = document.getElementById('fullscreen-btn-menu')
const playPauseBtnMenu = document.getElementById('play-pause-btn-menu')

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

// Renderer reference (set after initialization)
let renderer = null

// Hot reload state
let hotReloadTimeout = null

// Original DSL (for reset functionality)
let originalDsl = ''

// Playback state
let isPlaying = false

// =========================================================================
// Imported Effect Storage (for Edit in Noisedeck)
// =========================================================================

/**
 * Store for the last imported effect files.
 * This allows us to transport the effect to Noisedeck via sharing-is-caring.
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

    // Store the imported files for "Edit in Noisedeck" feature
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
const DEFAULT_DSL = `search synth, filter, render

noise(
  type: linear,
  octaves: 4,
  scaleX: 100,
  scaleY: 100,
  seed: 3,
  ridges: true,
  loopScale: 1,
  speed: 100
)
  .palette(index: dealerHat)
  .loopBegin(alpha: 94.895, intensity: 94.309)
  .warp(
    strength: 23.566,
    scale: 0.83,
    seed: 3,
    speed: 1,
    wrap: clamp
  )
  .loopEnd()
  .lighting(
    normalStrength: 5,
    smoothing: 2.3,
    specularIntensity: 1.04,
    shininess: 88,
    reflection: 31.3,
    refraction: 20.1,
    aberration: 22.8
  )
  .write(o0)

render(o0)`

/**
 * Show compiler error with line-level span wrapping
 */
function showCompilerError(errorText) {
    if (!compilerErrorEl) return
    // Wrap entire text in a single span for glyph background
    const escaped = errorText.replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
    ecosystem: 'Polymorphic is a free tool by <a href="https://noisefactor.io/" target="_blank" rel="noopener">Noise Factor</a>, powered by the <a href="https://noisemaker.app/" target="_blank" rel="noopener">Noisemaker</a> open source engine. <a href="https://noisedeck.app/" target="_blank" rel="noopener">Noisedeck</a> is our video synth. Free to use, with a $4/mo subscription for pro features.',
})

fetch('./deployment-meta.json', { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) return
    const data = await res.json()
    const hash = data.git_hash?.trim().slice(0, 8) || 'LOCAL'
    const deployed = data.date ? new Date(data.date * 1000) : null
    aboutDialog.setBuild({ hash, deployed })
}).catch(() => {})

aboutDialog.setNoisemakerFromUrl('https://shaders.noisedeck.app/0/deployment-meta.json')

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
// Edit in Noisedeck
// =========================================================================

const SHARE_API_URL = 'https://sharing.noisedeck.app/api/embed/shorten'
const NOISEDECK_URL = 'https://noisedeck.app'

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
 * Share the effect and open Noisedeck in a new window
 */
async function handleEditInNoisedeck() {
    // Get DSL from editor
    let dsl = dslEditor?.value || ''
    if (!dsl) {
        showToast('Nothing to edit. Create an effect first!', 'warning')
        return
    }

    showToast('Opening in Noisedeck...', 'info')

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
            console.warn('[Noisedeck] Screenshot capture failed:', err)
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
                console.warn('[Noisedeck] Effect ZIP creation failed:', err)
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
                    console.log(`[Noisedeck] Packaged sharing effect: ${effectFunc}`)
                } catch (err) {
                    console.warn(`[Noisedeck] Failed to package sharing effect ${effectFunc}:`, err)
                }
            }
        }

        // Build payload
        const payload = {
            dsl,
            title: importedEffectStore.name || 'Polymorphic Effect',
            description: 'Created with Polymorphic',
            ttlMinutes: 60  // Reduced TTL for edit-in-noisedeck links
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
        console.log('[Noisedeck] Share result:', result)

        // Open Noisedeck with the short code
        const noisedeckUrl = `${NOISEDECK_URL}/?code=${result.code}`
        window.open(noisedeckUrl, '_blank')

        showToast('Opened in Noisedeck', 'success')
    } catch (error) {
        console.error('[Noisedeck] Error:', error)
        showToast(`Failed to open in Noisedeck: ${error.message}`, 'error')
    }
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
 * Get DSL from URL parameters or use default
 */
function getDslFromUrl() {
    // Check for embedded DSL first
    if (window.EMBEDDED_DSL) {
        return window.EMBEDDED_DSL
    }
    const params = new URLSearchParams(window.location.search)
    return params.get('dsl') || DEFAULT_DSL
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
 */
async function recompileShader() {
    if (!renderer || !dslEditor) return { success: false, error: 'Not initialized' }
    
    const dsl = dslEditor.value
    if (!dsl.trim()) {
        return { success: false, error: 'Empty program' }
    }
    
    try {
        // Preload any new fonts used in text effects
        await preloadFontsForDsl(dsl)

        const result = await renderer.compile(dsl)
        return result
    } catch (err) {
        console.error('Recompile error:', err)
        return { success: false, error: err.message }
    }
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
        // Clear pending hot reload
        if (hotReloadTimeout) {
            clearTimeout(hotReloadTimeout)
            hotReloadTimeout = null
        }
        const result = await recompileShader()
        if (!result.success) {
            console.warn('Manual compile failed:', result.error)
            showCompilerError(result.error)
        } else {
            hideCompilerError()
        }
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
        const result = await recompileShader()
        if (!result.success) {
            console.warn('Hot reload compile failed:', result.error)
            showCompilerError(result.error)
        } else {
            hideCompilerError()
        }
    }, 500)
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
    
    if (!dsl) {
        showError('No shader program specified')
        return
    }

    showLoading()

    // Set up canvas sizing
    const { width, height } = resizeCanvas()

    // Create renderer
    renderer = new PolymorphicRenderer(canvas, {
        width,
        height,
        loopDuration: 10,
        onError: (err) => {
            console.error('Render error:', err)
        }
    })

    try {
        // Preload fonts used in text effects
        await preloadFontsForDsl(dsl)

        // Initialize the renderer
        await renderer.init()

        // Compile the DSL program
        const result = await renderer.compile(dsl)

        if (!result.success) {
            showError(`Shader error: ${result.error}`)
            return
        }

        // Show canvas and start rendering
        showCanvas()
        renderer.start()

        // Store original DSL and populate editor
        originalDsl = dsl
        if (dslEditor) {
            dslEditor.value = dsl
        }

        // Handle resize
        window.addEventListener('resize', () => {
            const { width, height } = resizeCanvas()
            renderer.resize(width, height)
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
    // Initialize doc reader and show by default
    initDocReader()
    setApplyToEditorCallback((code) => {
        if (dslEditor) {
            dslEditor.value = code;
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
                updateResetButtonVisibility()
                scheduleHotReload()
            }
        }
    })
    
    // Set up menu bar
    setupMenuBar()
    
    // Set up doc reader close button
    if (docReaderClose) {
        docReaderClose.addEventListener('click', () => {
            hideDocReader()
            if (docToggleBtn) {
                docToggleBtn.classList.remove('active')
            }
        })
    }
    
    // Set up compiler error click-to-copy
    if (compilerErrorEl) {
        compilerErrorEl.addEventListener('click', async () => {
            const errorText = compilerErrorEl.textContent
            try {
                await navigator.clipboard.writeText(errorText)
                console.log('Error copied to clipboard')
            } catch (err) {
                console.error('Failed to copy error:', err)
            }
        })
    }
    
    // Set up DSL editor with hot reload
    setupDslEditor()
    
    // Start shader immediately (no consent screen for Polymorphic)
    startShader()
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
} else {
    init()
}
