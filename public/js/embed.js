/**
 * Polymorphic - Live Coding Entry Point
 *
 * Initializes the full-page canvas shader renderer with DSL editor.
 * Hot reload functionality for live coding experience.
 */

import { PolymorphicRenderer } from './noisemaker/renderer.js'
import { preloadFontsForDsl } from './fontLoader.js'
import { initDocReader, toggleDocReader, showPlaceholderContent, hideDocReader, showDocReader, setApplyToEditorCallback } from './docReader.js'
import { shareModal } from './shareModal.js'
import { loadFromCode, getCodeFromUrl } from './sharingLoader.js'
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

/**
 * Default DSL program for new sessions
 */
const DEFAULT_DSL = `search synth, filter, render

noise(
  noiseType: linear,
  octaves: 4,
  xScale: 100,
  yScale: 100,
  seed: 3,
  ridges: true,
  loopScale: 1,
  loopAmp: 100
)
  .palette(paletteIndex: palette.dealerHat)
  .loopBegin(alpha: 94.895, intensity: 94.309)
  .warp(
    strength: 23.566,
    scale: 0.83,
    seed: 3,
    speed: 1,
    wrap: clamp,
    rotation: 31.193
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
 * About Modal
 */
let aboutModalEl = null
let aboutModalEscHandler = null

function openAboutModal() {
    if (aboutModalEl) return
    
    aboutModalEl = document.createElement('div')
    aboutModalEl.className = 'modal-overlay'
    aboutModalEl.setAttribute('role', 'dialog')
    aboutModalEl.setAttribute('aria-modal', 'true')
    aboutModalEl.setAttribute('aria-labelledby', 'about-modal-title')
    
    aboutModalEl.innerHTML = `
        <div class="modal-content about-modal">
            <div class="about-modal-content">
                <div class="about-modal-graphic" role="presentation">
                    <img class="about-modal-logo" src="/img/polymorphic.png" alt="Polymorphic logo">
                </div>
                <div class="about-modal-details" tabindex="-1">
                    <div class="about-modal-title" id="about-modal-title">Polymorphic</div>
                    <div class="about-modal-tagline">Live Shader Coding Environment</div>
                    <div class="about-modal-copyright">&copy; 2026 <a href="https://noisefactor.io/" class="about-modal-link" target="_blank" rel="noopener">Noise Factor LLC.</a></div>
                    <div class="about-modal-build">build: local</div>
                </div>
            </div>
        </div>
    `
    
    // Close on backdrop click
    aboutModalEl.addEventListener('click', (e) => {
        if (e.target === aboutModalEl) closeAboutModal()
    })
    
    // Close on escape
    aboutModalEscHandler = (e) => {
        if (e.key === 'Escape') closeAboutModal()
    }
    document.addEventListener('keydown', aboutModalEscHandler)
    
    document.body.appendChild(aboutModalEl)
    
    // Animate in
    requestAnimationFrame(() => {
        aboutModalEl.classList.add('modal-visible')
    })
    
    // Fetch deployment metadata
    fetchDeploymentMetadata()
}

function closeAboutModal() {
    if (!aboutModalEl) return
    
    aboutModalEl.classList.remove('modal-visible')
    setTimeout(() => {
        aboutModalEl.remove()
        aboutModalEl = null
    }, 200)
    
    document.removeEventListener('keydown', aboutModalEscHandler)
}

async function fetchDeploymentMetadata() {
    if (!aboutModalEl) return
    
    const buildInfoEl = aboutModalEl.querySelector('.about-modal-build')
    if (!buildInfoEl) return
    
    try {
        const response = await fetch('./deployment-meta.json', { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        
        const data = await response.json()
        const hash = (data?.git_hash || '').trim().slice(0, 8) || 'LOCAL'
        const timestamp = data?.date
        
        let dateStr = 'n/a'
        if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
            const date = new Date(timestamp * 1000)
            if (!Number.isNaN(date.getTime())) {
                const pad = (v) => String(Math.trunc(v)).padStart(2, '0')
                dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
            }
        }
        
        buildInfoEl.textContent = `build: ${hash} / deployed: ${dateStr}`
    } catch (error) {
        buildInfoEl.textContent = 'build: local / deployed: n/a'
    }
}

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
    
    // Edit menu
    if (resetMenuItem) {
        resetMenuItem.addEventListener('click', resetDsl)
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
            openAboutModal()
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
