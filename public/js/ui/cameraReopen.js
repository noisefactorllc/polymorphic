// A camera whose track ended must not stay dead until the user reselects it.
// The Sync platform's render path retires a camera whose device leaves the
// list or that reports an error, and reopens it when the device is enumerated
// again. This watcher is the browser equivalent for the live-inputs webcam
// source: one probe after a short delay (the platform re-runs its selection
// every half second), then event-driven probes on devicechange.
export function watchCameraReturn({
    deviceId,
    probeDelayMs = 500,
    enumerateDevices = () => navigator.mediaDevices?.enumerateDevices?.() ?? Promise.resolve([]),
    addDeviceChangeListener = (handler) => {
        navigator.mediaDevices?.addEventListener?.('devicechange', handler)
        return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler)
    },
    isCurrent = () => true,
    onReturn = () => {},
} = {}) {
    let stopped = false
    let removeListener = null
    let timer = null
    const cleanup = () => {
        if (timer) { clearTimeout(timer); timer = null }
        if (removeListener) {
            const remove = removeListener
            removeListener = null
            remove()
        }
    }
    const cameraListed = async () => {
        const devices = await Promise.resolve()
            .then(enumerateDevices)
            .catch(() => [])
        const cameras = devices.filter(device => device?.kind === 'videoinput')
        if (deviceId) return cameras.some(device => device.deviceId === deviceId)
        return cameras.length > 0
    }
    const probe = async () => {
        timer = null
        if (stopped || !isCurrent()) { cleanup(); return }
        if (await cameraListed()) {
            cleanup()
            if (isCurrent()) onReturn()
        }
    }
    removeListener = addDeviceChangeListener(() => {
        if (stopped || timer) return
        timer = setTimeout(() => { void probe() }, probeDelayMs)
    })
    timer = setTimeout(() => { void probe() }, probeDelayMs)
    return {
        get active() { return !stopped && (timer !== null || removeListener !== null) },
        stop() {
            stopped = true
            cleanup()
        },
    }
}
