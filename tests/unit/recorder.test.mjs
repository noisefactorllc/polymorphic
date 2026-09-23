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
