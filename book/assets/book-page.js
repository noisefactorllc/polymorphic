/**
 * A reading page of The Book of Polymorphic DSL.
 *
 * The canvas, renderer, editor chrome and hot-reload contract are Polymorphic's
 * own modules, imported from the parent app rather than reimplemented, so a
 * page cannot drift from the environment it is teaching. What this file adds is
 * the reading furniture: page-to-page navigation, a program sized to its own
 * line count, and a tear-off link that stays in step with whatever is currently
 * in the editor.
 */

import { dslTokenizer, CodeEditor } from 'handfish'
import { PolymorphicRenderer } from '/js/noisemaker/renderer.js'
import { ProgramState, getEffect } from '/js/noisemaker/bundle.js'
import { preloadFontsForDsl } from '/js/fontLoader.js'
import { restoreMediaUrls } from '/js/noisemaker/dslSanitize.js'
import { getEffectCallSites } from '/js/ui/effectClickResolver.js'
import '/js/ui/codeEditor.js' // injects Polymorphic's editor styling; registers nothing
import '/js/ui/effectControls.js' // registers <effect-controls>

// Referenced so bundlers and linters see the import as used. Importing the
// class is what registers <code-editor>.
void CodeEditor

const page = JSON.parse(document.getElementById('book-page-data').textContent)

const canvas = document.getElementById('canvas')
const boot = document.getElementById('boot')
const editor = document.getElementById('dsl-editor')
const errorEl = document.getElementById('compile-error')
const tearLink = document.getElementById('tear-off')
const controlsHost = document.getElementById('effect-controls-host')

const HOT_RELOAD_MS = 400

let renderer = null
let programState = null
let controlsPanel = null
let hotReloadTimer = null
let compileInFlight = false
// Set while the page is writing the editor itself, so a programmatic write
// does not read back as a reader's keystroke and start a second round.
let suppressDslReact = false
let resizeRaf = 0

/* ------------------------------------------------------------------ *
 * Canvas
 * ------------------------------------------------------------------ */

/**
 * Match the drawing buffer to the viewport, halving device pixel ratio past HD
 * so a 5K display does not ask the GPU for a 5K buffer on every page. Same
 * rule Polymorphic applies (embed.js resizeCanvas).
 */
function resizeCanvas() {
    const baseDpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth || window.innerWidth
    const cssHeight = canvas.clientHeight || window.innerHeight
    const isHighRes = cssWidth * baseDpr > 1920 || cssHeight * baseDpr > 1080
    const dpr = isHighRes ? baseDpr * 0.5 : baseDpr
    canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
    canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
    return { width: canvas.width, height: canvas.height }
}

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

/**
 * Give the editor exactly the height its program needs. A one-line program in
 * a twelve-line box looks like a mistake, and a long program that scrolls on
 * arrival hides the very thing the page is about. CSS caps the result so a
 * long program can never crowd out the writing.
 */
function sizeEditorToProgram() {
    const lines = (editor.value || '').split('\n').length
    const lineHeight = 1.6
    const chrome = 1.25
    editor.style.setProperty('--book-editor-height', `${(lines * lineHeight + chrome).toFixed(2)}em`)
    publishProgramBottom()
}

/**
 * Tell the plate where the program ends, so the two fixed blocks divide the
 * viewport between them instead of guessing at each other's height. A short
 * program leaves the writing more room; a long one leaves it less.
 *
 * Measured after a frame, because the editor has just been resized and the new
 * height is not in the layout yet.
 */
function publishProgramBottom() {
    requestAnimationFrame(() => {
        const block = document.querySelector('.book-program')
        if (!block) return
        const bottom = Math.round(block.getBoundingClientRect().bottom)
        document.documentElement.style.setProperty('--book-program-bottom', `${bottom}px`)
    })
}

function showError(message) {
    errorEl.textContent = message
    errorEl.classList.add('visible')
}

function clearError() {
    errorEl.textContent = ''
    errorEl.classList.remove('visible')
}

/** Keep tear-off pointing at whatever is in the editor right now. */
function syncTearOff() {
    const dsl = editor.value || page.program
    tearLink.href = `${page.polymorphic}?dsl=${encodeURIComponent(dsl)}`
}

async function compile() {
    if (!renderer) return
    const dsl = editor.value
    if (!dsl.trim()) {
        showError('Empty program')
        return
    }
    compileInFlight = true
    try {
        await preloadFontsForDsl(dsl)
        const result = await renderer.compile(dsl)
        if (result.success) {
            clearError()
            syncProgramState(dsl)
            syncControls(dsl)
        } else {
            showError(result.error)
        }
    } catch (err) {
        showError(err?.message || String(err))
    } finally {
        compileInFlight = false
    }
}

