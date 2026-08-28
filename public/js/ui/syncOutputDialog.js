const PROVIDER_NAMES = Object.freeze({
    syphon: 'Syphon',
    spout: 'Spout',
    ndi: 'NDI'
})

const RECOVERY_MESSAGES = Object.freeze({
    SYNC_PERMISSION_REQUIRED: 'Loopback access is required. Choose Connect Sync so the browser can request it.',
    SYNC_PERMISSION_DENIED: 'Loopback access was denied. Allow it for this site and try again.',
    SYNC_UNAVAILABLE: 'The Sync companion did not respond. Open Sync on this device and check again.',
    SYNC_PAIRING_DENIED: 'Pairing was denied in Sync. Connect again when you are ready to approve this origin.',
    SYNC_PAIRING_BUSY: 'Sync is handling another pairing request. Wait for it to finish and connect again.',
    SYNC_PAIRING_STORE: 'Sync could not save this pairing. Check its storage access and connect again.',
    SYNC_PAIRING_DURABILITY: 'Sync could not confirm durable pairing storage. Resolve its storage warning and connect again.',
    SYNC_PAIRING_ORIGIN_LIMIT: 'Sync has reached its paired-origin limit. Revoke an old origin and connect again.',
    SYNC_TIMEOUT: 'Sync did not respond in time. Check the companion and try again.',
    SYNC_PROVIDER_UNAVAILABLE: 'Sync has no available output provider. Enable Syphon, Spout, or NDI and reconnect.',
    SYNC_RENDERER_UNAVAILABLE: 'The active Noisemaker renderer does not expose the Sync output seam.',
    SYNC_EXPORT_UNAVAILABLE: 'The active graphics backend cannot export frames for Sync.',
    SYNC_AUTHENTICATION: 'Sync rejected this pairing. Connect again to pair this origin.',
    SYNC_RECOVERY_EXHAUSTED: 'Sync could not recover the output after three attempts. Reconnect and start again.',
    SYNC_SENDER_CLOSED: 'The Sync sender closed unexpectedly. Reconnect to create a new sender.',
    SYNC_RENDERER_REPLACED: 'The graphics backend or context changed. Reconnect before restarting the sender.',
    SYNC_STOP_TIMEOUT: 'The Sync sender did not close in time. Reconnect before starting another output.',
    SYNC_INVALID_SENDER_NAME: 'Use an output name with 1–64 UTF-8 bytes and no control or formatting characters.'
})

const STATE_PRESENTATION = Object.freeze({
    idle: Object.freeze({ tone: 'neutral', stateLabel: 'Disconnected', action: 'check' }),
    checking: Object.freeze({ tone: 'accent', stateLabel: 'Checking…', action: 'checking' }),
    unavailable: Object.freeze({ tone: 'neutral', stateLabel: 'Disconnected', action: 'check' }),
    starting: Object.freeze({ tone: 'accent', stateLabel: 'Starting…', action: 'starting' }),
    sending: Object.freeze({ tone: 'live', stateLabel: 'Sending', action: 'stop' }),
    recovering: Object.freeze({ tone: 'accent', stateLabel: 'Recovering…', action: 'stop' }),
    stopping: Object.freeze({ tone: 'accent', stateLabel: 'Stopping…', action: 'stopping' })
})

const ACTION_LABELS = Object.freeze({
    check: 'Check again',
    connect: 'Connect Sync',
    connecting: 'Connecting…',
    start: 'Start sending',
    starting: 'Starting…',
    stop: 'Stop sending',
    stopping: 'Stopping…',
    checking: 'Checking…'
})

const BUSY_ACTIONS = new Set(['checking', 'starting', 'stopping'])

export function providerDisplayNames(providerIds) {
    if (!Array.isArray(providerIds)) return []
    return providerIds.map(id => PROVIDER_NAMES[id] || id)
}

function finiteCounter(value) {
    return Number.isFinite(value) && value >= 0 ? value : 0
}

function presentationForState(state) {
    if (state.status === 'unavailable' && state.error?.code !== 'SYNC_UNAVAILABLE') {
        return { tone: 'neutral', stateLabel: 'Needs attention', action: 'connect' }
    }
    if (state.status === 'ready') {
        return state.connected
            ? { tone: 'accent', stateLabel: 'Connected', action: 'start' }
            : { tone: 'accent', stateLabel: 'Ready', action: 'connect' }
    }
    if (state.status === 'error') {
        const absent = state.error?.code === 'SYNC_UNAVAILABLE'
        return {
            tone: 'neutral',
            stateLabel: 'Needs attention',
            action: state.connected ? 'start' : (absent ? 'check' : 'connect')
        }
    }
    return STATE_PRESENTATION[state.status] || STATE_PRESENTATION.idle
}

