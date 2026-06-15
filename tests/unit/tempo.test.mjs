import { test } from 'node:test'
import assert from 'node:assert'
import { computeBarSeconds, DIVIDER_OPTIONS, tempoController } from '../../public/js/ui/tempo.js'

// The visible tempo UI + beat clock now live in the shared handfish <tempo-bar>
// (covered by handfish's own tests). These cover the pure helpers Polymorphic
// still owns and the tempo controller's source logic (which <tempo-bar> does
// not provide — it is the MIDI-follow / manual switch).

test('computeBarSeconds returns one bar (4 beats) of seconds at the given BPM', () => {
    // 120 BPM → 0.5s per beat → 2.0s per bar
    assert.strictEqual(computeBarSeconds(120), 2)
    // 60 BPM → 1s per beat → 4.0s per bar
    assert.strictEqual(computeBarSeconds(60), 4)
})

test('computeBarSeconds multiplies loop duration by the divider', () => {
    // /4 at 120 BPM → bar that's 4× longer (8.0s) → animation runs 4× slower
    assert.strictEqual(computeBarSeconds(120, 4), 8)
    assert.strictEqual(computeBarSeconds(120, 8), 16)
    assert.strictEqual(computeBarSeconds(120, 32), 64)
})

test('computeBarSeconds defaults divider to 1 (no slowdown)', () => {
    assert.strictEqual(computeBarSeconds(120), computeBarSeconds(120, 1))
})

test('DIVIDER_OPTIONS exposes the supported divisors in ascending order', () => {
    assert.deepStrictEqual(DIVIDER_OPTIONS, [1, 2, 4, 8, 16, 32])
})

// --- Tempo controller source logic -----------------------------------------
// The controller owns the manual↔midi source switch (and persistence). We can
// exercise that without a DOM by stubbing localStorage + a minimal scheduler.

function withLocalStorage(fn) {
    const store = new Map()
    const prev = globalThis.localStorage
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
    }
    try { return fn(store) } finally {
        if (prev === undefined) delete globalThis.localStorage
        else globalThis.localStorage = prev
    }
}

test('controller defaults to manual source and reports it', () => {
    withLocalStorage(() => {
        // A minimal scheduler stub: just enough for init() to wire onChange/onDividerChange.
        const scheduler = {
            bpm: 120, divider: 4,
            barSeconds: () => computeBarSeconds(120, 4),
            onChange() {}, onDividerChange() {},
        }
        const tempoBar = { scheduler }
        // No renderer → _applyToRenderer is a no-op; no MIDI is enabled for manual.
        tempoController.init({ tempoBar, renderer: null })
        assert.strictEqual(tempoController.getSource(), 'manual')
        assert.strictEqual(tempoController.getBpm(), 120)
        assert.strictEqual(tempoController.getDivider(), 4)
        assert.strictEqual(tempoController.barSeconds(), 8)
    })
})

test('toggleSource flips manual↔midi and persists the choice', () => {
    withLocalStorage((store) => {
        const scheduler = {
            bpm: 120, divider: 4,
            barSeconds: () => computeBarSeconds(120, 4),
            onChange() {}, onDividerChange() {},
        }
        tempoController.init({ tempoBar: { scheduler }, renderer: null })
        assert.strictEqual(tempoController.getSource(), 'manual')

        let lastSource = null
        tempoController.onSourceChange((s) => { lastSource = s })

        tempoController.toggleSource()
        assert.strictEqual(tempoController.getSource(), 'midi')
        assert.strictEqual(lastSource, 'midi')
        assert.strictEqual(store.get('polymorphic.bpm.source'), 'midi')

        tempoController.toggleSource()
        assert.strictEqual(tempoController.getSource(), 'manual')
        assert.strictEqual(store.get('polymorphic.bpm.source'), 'manual')
    })
})

test('tap is ignored in midi source (clock follows external)', () => {
    withLocalStorage(() => {
        let tapped = 0
        const scheduler = {
            bpm: 120, divider: 4,
            barSeconds: () => computeBarSeconds(120, 4),
            onChange() {}, onDividerChange() {},
        }
        const tempoBar = { scheduler, tap: () => { tapped++ } }
        tempoController.init({ tempoBar, renderer: null })

        tempoController.tap()                 // manual → forwards to the component
        assert.strictEqual(tapped, 1)

        tempoController.setSource('midi')
        tempoController.tap()                 // midi → ignored
        assert.strictEqual(tapped, 1)

        tempoController.setSource('manual')   // restore for any later tests
    })
})
