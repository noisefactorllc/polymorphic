import assert from 'node:assert/strict'
import test from 'node:test'
import { Recorder, RECORDING_LIMITS, QUALITY_PRESETS, recorder } from '../../public/js/ui/recorder.js'

test('RECORDING_LIMITS exposes expected safety thresholds and is immutable', () => {
    assert.equal(RECORDING_LIMITS.CHUNK_INTERVAL_MS, 1000)
    assert.equal(RECORDING_LIMITS.WARNING_DURATION_MS, 10 * 60 * 1000)
    assert.equal(RECORDING_LIMITS.MAX_DURATION_MS, 15 * 60 * 1000)
    assert.equal(RECORDING_LIMITS.WARNING_RECORDED_BYTES, 750 * 1024 * 1024)
    assert.equal(RECORDING_LIMITS.MAX_RECORDED_BYTES, 1024 * 1024 * 1024)
    assert.ok(Object.isFrozen(RECORDING_LIMITS))
})

test('QUALITY_PRESETS exposes high, standard, and low configs and is immutable', () => {
    assert.ok(QUALITY_PRESETS.high)
    assert.ok(QUALITY_PRESETS.standard)
    assert.ok(QUALITY_PRESETS.low)
    assert.equal(QUALITY_PRESETS.standard.maxHeight, 720)
    assert.equal(QUALITY_PRESETS.standard.fps, 60)
    assert.equal(QUALITY_PRESETS.standard.videoBitsPerSecond, 8_000_000)
    assert.ok(Object.isFrozen(QUALITY_PRESETS))
})

test('Recorder initializes with standard defaults and default safety limits', () => {
    const rec = new Recorder()
    assert.equal(rec.qualityName, 'standard')
    assert.equal(rec.fps, 60)
    assert.equal(rec.videoBitsPerSecond, 8_000_000)
    assert.equal(rec.maxHeight, 720)
    assert.equal(rec.maxDurationMs, RECORDING_LIMITS.MAX_DURATION_MS)
    assert.equal(rec.warningDurationMs, RECORDING_LIMITS.WARNING_DURATION_MS)
    assert.equal(rec.maxRecordedBytes, RECORDING_LIMITS.MAX_RECORDED_BYTES)
    assert.equal(rec.warningRecordedBytes, RECORDING_LIMITS.WARNING_RECORDED_BYTES)
    assert.equal(rec.recordedBytes, 0)
    assert.equal(rec.isWarning, false)
    assert.equal(rec.isRecording(), false)
})

test('Recorder.setQualityPreset updates configuration', () => {
    const rec = new Recorder()
    rec.setQualityPreset('high')
    assert.equal(rec.qualityName, 'high')
    assert.equal(rec.maxHeight, 1080)
    assert.equal(rec.videoBitsPerSecond, 16_000_000)

    rec.setQualityPreset('low')
    assert.equal(rec.qualityName, 'low')
    assert.equal(rec.maxHeight, 480)
    assert.equal(rec.fps, 30)
})

test('Recorder.setQuality overrides specific parameters and switches to custom preset name', () => {
    const rec = new Recorder()
    rec.setQuality({ fps: 24, videoBitsPerSecond: 2_000_000, maxHeight: 360 })
    assert.equal(rec.qualityName, 'custom')
    assert.equal(rec.fps, 24)
    assert.equal(rec.videoBitsPerSecond, 2_000_000)
    assert.equal(rec.maxHeight, 360)
})

test('Recorder.init allows custom safety limits and preset configuration', () => {
    const rec = new Recorder()
    rec.init({
        quality: 'low',
        maxDurationMs: 60_000,
        warningDurationMs: 45_000,
        maxRecordedBytes: 50 * 1024 * 1024,
        warningRecordedBytes: 40 * 1024 * 1024
    })

    assert.equal(rec.qualityName, 'low')
    assert.equal(rec.maxDurationMs, 60_000)
    assert.equal(rec.warningDurationMs, 45_000)
    assert.equal(rec.maxRecordedBytes, 50 * 1024 * 1024)
    assert.equal(rec.warningRecordedBytes, 40 * 1024 * 1024)
})

test('Recorder.checkLimits returns ok when inactive or within bounds', () => {
    const rec = new Recorder()
    assert.equal(rec.checkLimits(100), 'ok')

    // Simulate active recording state
    rec._recording = true
    rec._startTime = 1000
    assert.equal(rec.checkLimits(1000), 'ok')
    assert.equal(rec.isWarning, false)
})

