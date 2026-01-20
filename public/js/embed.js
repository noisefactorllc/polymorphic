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
const codeToggle = document.getElementById('code-toggle')
const docToggle = document.getElementById('doc-toggle')
const shareBtn = document.getElementById('share-btn')
const resetBtn = document.getElementById('reset-btn')
const fullscreenBtn = document.getElementById('fullscreen-btn')
const playPauseBtn = document.getElementById('play-pause-btn')
const compilerErrorEl = document.getElementById('compiler-error')
const docReaderClose = document.querySelector('.doc-reader-close')

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
const DEFAULT_DSL = `search synth

noise().write(o0)`

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
    if (!renderer || !playPauseBtn) return
    
    isPlaying = !isPlaying
    
    if (isPlaying) {
        renderer.start()
        playPauseBtn.textContent = '⏸' // Pause symbol
        canvas.classList.remove('paused')
    } else {
        renderer.stop()
        playPauseBtn.textContent = '▶' // Play symbol
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
    if (!fullscreenBtn) return
    fullscreenBtn.textContent = document.fullscreenElement ? '⛶' : '⛶'
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
    
    // Show the code toggle button once canvas is visible
    if (codeToggle) {
        codeToggle.classList.add('visible')
    }
    
    // Show share button
    if (shareBtn) {
        shareBtn.classList.add('visible')
    }
    
    // Show doc toggle button
    if (docToggle) {
        docToggle.classList.add('visible')
    }
    
    // Show fullscreen button
    if (fullscreenBtn) {
        fullscreenBtn.classList.add('visible')
    }
    
    // Show play/pause button
    if (playPauseBtn) {
        playPauseBtn.classList.add('visible')
    }
    
    // Show DSL editor by default
    if (codeToggle) {
        codeToggle.classList.add('active')
    }
    if (dslEditor) {
        dslEditor.focus()
    }
    
    isPlaying = true
}

/**
 * Update reset button visibility based on whether DSL has been modified
 */
function updateResetButtonVisibility() {
    if (!resetBtn || !dslEditor) return
    const isDirty = dslEditor.value !== originalDsl
    if (isDirty) {
        resetBtn.classList.add('visible')
    } else {
        resetBtn.classList.remove('visible')
    }
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
    if (codeToggle) {
        codeToggle.classList.toggle('active', isHidden)
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
 * Resize canvas to fill viewport
 * Uses 50% pixel density for resolutions > 1920x1080 (either axis)
 */
function resizeCanvas() {
    const baseDpr = window.devicePixelRatio || 1
    const width = window.innerWidth
    const height = window.innerHeight
    
    // Check if rendered size would exceed HD (either axis > 1920x1080)
    const renderedWidth = width * baseDpr
    const renderedHeight = height * baseDpr
    const isHighRes = renderedWidth > 1920 || renderedHeight > 1080
    const dpr = isHighRes ? baseDpr * 0.5 : baseDpr
    
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    
    return { width: canvas.width, height: canvas.height }
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
    if (docToggle) {
        docToggle.classList.add('active')
    }
    
    // Set up code toggle button
    if (codeToggle) {
        codeToggle.addEventListener('click', toggleDslOverlay)
    }
    
    // Set up share button
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const dsl = dslEditor?.value || ''
            shareModal.open({ dsl, canvas })
        })
    }
    
    // Set up doc toggle button
    if (docToggle) {
        docToggle.addEventListener('click', () => {
            const isVisible = toggleDocReader()
            docToggle.classList.toggle('active', isVisible)
        })
    }
    
    // Set up doc reader close button
    if (docReaderClose) {
        docReaderClose.addEventListener('click', () => {
            hideDocReader()
            if (docToggle) {
                docToggle.classList.remove('active')
            }
        })
    }
    
    // Set up reset button
    if (resetBtn) {
        resetBtn.addEventListener('click', resetDsl)
    }
    
    // Set up play/pause button
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', togglePlayPause)
    }
    
    // Set up fullscreen button
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', toggleFullscreen)
        // Listen for fullscreen changes to update button state
        document.addEventListener('fullscreenchange', () => {
            updateFullscreenButton()
            // Trigger resize to handle adaptive pixel density
            if (renderer) {
                const { width, height } = resizeCanvas()
                renderer.resize(width, height)
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
