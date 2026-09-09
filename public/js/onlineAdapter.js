export const DEFAULT_SEANCE_URL = 'https://seance.noisefactor.io'
export const DEFAULT_SEANCE_SDK_URL = 'https://seance.noisefactor.io/sdk/0/index.js'

const DEFAULT_DOC_ID = 'main'
const VOLATILE_SHARE_PARAMS = ['code']
const SESSION_ID_CASE_STORAGE_KEY = 'polymorphic.seance.sessionIdCaseMap'

// Hosts on which the ?seanceUrl= / ?seanceSdk= overrides are honoured. The
// SDK URL is fed to import(), so on a public origin those params would let any
// share link run arbitrary code here (and ?seanceUrl= would hand the whole
// program to a server of the sender's choosing). They exist for the test
// harness and local development, so they are read only when this page is
// itself served from a development host. Same guard as noisedeck's
// app/index.html.
const LOCAL_DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', ''])

export function isLocalDevLocation(locationLike) {
    try {
        return LOCAL_DEV_HOSTNAMES.has(urlFrom(locationLike).hostname)
    } catch {
        return false
    }
}

export function resolveOnlineConfig(options = {}) {
    const location = urlFrom(options.location || globalThis.location)
    const globals = options.globals || globalThis.POLYMORPHIC_SEANCE || {}
    const params = isLocalDevLocation(location) ? location.searchParams : new URLSearchParams()

    return {
        seanceUrl: params.get('seanceUrl')
            || globals.seanceUrl
            || DEFAULT_SEANCE_URL,
        sdkUrl: params.get('seanceSdk')
            || globals.sdkUrl
            || DEFAULT_SEANCE_SDK_URL,
    }
}

export function getInitialDocs(text) {
    return [{
        id: DEFAULT_DOC_ID,
        title: 'Program',
        kind: 'noisemaker-dsl',
        text: String(text ?? ''),
        default: true,
    }]
}

export function shareBaseUrl(locationLike = globalThis.location) {
    const url = urlFrom(locationLike)
    for (const param of VOLATILE_SHARE_PARAMS) {
        url.searchParams.delete(param)
    }
    return url.toString()
}

export async function applyRemoteDslText(text, context = {}, deps = {}) {
    const editor = deps.editor
    if (editor && editor.value !== text) {
        editor.value = String(text ?? '')
    }
    return deps.applyCurrentDsl?.(context.source || 'remote') ?? { success: true }
}