test('Recorder.checkLimits enters warning state when duration warning threshold is reached', () => {
    const rec = new Recorder()
    rec.init({
        warningDurationMs: 1000,
        maxDurationMs: 2000
    })
    rec._recording = true

    const status = rec.checkLimits(1200)
    assert.equal(status, 'warning')
    assert.equal(rec.isWarning, true)
    assert.equal(rec.isRecording(), true)
})

test('Recorder.checkLimits enters warning state when byte warning threshold is reached', () => {
    const rec = new Recorder()
    rec.init({
        warningRecordedBytes: 500,
        maxRecordedBytes: 1000
    })
    rec._recording = true
    rec._recordedBytes = 600

    const status = rec.checkLimits(100)
    assert.equal(status, 'warning')
    assert.equal(rec.isWarning, true)
    assert.equal(rec.isRecording(), true)
})

test('Recorder.checkLimits auto-stops with duration_limit when max duration is reached', () => {
    const rec = new Recorder()
    let lastState = null
    rec.init({
        maxDurationMs: 2000,
        warningDurationMs: 1000,
        onChange: (s) => { lastState = s }
    })
    rec._recording = true
    rec._startTime = 0

    const status = rec.checkLimits(2100)
    assert.equal(status, 'stopped')
    assert.equal(rec.isRecording(), false)
    assert.equal(rec.stopReason, 'duration_limit')
    assert.ok(lastState)
    assert.equal(lastState.recording, false)
    assert.equal(lastState.stoppedReason, 'duration_limit')
})

test('Recorder.checkLimits auto-stops with memory_limit when max byte size is reached', () => {
    const rec = new Recorder()
    let lastState = null
    rec.init({
        maxRecordedBytes: 1000,
        warningRecordedBytes: 500,
        onChange: (s) => { lastState = s }
    })
    rec._recording = true
    rec._startTime = 0
    rec._recordedBytes = 1200

    const status = rec.checkLimits(100)
    assert.equal(status, 'stopped')
    assert.equal(rec.isRecording(), false)
    assert.equal(rec.stopReason, 'memory_limit')
    assert.ok(lastState)
    assert.equal(lastState.recording, false)
    assert.equal(lastState.stoppedReason, 'memory_limit')
    assert.equal(lastState.bytes, 1200)
})

test('Recorder.stop passes manual reason and elapsed stats to onChange', () => {
    const rec = new Recorder()
    let lastState = null
    rec.init({
        onChange: (s) => { lastState = s }
    })
    rec._recording = true
    rec._startTime = 500
    rec._recordedBytes = 4096

    rec.stop()
    assert.equal(rec.isRecording(), false)
    assert.equal(rec.stopReason, 'manual')
    assert.ok(lastState)
    assert.equal(lastState.recording, false)
    assert.equal(lastState.stoppedReason, 'manual')
    assert.equal(lastState.bytes, 4096)
})

test('Default export recorder is an instance of Recorder', () => {
    assert.ok(recorder instanceof Recorder)
})

function controlledRecorder(t, limits = {}) {
    const downloads = []
    const states = []
    const instances = []
    const streams = []
    const urls = new Map()
    const frames = new Map()
    let frameId = 0
    let supportedMime = 'video/webm;codecs=vp9'
    const captureStream = () => {
        const track = { stops: 0, stop() { this.stops++ } }
        const stream = { track, getTracks: () => [track] }
        streams.push(stream)
        return stream
    }
    class ControlledMediaRecorder {
        static isTypeSupported(type) { return type === supportedMime }
        constructor(stream, options) {
            this.stream = stream
            this.mimeType = options.mimeType
            this.state = 'inactive'
            instances.push(this)
        }
        start() { this.state = 'recording' }
        stop() { this.state = 'inactive' }
        chunk(text) { this.ondataavailable({ data: new Blob([text]) }) }
        finish() { this.onstop() }
    }
    const element = tag => ({
        style: {},
        classList: { add() {}, remove() {} },
        remove() {},
        querySelector: () => ({ textContent: '' }),
        getContext: () => ({ drawImage() {} }),
        captureStream,
        click() {
            assert.equal(tag, 'a')
            downloads.push({ name: this.download, blob: urls.get(this.href) })
        }
    })
    const globals = {
        window: { MediaRecorder: ControlledMediaRecorder },
        MediaRecorder: ControlledMediaRecorder,
        document: { createElement: element, body: { appendChild() {} } },
        requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId },
        cancelAnimationFrame: id => frames.delete(id)
    }
    for (const [name, value] of Object.entries(globals)) {
        const original = Object.getOwnPropertyDescriptor(globalThis, name)
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
        t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name])
    }
    t.mock.method(URL, 'createObjectURL', blob => {
        const url = `blob:take-${urls.size}`
        urls.set(url, blob)
        return url
    })
    t.mock.method(URL, 'revokeObjectURL', url => urls.delete(url))
    const timers = []
    t.mock.method(globalThis, 'setTimeout', callback => { timers.push(callback); return timers.length })
    t.after(() => timers.forEach(callback => callback()))
    const rec = new Recorder()
    rec.init({
        canvas: { width: 1920, height: 1080, captureStream },
        onChange: state => states.push(state),
        ...limits
    })
    return { rec, downloads, states, instances, streams, frames,
        useMp4() { supportedMime = 'video/mp4'; rec.init() } }
}

