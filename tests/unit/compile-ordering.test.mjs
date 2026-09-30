import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../public/js/embed.js', import.meta.url), 'utf8')
function section(start, end) {
    return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
}
function deferred() {
    let resolve
    const promise = new Promise(r => { resolve = r })
    return { promise, resolve }
}
async function flush() {
    for (let i = 0; i < 30; i++) await Promise.resolve()
}
function harness() {
    const timers = []
    const compiles = []
    const published = []
    const editor = { value: 'old' }
    const state = { text: 'old', handlers: {}, fromDsl(text) { this.text = text },
        toDsl() { return this.text + ':parameter' }, on(event, fn) { this.handlers[event] = fn } }
    const context = vm.createContext({
        console, dslEditor: editor, renderer: { canvasRenderer: {}, applyImageDimensions() {}, compile(text) {
            const gate = deferred()
            compiles.push({ text, ...gate })
            return gate.promise
        } }, ProgramState: function () { return state }, programState: state,
        suppressDslReact: false, hotReloadTimeout: null, _compileInFlight: false,
        preloadFontsForDsl: async () => {}, refreshControlsPanelAfterDslChange() {},
        showCompilerError() {}, hideCompilerError() {}, outputPicker: { setDsl: async () => {} },
        restoreMediaUrls: (_before, after) => after, publishLocalDsl: s => published.push(s),
        setTimeout: fn => { timers.push(fn); return timers.length }, clearTimeout() {},
    })
    vm.runInContext([
        section('const REMOTE_COMPILE_DEBOUNCE_MS', 'function setupOnlineCollaboration()'),
        section('let shaderCompileQueue =', '/**\n * Build a runnable DSL'),
        section('function syncProgramStateFromDsl(', '/**\n * After a DSL change'),
        section('function setupProgramState()', '/**\n * Schedule a hot reload'),
    ].join('\n'), context)
    context.setupProgramState()
    context.syncProgramStateFromDsl('old')
    return { context, editor, state, timers, compiles, published }
}

test('a remote edit arriving during compilation is compiled after the running edit', async () => {
    const h = harness()
    const pending = h.context.applyCurrentDslFromOnline()
    const timer = h.timers.shift()()
    await flush()
    assert.equal(h.compiles[0].text, 'old')
    h.editor.value = 'new'
    h.context.applyCurrentDslFromOnline()
    h.compiles[0].resolve({ success: true })
    await flush()
    if (h.timers.length) {
        h.timers.shift()()
        await flush()
    }
    assert.deepEqual(h.compiles.map(c => c.text), ['old', 'new'])
    h.compiles[1].resolve({ success: true })
    await Promise.all([pending, timer])
    assert.equal(h.state.text, 'new')
})

test('a controls change cannot rewrite newer editor text from stale ProgramState', () => {
    const h = harness()
    h.editor.value = 'new remote draft'
    h.state.handlers.change()
    assert.equal(h.editor.value, 'new remote draft')
    assert.deepEqual(h.published, [])
})

test('a successful renderer result updates controls without replacing a newer editor draft', async () => {
    const h = harness()
    h.editor.value = 'first remote'
    const pending = h.context.recompileShader()
    await flush()
    h.editor.value = 'new remote draft'
    h.compiles[0].resolve({ success: true })
    await pending
    assert.equal(h.state.text, 'first remote')
    h.state.handlers.change()
    assert.equal(h.editor.value, 'new remote draft')
    assert.deepEqual(h.published, [])
})

test('remote and other compile callers cannot mutate the renderer concurrently', async () => {
    const h = harness()
    const old = h.context.recompileShader()
    await flush()
    h.editor.value = 'new'
    const next = h.context.recompileShader()
    await flush()
    assert.deepEqual(h.compiles.map(c => c.text), ['old'])
    h.compiles[0].resolve({ success: true })
    await flush()
    assert.deepEqual(h.compiles.map(c => c.text), ['old', 'new'])
    h.compiles[1].resolve({ success: true })
    await Promise.all([old, next])
    assert.equal(h.state.text, 'new')
})

test('controls can publish consecutive parameter edits for the current compiled draft', () => {
    const h = harness()
    h.state.handlers.change()
    assert.equal(h.editor.value, 'old:parameter')
    h.state.text = 'old:parameter'
    h.state.handlers.change()
    assert.equal(h.editor.value, 'old:parameter:parameter')
    assert.equal(h.published.length, 2)
})

test('a failed compile releases the queue so the next draft can recover', async () => {
    const h = harness()
    const old = h.context.recompileShader()
    await flush()
    h.compiles[0].resolve({ success: false, error: 'invalid program' })
    assert.equal((await old).success, false)
    h.editor.value = 'fixed'
    const next = h.context.recompileShader()
    await flush()
    h.compiles[1].resolve({ success: true })
    assert.equal((await next).success, true)
    assert.equal(h.state.text, 'fixed')
})

test('remote edits during a slow compile retain the debounce before the follow-up build', async () => {
    const h = harness()
    const pending = h.context.applyCurrentDslFromOnline()
    const timer = h.timers.shift()()
    await flush()
    h.editor.value = 'new'
    h.context.applyCurrentDslFromOnline()
    h.compiles[0].resolve({ success: true })
    await flush()
    assert.deepEqual(h.compiles.map(c => c.text), ['old'])
    assert.equal(h.timers.length, 1)
    h.editor.value = 'newest'
    h.context.applyCurrentDslFromOnline()
    h.timers.shift()()
    await flush()
    assert.deepEqual(h.compiles.map(c => c.text), ['old', 'newest'])
    h.compiles[1].resolve({ success: true })
    await Promise.all([pending, timer])
})

test('a failed newest draft retains controls for the last successful renderer without publishing it', async () => {
    const h = harness()
    h.editor.value = 'valid A'
    const first = h.context.recompileShader()
    await flush()
    h.editor.value = 'invalid B'
    const latest = h.context.recompileShader()
    h.compiles[0].resolve({ success: true })
    await flush()
    await first
    h.compiles[1].resolve({ success: false, error: 'invalid program' })
    await latest
    assert.equal(h.state.text, 'valid A')
    h.state.handlers.change()
    assert.equal(h.editor.value, 'invalid B')
    assert.deepEqual(h.published, [])
})