export function deriveSyncOutputView(state = {}, {
    policy = { status: 'unknown', feature: null }
} = {}) {
    const blocked = policy?.status === 'blocked'
    const presentation = presentationForState(state)
    const recovering = state.status === 'recovering'
    const policyBlocked = blocked && !recovering
    const actionKind = policyBlocked ? 'connect' : presentation.action
    const stats = state.stats || {}
    const recovery = policyBlocked
        ? 'This page was not delegated loopback network access. The host must allow loopback-network before Sync can connect.'
        : (RECOVERY_MESSAGES[state.error?.code] || (state.error
            ? 'Sync could not continue. Check the companion and try again.'
            : 'Sync is not connected.'))

    return Object.freeze({
        tone: presentation.tone,
        stateLabel: presentation.stateLabel,
        providerIds: Array.isArray(state.providerIds)
            ? state.providerIds.filter(id => typeof id === 'string' && id.length > 0)
            : [],
        width: Number.isSafeInteger(state.width) && state.width > 0 ? state.width : null,
        height: Number.isSafeInteger(state.height) && state.height > 0 ? state.height : null,
        fps: Number.isFinite(state.fps) && state.fps > 0 ? state.fps : 60,
        live: state.status === 'sending',
        nameDisabled: state.status === 'sending' || recovering || BUSY_ACTIONS.has(presentation.action),
        policyBlocked,
        recovery,
        action: Object.freeze({
            kind: actionKind,
            label: ACTION_LABELS[actionKind],
            disabled: policyBlocked || BUSY_ACTIONS.has(actionKind)
        }),
        counters: Object.freeze({
            sent: finiteCounter(stats.sent),
            gpuBusy: finiteCounter(stats.droppedBusy),
            network: finiteCounter(stats.droppedBackpressure),
            failed: finiteCounter(stats.failed)
        })
    })
}

export async function runSyncOutputAction(kind, {
    controller,
    name = '',
    policyBlocked = false,
    onConnectIntent = () => {},
    afterPaint = () => Promise.resolve()
} = {}) {
    if (policyBlocked) return undefined
    switch (kind) {
    case 'check':
        return controller.checkAvailability()
    case 'connect':
        onConnectIntent()
        await afterPaint()
        return controller.connect()
    case 'start':
        return controller.start(name)
    case 'stop':
        return controller.stop()
    default:
        return undefined
    }
}

function policyObjects({ permissionsPolicy, featurePolicy }) {
    return [permissionsPolicy, featurePolicy].filter((value, index, values) => (
        value && values.indexOf(value) === index
    ))
}

function supportsFeature(policy, feature) {
    if (typeof policy?.features !== 'function') return false
    const features = policy.features()
    return Array.isArray(features) && features.includes(feature)
}

export function detectLoopbackPolicy({
    isEmbedded = false,
    permissionsPolicy = null,
    featurePolicy = null
} = {}) {
    if (!isEmbedded) return Object.freeze({ status: 'allowed', feature: null })
    try {
        const policies = policyObjects({ permissionsPolicy, featurePolicy })
        for (const feature of ['loopback-network', 'local-network-access']) {
            for (const policy of policies) {
                if (!supportsFeature(policy, feature)) continue
                if (typeof policy.allowsFeature !== 'function') {
                    return Object.freeze({ status: 'unknown', feature: null })
                }
                return Object.freeze({
                    status: policy.allowsFeature(feature) ? 'allowed' : 'blocked',
                    feature
                })
            }
        }
    } catch {
        // Permissions Policy remains experimental. Inspection failure is not denial.
    }
    return Object.freeze({ status: 'unknown', feature: null })
}

function detectDocumentLoopbackPolicy(windowObject, documentObject) {
    let isEmbedded
    try {
        isEmbedded = windowObject.top !== windowObject.self
    } catch {
        isEmbedded = true
    }
    return detectLoopbackPolicy({
        isEmbedded,
        permissionsPolicy: documentObject.permissionsPolicy,
        featurePolicy: documentObject.featurePolicy
    })
}

function requireElement(documentObject, id) {
    const element = documentObject.getElementById(id)
    if (!element) throw new Error(`Sync output dialog is missing #${id}`)
    return element
}

function afterBrowserPaint(windowObject) {
    return new Promise(resolve => {
        windowObject.requestAnimationFrame(() => windowObject.requestAnimationFrame(resolve))
    })
}

function shouldCheckOnOpen(state) {
    return state?.status === 'idle' || state?.status === 'unavailable' ||
        (state?.status === 'error' && state?.error?.code === 'SYNC_UNAVAILABLE')
}

