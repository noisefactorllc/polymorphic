import assert from 'node:assert/strict'
import { test } from 'node:test'
import { watchCameraReturn } from '../../public/js/ui/cameraReopen.js'

function deviceRegistry({ initial = [], listeners } = {}) {
    const state = { devices: initial, changes: 0 }
    const enumerateDevices = async () => state.devices
    const addDeviceChangeListener = handler => {
        listeners.push(handler)
        return () => {
            const index = listeners.indexOf(handler)
            if (index >= 0) listeners.splice(index, 1)
        }
    }
    const change = () => { state.changes++; for (const handler of [...listeners]) handler() }
    return { state, enumerateDevices, addDeviceChangeListener, change }
}

const camera = deviceId => ({ kind: 'videoinput', label: 'Sync Camera', deviceId })

// A setTimeout(0) probe fires after a short real wait; setImmediate would run
// before the timer phase.
const afterProbe = () => new Promise(resolve => setTimeout(resolve, 5))

test('a missing named camera is waited for and reopened when it appears', async () => {
    const listeners = []
    const registry = deviceRegistry({ listeners })
    const returns = []
    const watcher = watchCameraReturn({
        deviceId: 'sync-camera', probeDelayMs: 0,
        enumerateDevices: registry.enumerateDevices,
        addDeviceChangeListener: registry.addDeviceChangeListener,
        isCurrent: () => true,
        onReturn: () => returns.push('returned'),
    })
    assert.equal(watcher.active, true, 'the watch stays armed while the camera is missing')
    registry.state.devices = [camera('sync-camera')]
    registry.change()
    await afterProbe()
    assert.deepEqual(returns, ['returned'])
    assert.equal(watcher.active, false, 'the watch disarms once the camera returns')
    registry.change()
    await afterProbe()
    assert.deepEqual(returns, ['returned'], 'a settled watch does not fire again')
})

test('a named camera that is still listed reopens after one probe', async () => {
    const listeners = []
    const registry = deviceRegistry({ initial: [camera('sync-camera')], listeners })
    const returns = []
    const watcher = watchCameraReturn({
        deviceId: 'sync-camera', probeDelayMs: 0,
        enumerateDevices: registry.enumerateDevices,
        addDeviceChangeListener: registry.addDeviceChangeListener,
        isCurrent: () => true,
        onReturn: () => returns.push('returned'),
    })
    await afterProbe()
    assert.deepEqual(returns, ['returned'], 'an errored camera whose device is still listed reopens')
    assert.equal(watcher.active, false)
})

test('the system default reopens when any camera is enumerated', async () => {
    const listeners = []
    const registry = deviceRegistry({ listeners })
    const returns = []
    const watcher = watchCameraReturn({
        deviceId: null, probeDelayMs: 0,
        enumerateDevices: registry.enumerateDevices,
        addDeviceChangeListener: registry.addDeviceChangeListener,
        isCurrent: () => true,
        onReturn: () => returns.push('returned'),
    })
    await afterProbe()
    assert.deepEqual(returns, [], 'no camera means no reopen')
    registry.state.devices = [camera('other-camera')]
    registry.change()
    await afterProbe()
    assert.deepEqual(returns, ['returned'])
})

test('a superseded source never reopens and the watch disarms itself', async () => {
    const listeners = []
    const registry = deviceRegistry({ initial: [camera('sync-camera')], listeners })
    let current = true
    const returns = []
    const watcher = watchCameraReturn({
        deviceId: 'sync-camera', probeDelayMs: 0,
        enumerateDevices: registry.enumerateDevices,
        addDeviceChangeListener: registry.addDeviceChangeListener,
        isCurrent: () => current,
        onReturn: () => returns.push('returned'),
    })
    current = false
    await afterProbe()
    assert.deepEqual(returns, [])
    assert.equal(watcher.active, false, 'the watch disarms when the source generation moved on')
    registry.state.devices = [camera('sync-camera')]
    registry.change()
    await afterProbe()
    assert.deepEqual(returns, [])
})

test('stop cancels a pending probe and its listener', async () => {
    const listeners = []
    const registry = deviceRegistry({ listeners })
    const returns = []
    const watcher = watchCameraReturn({
        deviceId: 'sync-camera', probeDelayMs: 20,
        enumerateDevices: registry.enumerateDevices,
        addDeviceChangeListener: registry.addDeviceChangeListener,
        isCurrent: () => true,
        onReturn: () => returns.push('returned'),
    })
    assert.equal(listeners.length, 1)
    watcher.stop()
    assert.equal(watcher.active, false)
    assert.equal(listeners.length, 0, 'stop removes the devicechange listener')
    registry.state.devices = [camera('sync-camera')]
    registry.change()
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.deepEqual(returns, [], 'a cancelled watch never reopens')
})

test('an enumeration failure keeps the watch armed for the next device change', async () => {
    let failures = 0
    const listeners = []
    const enumerateDevices = async () => {
        if (failures > 0) { failures -= 1; throw new Error('enumerate failed') }
        return [camera('sync-camera')]
    }
    const addDeviceChangeListener = handler => { listeners.push(handler); return () => {} }
    const returns = []
    const watcher = watchCameraReturn({
        deviceId: 'sync-camera', probeDelayMs: 0,
        enumerateDevices, addDeviceChangeListener,
        isCurrent: () => true,
        onReturn: () => returns.push('returned'),
    })
    failures = 1
    await afterProbe()
    assert.deepEqual(returns, [], 'a failed enumeration is not a return')
    assert.equal(watcher.active, true)
    failures = 0
    listeners[0]()
    await afterProbe()
    assert.deepEqual(returns, ['returned'])
    watcher.stop()
})