test('Recorder keeps a late first take separate from the active second take, including MIME and capture resources', async t => {
    const { rec, downloads, states, instances, streams, frames, useMp4 } = controlledRecorder(t)
    assert.equal(rec.start(), true)
    const [first] = instances
    first.chunk('first-')
    rec.stop()
    assert.equal(rec.isRecording(), false)
    assert.equal(rec._indicator, null)
    assert.equal(streams[0].track.stops, 1)
    assert.equal(frames.size, 0)

    useMp4()
    assert.equal(rec.start(), true)
    const second = instances[1]
    second.chunk('second-')
    const indicator = rec._indicator
    const captureCanvas = rec._captureCanvas
    first.chunk('final')
    first.finish()
    assert.equal(downloads.length, 1)
    assert.equal(await downloads[0].blob.text(), 'first-final')
    assert.equal(downloads[0].blob.type, 'video/webm;codecs=vp9')
    assert.match(downloads[0].name, /\.webm$/)
    assert.equal(rec.isRecording(), true)
    assert.equal(rec.recordedBytes, 7)
    assert.equal(rec._indicator, indicator)
    assert.equal(rec._captureCanvas, captureCanvas)
    assert.equal(streams[1].track.stops, 0)
    assert.equal(frames.size, 2)

    rec.stop()
    second.chunk('final')
    second.finish()
    assert.equal(await downloads[1].blob.text(), 'second-final')
    assert.equal(downloads[1].blob.type, 'video/mp4')
    assert.match(downloads[1].name, /\.mp4$/)
    assert.equal(rec.recordedBytes, 12)
    assert.deepEqual(states.map(state => state.recording), [true, false, true, false])
    assert.equal(streams[1].track.stops, 1)
    assert.equal(frames.size, 0)
})

test('Recorder preserves both takes when the second download finishes before the first flush', async t => {
    const { rec, downloads, instances, useMp4 } = controlledRecorder(t)
    rec.start()
    instances[0].chunk('A-')
    rec.stop()
    useMp4()
    rec.start()
    instances[1].chunk('B-')
    rec.stop()
    instances[1].chunk('last')
    instances[1].finish()
    instances[0].chunk('last')
    instances[0].finish()
    assert.equal(downloads.length, 2)
    assert.deepEqual(await Promise.all(downloads.map(item => item.blob.text())), ['B-last', 'A-last'])
    assert.deepEqual(downloads.map(item => item.blob.type), ['video/mp4', 'video/webm;codecs=vp9'])
    assert.match(downloads[0].name, /\.mp4$/)
    assert.match(downloads[1].name, /\.webm$/)
    assert.equal(rec.recordedBytes, 6)
    assert.equal(rec.isRecording(), false)
})

test('Recorder excludes an old final chunk from the new take safety limits while preserving its own limits', async t => {
    const { rec, downloads, states, instances } = controlledRecorder(t, {
        warningRecordedBytes: 4, maxRecordedBytes: 8
    })
    rec.start()
    instances[0].chunk('aaa')
    rec.stop()
    rec.start()
    instances[1].chunk('b')
    instances[0].chunk('XXXXXXXX')
    instances[0].finish()
    assert.equal(rec.isRecording(), true)
    assert.equal(rec.recordedBytes, 1)
    assert.equal(rec.isWarning, false)
    assert.equal(rec.stopReason, null)
    assert.deepEqual(states.map(state => state.recording), [true, false, true])
    assert.equal(await downloads[0].blob.text(), 'aaaXXXXXXXX')

    instances[1].chunk('ccc')
    assert.equal(rec.isWarning, true)
    instances[1].chunk('dddd')
    assert.equal(rec.isRecording(), false)
    assert.equal(rec.stopReason, 'memory_limit')
    assert.equal(states.at(-1).bytes, 8)
    instances[1].finish()
    assert.equal(await downloads[1].blob.text(), 'bcccdddd')
})