export function createPolymorphicOnlineAdapter(deps = {}) {
    const editor = deps.editor
    const location = deps.location || globalThis.location
    const history = deps.history || globalThis.history
    const navigatorRef = deps.navigator || globalThis.navigator
    const importSdk = deps.importSdk || ((url) => import(url))
    const getCurrentDsl = deps.getCurrentDsl || (() => editor?.value || '')
    const showToast = deps.showToast || (() => {})
    const applyCurrentDsl = deps.applyCurrentDsl || (async () => ({ success: true }))
    const config = resolveOnlineConfig({ location, globals: deps.globals })
    const publicAppUrl = shareBaseUrl(location)

    let online = null
    let sdkPromise = null
    let bindCleanup = null
    let statusUnsub = null
    let errorUnsub = null

    async function ensureOnline() {
        if (online) return online
        if (!sdkPromise) sdkPromise = importSdk(config.sdkUrl)
        const sdk = await sdkPromise
        online = sdk.createOnlineDslLayer({
            seanceUrl: config.seanceUrl,
            publicAppUrl,
            location,
        })
        bindCleanup = online.bindEditor({
            editor,
            onRemoteText: (text, context) => applyRemoteDslText(text, context, {
                editor,
                applyCurrentDsl,
            }),
            onAcceptedText: (_text, context) => {
                deps.onAcceptedText?.(context)
            },
        })
        statusUnsub = online.on('status', (status) => {
            refreshStatus(status)
            deps.onStatus?.(status)
        })
        errorUnsub = online.on('error', (error) => {
            console.warn('[Polymorphic] Seance error:', error)
            deps.onError?.(error)
        })
        refreshStatus('offline')
        return online
    }

    function refreshStatus(status = online?.getStatus?.() || 'offline') {
        const dialog = deps.dialog
        if (!dialog) return

        const isOnline = status === 'online' || status === 'readonly'
        const sessionId = online?.getSessionId?.() || ''
        const sessionUrl = isOnline ? (online?.getShareUrl?.() || '') : ''

        // Drive the unified seance-dialog's internal view via its state; the
        // dialog is shown/hidden by its own trigger (the "go online" menu
        // item), so never toggle its visibility here.
        dialog.state = isOnline ? 'online' : (status === 'connecting' ? 'connecting' : 'offline')
        dialog.sessionId = isOnline ? sessionId : ''
        dialog.sessionUrl = sessionUrl
    }

    function isLayerConnected(layer = online) {
        const status = layer?.getStatus?.()
        return status === 'online' || status === 'readonly' || status === 'connecting'
    }

    function closeActiveSession(layer = online) {
        if (!isLayerConnected(layer)) return false
        layer.goOffline?.()
        refreshStatus('offline')
        return true
    }

    function writeSessionToBrowserUrl(sessionId) {
        if (!history?.replaceState || !online?.writeSessionToUrl) return
        try {
            const next = online.writeSessionToUrl(shareBaseUrl(location), sessionId)
            history.replaceState(null, '', next)
        } catch (err) {
            console.debug('[Polymorphic] Could not update session URL:', err)
        }
    }

    async function takeOnline() {
        const layer = await ensureOnline()
        closeActiveSession(layer)
        await layer.takeOnline(getInitialDocs(getCurrentDsl()))
        rememberSessionId(layer.getSessionId())
        writeSessionToBrowserUrl(layer.getSessionId())
        refreshStatus()
        showToast('Session is online', 'success')
        return layer.getSessionId()
    }

    async function joinSession(sessionId) {
        const normalized = String(sessionId || '').trim()
        if (!normalized) return null
        const resolvedSessionId = await resolveJoinSessionId(normalized)
        const layer = await ensureOnline()
        closeActiveSession(layer)
        await layer.joinSession(resolvedSessionId)
        rememberSessionId(layer.getSessionId())
        writeSessionToBrowserUrl(layer.getSessionId())
        refreshStatus()
        showToast('Joined session', 'success')
        return layer.getSessionId()
    }

    async function joinFromUrl() {
        const sessionId = readSessionFromLocation(location)
        if (!sessionId) return null
        return joinSession(sessionId)
    }

    function goOffline() {
        if (!online) return
        online.goOffline()
        writeSessionToBrowserUrl(null)
        refreshStatus('offline')
        showToast('Offline', 'info')
    }

    function updateLocalText(source = 'local') {
        if (!online) return null
        return online.updateLocalText(DEFAULT_DOC_ID, getCurrentDsl(), { source })
    }

    async function copyShareUrl() {
        const url = deps.dialog?.sessionUrl || online?.getShareUrl?.()
        if (!url) return false
        await navigatorRef?.clipboard?.writeText?.(url)
        showToast('Session URL copied', 'success')
        return true
    }

    function openDialog() {
        deps.dialog?.show?.()
    }

    async function resolveJoinSessionId(sessionId) {
        const remembered = recallSessionId(sessionId)
        if (remembered) return remembered

        const candidates = caseCandidates(sessionId)
        if (candidates.length <= 1 || !globalThis.fetch) return sessionId

        for (const candidate of candidates) {
            try {
                const response = await globalThis.fetch(`${stripTrailingSlash(config.seanceUrl)}/v1/sessions/${encodeURIComponent(candidate)}`, {
                    credentials: 'include',
                })
                if (response.ok) {
                    rememberSessionId(candidate)
                    return candidate
                }
            } catch {
                return sessionId
            }
        }
        return sessionId
    }

    function wireUi() {
        // All collaboration intents now arrive from the single seance-dialog
        // as semantic events (was: separate menu-item clicks + session-status
        // events).
        const dialog = deps.dialog
        dialog?.addEventListener?.('take-online', () => {
            takeOnline().catch((err) => {
                console.error('[Polymorphic] Take online failed:', err)
                showToast(`Could not take online: ${err.message}`, 'error')
            })
        })
        dialog?.addEventListener?.('join-session', (event) => {
            joinSession(event.detail?.sessionId).catch((err) => {
                console.error('[Polymorphic] Join session failed:', err)
                showToast(`Could not join session: ${err.message}`, 'error')
            })
        })
        dialog?.addEventListener?.('go-offline', () => goOffline())
        dialog?.addEventListener?.('copy-url', () => {
            copyShareUrl().catch((err) => {
                console.error('[Polymorphic] Copy session URL failed:', err)
                showToast('Could not copy session URL', 'error')
            })
        })
        refreshStatus('offline')
    }

    function dispose() {
        bindCleanup?.()
        statusUnsub?.()
        errorUnsub?.()
        online?.goOffline?.()
        bindCleanup = null
        statusUnsub = null
        errorUnsub = null
        online = null
    }

    return {
        config,
        ensureOnline,
        takeOnline,
        joinSession,
        joinFromUrl,
        goOffline,
        updateLocalText,
        copyShareUrl,
        openDialog,
        wireUi,
        refreshStatus,
        closeActiveSession,
        dispose,
        get online() { return online },
    }
}

function urlFrom(locationLike) {
    if (typeof locationLike === 'string') return new URL(locationLike, 'http://localhost/')
    if (locationLike instanceof URL) return new URL(locationLike.toString())
    if (locationLike?.href) return new URL(locationLike.href)
    return new URL('http://localhost/')
}

function readSessionFromLocation(locationLike) {
    try {
        return urlFrom(locationLike).searchParams.get('seance')
    } catch {
        return null
    }
}

function caseCandidates(sessionId) {
    const value = String(sessionId || '').trim()
    if (!/^[A-Z0-9]{6}$/.test(value)) return [value]
    const chars = [...value]
    const variants = ['']
    for (const ch of chars) {
        const lower = /[A-Z]/.test(ch) ? ch.toLowerCase() : ch
        const options = lower === ch ? [ch] : [ch, lower]
        const currentLength = variants.length
        for (let i = 0; i < currentLength; i++) {
            const prefix = variants.shift()
            for (const option of options) variants.push(prefix + option)
        }
    }
    return [value, ...variants.filter((candidate) => candidate !== value)]
}

function stripTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '')
}

function rememberSessionId(sessionId) {
    const value = String(sessionId || '')
    if (!value) return
    try {
        const raw = globalThis.localStorage?.getItem(SESSION_ID_CASE_STORAGE_KEY)
        const map = raw ? JSON.parse(raw) : {}
        map[value.toUpperCase()] = value
        globalThis.localStorage?.setItem(SESSION_ID_CASE_STORAGE_KEY, JSON.stringify(map))
    } catch {
        // Local storage is a convenience only; probing still works without it.
    }
}

function recallSessionId(sessionId) {
    try {
        const raw = globalThis.localStorage?.getItem(SESSION_ID_CASE_STORAGE_KEY)
        const map = raw ? JSON.parse(raw) : {}
        return map[String(sessionId || '').toUpperCase()] || null
    } catch {
        return null
    }
}