export function createSyncOutputDialog({
    controller,
    document: documentObject = globalThis.document,
    window: windowObject = globalThis.window,
    afterPaint = () => afterBrowserPaint(windowObject),
    getPolicy = () => detectDocumentLoopbackPolicy(windowObject, documentObject)
} = {}) {
    if (!controller || typeof controller.subscribe !== 'function') {
        throw new TypeError('controller must expose subscribe(listener)')
    }
    if (!documentObject || !windowObject) {
        throw new TypeError('Sync output dialog requires a browser document and window')
    }

    const dialog = requireElement(documentObject, 'syncOutputDialog')
    const closeButton = requireElement(documentObject, 'syncOutputCloseBtn')
    const nameInput = requireElement(documentObject, 'syncOutputName')
    const stateText = requireElement(documentObject, 'syncOutputStateText')
    const liveBadge = requireElement(documentObject, 'syncOutputLiveBadge')
    const providerText = requireElement(documentObject, 'syncOutputProvider')
    const formatText = requireElement(documentObject, 'syncOutputFormat')
    const sentText = requireElement(documentObject, 'syncOutputSent')
    const gpuBusyText = requireElement(documentObject, 'syncOutputGpuBusy')
    const networkText = requireElement(documentObject, 'syncOutputNetwork')
    const failedText = requireElement(documentObject, 'syncOutputFailed')
    const recoveryText = requireElement(documentObject, 'syncOutputRecovery')
    const connectNotice = requireElement(documentObject, 'syncOutputConnectNotice')
    const actionButton = requireElement(documentObject, 'syncOutputAction')

    let state = controller.state || {}
    let policy = Object.freeze({ status: 'unknown', feature: null })
    let connectNoticeVisible = false
    let pendingAction = null
    let destroyed = false

    const render = () => {
        const view = deriveSyncOutputView(state, { policy })
        const action = pendingAction === 'connect'
            ? { kind: 'connecting', label: ACTION_LABELS.connecting, disabled: true }
            : view.action
        dialog.dataset.tone = view.tone
        stateText.textContent = view.stateLabel
        liveBadge.hidden = !view.live
        const providerNames = providerDisplayNames(view.providerIds)
        providerText.textContent = providerNames.length > 0 ? providerNames.join(', ') : 'No provider'
        formatText.textContent = view.width && view.height
            ? `${view.width}×${view.height} · ${view.fps}`
            : `—×— · ${view.fps}`
        sentText.textContent = String(view.counters.sent)
        gpuBusyText.textContent = String(view.counters.gpuBusy)
        networkText.textContent = String(view.counters.network)
        failedText.textContent = String(view.counters.failed)
        nameInput.disabled = view.nameDisabled
        if (state.senderName && nameInput.value !== state.senderName) {
            nameInput.value = state.senderName
        }
        nameInput.setAttribute('aria-invalid', state.error?.code === 'SYNC_INVALID_SENDER_NAME' ? 'true' : 'false')
        recoveryText.textContent = view.recovery
        connectNotice.hidden = !connectNoticeVisible
        actionButton.textContent = action.label
        actionButton.disabled = action.disabled
        actionButton.dataset.action = action.kind
    }

    const runAction = async () => {
        const view = deriveSyncOutputView(state, { policy })
        try {
            await runSyncOutputAction(view.action.kind, {
                controller,
                name: nameInput.value,
                policyBlocked: view.policyBlocked,
                onConnectIntent: () => {
                    pendingAction = 'connect'
                    connectNoticeVisible = true
                    render()
                },
                afterPaint
            })
        } catch {
            // Controller state owns the actionable recovery presentation.
        } finally {
            pendingAction = null
            connectNoticeVisible = false
            render()
        }
    }

    const open = () => {
        if (destroyed) return
        if (dialog.open) {
            nameInput.focus()
            return
        }
        policy = getPolicy()
        connectNoticeVisible = false
        pendingAction = null
        render()
        dialog.showModal()
        nameInput.focus()
        const view = deriveSyncOutputView(state, { policy })
        if (!view.policyBlocked && shouldCheckOnOpen(state)) {
            void runSyncOutputAction('check', { controller }).catch(() => {})
        }
    }
    const close = () => { if (dialog.open) dialog.close() }
    const handleDialogClick = event => { if (event.target === dialog) close() }
    const handleActionClick = () => { void runAction() }

    closeButton.addEventListener('click', close)
    dialog.addEventListener('click', handleDialogClick)
    actionButton.addEventListener('click', handleActionClick)
    const unsubscribe = controller.subscribe(nextState => {
        state = nextState || {}
        render()
    })

    return Object.freeze({
        open,
        close,
        render,
        get destroyed() { return destroyed },
        destroy() {
            if (destroyed) return
            destroyed = true
            unsubscribe?.()
            closeButton.removeEventListener('click', close)
            dialog.removeEventListener('click', handleDialogClick)
            actionButton.removeEventListener('click', handleActionClick)
            close()
        }
    })
}