/**
 * Push the compiled program's per-step parameter state into the pipeline.
 *
 * Required after every compile, not optional bookkeeping. Without it a pass
 * that samples more than one texture never gets its inputs bound: `filter/text`
 * rendered a flat black frame because both its `inputTex` and its `textTex`
 * read an unbound default, even though the graph, the texture registry, the
 * sampler units and every global uniform were identical to a working host's.
 * Polymorphic, Noisedeck and the Noisemaker demo UI all do this; the book was
 * the only host that did not.
 */
function syncProgramState(dsl) {
    if (!programState) return
    suppressDslReact = true
    try {
        programState.fromDsl(dsl)
    } catch (err) {
        console.warn('[book] programState.fromDsl failed:', err)
    } finally {
        suppressDslReact = false
    }
}

/**
 * Close the loop between the panel and the program text.
 *
 * Moving a control writes through ProgramState, which updates the running
 * pipeline directly, so the picture changes without a recompile and feedback
 * surfaces and particle state survive. The program shown on the page has to
 * follow, or the reader is looking at source that no longer describes what is
 * on screen, and tearing off into Polymorphic would carry the wrong thing.
 *
 * Same wiring as Polymorphic's setupProgramState, including the media-url
 * restore: toDsl() regenerates from the engine's stripped DSL and would drop
 * the url out of a `media()` call the reader had typed.
 */
function wireProgramStateToEditor() {
    programState.on('change', () => {
        if (suppressDslReact) return
        let regenerated
        try {
            regenerated = programState.toDsl()
        } catch (err) {
            console.warn('[book] programState.toDsl failed:', err)
            return
        }
        if (!regenerated) return
        const next = restoreMediaUrls(editor.value, regenerated)
        if (next === editor.value) return
        suppressDslReact = true
        try {
            editor.value = next
            if (renderer?.canvasRenderer) renderer.canvasRenderer.currentDsl = regenerated
            sizeEditorToProgram()
            syncTearOff()
        } finally {
            suppressDslReact = false
        }
    })

    // Parameters that change the shader itself cannot be pushed as a uniform.
    // ProgramState says so, and the answer is a recompile now rather than on
    // the hot-reload timer.
    programState.on('recompileNeeded', () => {
        if (suppressDslReact) return
        clearTimeout(hotReloadTimer)
        hotReloadTimer = null
        compile()
    })
}

/* ------------------------------------------------------------------ *
 * Parameter controls
 * ------------------------------------------------------------------ */

/**
 * Polymorphic opens its <effect-controls> panel when you click an effect name
 * in a program. A book page is about one effect, so the book opens the same
 * panel on that effect and leaves it open.
 *
 * Every piece of this is Polymorphic's: the element, the call-site resolver,
 * the engine's own effect definitions, and the ProgramState the panel writes
 * through. What the book adds is picking the call site instead of waiting for
 * a click.
 */

/**
 * Effects can be registered under `namespace/name`, `namespace.name` or bare
 * `name` depending on how they were loaded, so try each form. Same lookup
 * Polymorphic does before it opens the panel (embed.js lookupEffectDef).
 */
function lookupEffectDef(effectInfo) {
    if (!effectInfo) return null
    const keys = []
    if (effectInfo.fullName) {
        keys.push(effectInfo.fullName, effectInfo.fullName.replace('/', '.'), effectInfo.fullName.replace('.', '/'))
    }
    if (effectInfo.namespace && effectInfo.name) {
        keys.push(`${effectInfo.namespace}/${effectInfo.name}`, `${effectInfo.namespace}.${effectInfo.name}`)
    }
    if (effectInfo.name) keys.push(effectInfo.name)
    for (const key of keys) {
        const def = getEffect(key)
        if (def) return def
    }
    return null
}

/**
 * The call site for the effect this page is about. A program can name it more
 * than once, and can name other effects around it; the last call to this
 * page's own function is the one the page is demonstrating.
 */
function pageCallSite(dsl) {
    const sites = getEffectCallSites(dsl)
    for (let i = sites.length - 1; i >= 0; i--) {
        if (sites[i].name === page.func) return sites[i]
    }
    return null
}

function ensureControlsPanel() {
    if (controlsPanel || !controlsHost) return controlsPanel
    controlsPanel = document.createElement('effect-controls')
    controlsPanel.programState = programState
    // Closing is the widget's own behaviour, kept rather than suppressed: a
    // reader who wants the picture unobstructed can put the panel away.
    controlsPanel.addEventListener('panelclose', () => {
        controlsPanel.hide()
        controlsHost.classList.remove('open')
    })
    controlsHost.appendChild(controlsPanel)
    return controlsPanel
}

/**
 * Point the panel at the current program. Runs after every compile, because
 * editing the program moves the call site and can change which parameters
 * exist.
 */
function syncControls(dsl) {
    const panel = ensureControlsPanel()
    if (!panel) return
    const site = pageCallSite(dsl)
    const def = site ? lookupEffectDef(site.effect) : null
    if (!site || !def) {
        // The reader has edited the effect out of the program. Nothing to
        // show, and an empty panel is worse than no panel.
        panel.hide()
        controlsHost.classList.remove('open')
        return
    }
    panel.enums = renderer?.canvasRenderer?.enums || {}
    panel.show({ effectInfo: site.effect, effectDef: def })
    controlsHost.classList.add('open')
}

function scheduleHotReload() {
    clearTimeout(hotReloadTimer)
    hotReloadTimer = setTimeout(() => {
        hotReloadTimer = null
        compile()
    }, HOT_RELOAD_MS)
}

/* ------------------------------------------------------------------ *
 * Reading navigation
 * ------------------------------------------------------------------ */

/**
 * Arrow keys turn pages, Escape returns to the contents. Suppressed whenever
 * the caret is in the editor, where the same keys mean what they always mean.
 */
function isEditing() {
    const el = document.activeElement
    if (!el || el === document.body) return false
    const tag = (el.tagName || '').toUpperCase()
    if (tag === 'TEXTAREA' || tag === 'INPUT') return true
    if (el.isContentEditable) return true
    return typeof el.closest === 'function' && Boolean(el.closest('code-editor'))
}

function installKeyboardNav() {
    document.addEventListener('keydown', (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        if (isEditing()) return
        if (e.key === 'ArrowLeft' && page.nav.prev) {
            window.location.href = page.nav.prev
        } else if (e.key === 'ArrowRight' && page.nav.next) {
            window.location.href = page.nav.next
        } else if (e.key === 'Escape') {
            window.location.href = page.nav.index
        }
    })
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function main() {
    editor.setTokenizer?.(dslTokenizer)
    editor.value = page.program
    sizeEditorToProgram()
    syncTearOff()
    installKeyboardNav()

    const { width, height } = resizeCanvas()
    renderer = new PolymorphicRenderer(canvas, {
        width,
        height,
        loopDuration: 10,
        onError: (err) => console.error('Render error:', err),
    })

    editor.addEventListener('input', () => {
        if (suppressDslReact) return
        sizeEditorToProgram()
        syncTearOff()
        scheduleHotReload()
    })

    // Cmd/Ctrl+Enter in the editor. Dropped while a compile is running rather
    // than queued, so the GL state never flips mid-compile.
    editor.addEventListener('forcerecompile', () => {
        if (compileInFlight) return
        clearTimeout(hotReloadTimer)
        hotReloadTimer = null
        compile()
    })

    try {
        await preloadFontsForDsl(page.program)
        // preloadFontsForDsl only waits on the fonts a program names
        // explicitly, so a `text()` left at its default font falls through it.
        // The host rasterizes text to an offscreen canvas during compile, and a
        // face that has not arrived yet rasterizes to nothing. Polymorphic
        // never trips over that because its boot builds a dozen panels first; a
        // book page compiles immediately. This closes that race.
        await document.fonts.ready
        await renderer.init()

        // The engine's per-step parameter state, wired to this renderer. See
        // syncProgramState: the pipeline needs it to bind multi-texture passes.
        programState = new ProgramState({ renderer: renderer.canvasRenderer })
        wireProgramStateToEditor()

        const result = await renderer.compile(page.program)
        if (result.success) {
            syncProgramState(page.program)
            syncControls(page.program)
        } else {
            showError(result.error)
        }
        boot.hidden = true
        canvas.classList.add('visible')
        renderer.start()

        // Debug surface, mirroring Polymorphic's window.__poly. The browser
        // suite reaches in to check renderer state, and it is useful from the
        // console when a page renders something unexpected.
        window.__book = { page, renderer, programState, compile, get controls() { return controlsPanel } }

        document.body.dataset.bookReady = 'true'
    } catch (err) {
        console.error('Book page failed to start:', err)
        boot.hidden = true
        showError(`Failed to start: ${err?.message || err}`)
        document.body.dataset.bookReady = 'error'
        return
    }

    window.addEventListener('resize', () => {
        if (resizeRaf) return
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0
            const size = resizeCanvas()
            renderer.resize(size.width, size.height)
            publishProgramBottom()
        })
    })

    // `pagehide` rather than `beforeunload`: it is the reliable teardown signal
    // on iOS Safari. The `persisted` flag means the page is only being frozen
    // for the bfcache, where disposing the context would leave a dead canvas.
    window.addEventListener('pagehide', (e) => {
        if (e.persisted) return
        renderer.dispose()
    })
}

main()
