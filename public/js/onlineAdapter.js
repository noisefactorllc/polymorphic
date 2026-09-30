export const DEFAULT_SEANCE_URL = 'https://seance.noisefactor.io'
// Bypass browsers that cached the older alias without Cache-Control.
export const DEFAULT_SEANCE_SDK_URL = 'https://seance.noisefactor.io/sdk/0/index.js?v=images-20260929'

export const DEFAULT_RECONNECT_BASE_MS = 500
export const DEFAULT_RECONNECT_MAX_MS = 8000
export const DEFAULT_RECONNECT_JITTER = 0.25

const DEFAULT_DOC_ID = 'main'

// A remote document larger than this is not something anyone typed. Compiling
// it would stall the tab, so it is refused and the session keeps the last
// program that worked.
export const MAX_REMOTE_DSL_LENGTH = 200000

// Server error codes that mean "this session will never accept you", as
// opposed to a connection that might recover. A join that fails with one of
// these has to stop retrying and clear ?seance= from the URL, or every reload
// walks into the same wall.
const TERMINAL_JOIN_CODES = new Set([
    'unknown_session',
    'dialect_mismatch',
    'forbidden',
    'unauthorized',
])

// Friendly text for the codes a user can actually hit. The server's own detail
// string is written for an operator reading a log ("session dialect is
// 'layers'"), not for someone who just clicked a link.
const ERROR_COPY = {
    unknown_session: 'That session has ended or never existed',
    dialect_mismatch: 'That link is for a different kind of session',
    forbidden: 'That session is not accepting you',
    unauthorized: 'Seance could not identify this browser',
    rate_limited: 'Too many attempts. Wait a minute and try again',
    too_large: 'That program is too large to share',
    readonly: 'You have been set to read-only in this session',
}

const CLOSE_CODE_MAP = {
    4400: 'protocol',
    4401: 'unauthorized',
    4403: 'forbidden',
    4404: 'unknown_session',
    4409: 'dialect_mismatch',
    4423: 'rate_limited',
    4429: 'rate_limited',
}

export function seanceErrorCode(error) {
    const raw = error?.code ?? error?.kind ?? error?.frame?.code ?? null
    if (typeof raw === 'number' && CLOSE_CODE_MAP[raw]) return CLOSE_CODE_MAP[raw]
    if (typeof raw === 'string') return raw.replace(/-/g, '_')
    return raw
}

export function describeSeanceError(error) {
    return ERROR_COPY[seanceErrorCode(error)] || error?.message || 'Unknown error'
}

export function isTerminalJoinError(error) {
    return TERMINAL_JOIN_CODES.has(seanceErrorCode(error))
}

/**
 * Look over a document that arrived from a peer before this app runs it.
 *
 * Polymorphic executes whatever is in the editor, and in a session that text
 * can come from anyone holding the link. Two things are worth knowing before
 * it is compiled: whether it is plausibly a program at all, and whether it
 * asks this browser to fetch media from somewhere else, which discloses the
 * viewer's address to a host the peer chose.
 *
 * @param {string} text
 * @returns {{ok: boolean, reason: string|null, externalMedia: string[]}}
 */
export function inspectRemoteDsl(text) {
    const value = String(text ?? '')
    if (value.length > MAX_REMOTE_DSL_LENGTH) {
        return { ok: false, reason: 'too-large', externalMedia: [] }
    }

    const externalMedia = []
    for (const match of value.matchAll(/\burl\s*:\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        const url = match[1] ?? match[2] ?? ''
        if (/^(?:https?:)?\/\//i.test(url.trim())) externalMedia.push(url.trim())
    }

    return { ok: true, reason: null, externalMedia }
}
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
    const inspection = inspectRemoteDsl(text)
    if (!inspection.ok) {
        deps.onRemoteRejected?.(inspection, context)
        return { success: false, error: `remote document refused (${inspection.reason})` }
    }
    if (inspection.externalMedia.length) {
        deps.onRemoteMedia?.(inspection.externalMedia, context)
    }

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

    const reconnectBaseMs = deps.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS
    const reconnectMaxMs = deps.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS
    const reconnectJitter = deps.reconnectJitter ?? DEFAULT_RECONNECT_JITTER
    const maxReconnectAttempts = deps.maxReconnectAttempts ?? 0

    let online = null
    let sdkPromise = null
    let bindCleanup = null
    let statusUnsub = null
    let disconnectUnsub = null
    let errorUnsub = null
    let extraUnsubs = []
    let isReconnecting = false
    let reconnectAttempt = 0
    // One session action at a time. takeOnline() awaits an SDK import and a
    // POST before the SDK reports "connecting", and the dialog only disables
    // its buttons on that status, so a double click used to create two
    // sessions and orphan the first (two of ten creates per IP per hour).
    let actionInFlight = false
    let actionVersion = 0
    let preparedImageText = null
    let imagePreparationVersion = 0
    const uploadedImages = new Set()

    async function ensureOnline() {
        if (online) return online
        if (!sdkPromise) sdkPromise = importSdk(config.sdkUrl).catch(error => {
            sdkPromise = null
            throw error
        })
        const sdk = await sdkPromise
        online = sdk.createOnlineDslLayer({
            seanceUrl: config.seanceUrl,
            publicAppUrl,
            location,
            reconnectBaseMs,
            reconnectMaxMs,
            reconnectJitter,
            ...deps.layerOptions,
        })
        bindCleanup = online.bindEditor({
            editor,
            validateText: text => {
                const allowed = deps.validatePublication?.() ?? true
                if (allowed !== true) return allowed
                if (!deps.prepareImages || !/\burl\b/.test(text) || text === preparedImageText) return true
                publishImageText(text, 'editor').catch(error => showToast(error.message, 'error'))
                return { ok: false, reason: 'Preparing composition images' }
            },
            onRemoteText: (text, context) => applyRemoteDslText(text, context, {
                editor,
                applyCurrentDsl,
            }),
            onAcceptedText: (_text, context) => {
                deps.onAcceptedText?.(context)
            },
        })
        statusUnsub = online.on('status', (status) => {
            const wasReconnecting = isReconnecting
            if (status === 'online' || status === 'readonly') {
                if (wasReconnecting) {
                    isReconnecting = false
                    reconnectAttempt = 0
                    showToast('Reconnected to session', 'success')
                    deps.onReconnected?.()
                    if (status === 'online') {
                        updateLocalText('reconnect')
                    }
                }
            } else if (status === 'offline') {
                isReconnecting = false
                reconnectAttempt = 0
            }
            refreshStatus(status)
            deps.onStatus?.(status)
        })
        disconnectUnsub = online.on?.('disconnect', (info) => {
            console.debug('[Polymorphic] Seance disconnect:', info)
            const willReconnect = Boolean(info?.willReconnect)
            if (willReconnect) {
                const isFirstAttempt = !isReconnecting
                isReconnecting = true
                reconnectAttempt = (info?.attempt ?? 0) + 1
                if (maxReconnectAttempts > 0 && reconnectAttempt > maxReconnectAttempts) {
                    console.warn('[Polymorphic] Max reconnect attempts exceeded (%d); aborting retry loop', maxReconnectAttempts)
                    isReconnecting = false
                    reconnectAttempt = 0
                    closeActiveSession()
                    writeSessionToBrowserUrl(null)
                    refreshStatus('offline')
                    showToast('Could not reconnect to session: connection timed out', 'error')
                    deps.onDisconnect?.({ ...info, willReconnect: false, maxAttemptsExceeded: true })
                    return
                }
                if (isFirstAttempt) {
                    showToast('Connection lost. Reconnecting...', 'warning')
                }
                refreshStatus('connecting')
                deps.onReconnecting?.({ ...info, attempt: reconnectAttempt })
            } else {
                const hadSession = Boolean(online?.getSessionId?.())
                const wasReconnecting = isReconnecting
                isReconnecting = false
                reconnectAttempt = 0
                const terminal = isTerminalJoinError(info) || isTerminalJoinError(info?.error)
                if (terminal) {
                    closeActiveSession()
                    writeSessionToBrowserUrl(null)
                    refreshStatus('offline')
                    showToast(`Disconnected: ${describeSeanceError(info?.error || info)}`, 'error')
                } else if (hadSession && wasReconnecting) {
                    refreshStatus('offline')
                    showToast('Disconnected from session', 'error')
                }
            }
            deps.onDisconnect?.(info)
        })
        errorUnsub = online.on('error', (error) => {
            console.warn('[Polymorphic] Seance error:', error)
            deps.onError?.(error)
            if (isTerminalJoinError(error)) {
                isReconnecting = false
                reconnectAttempt = 0
                closeActiveSession()
                writeSessionToBrowserUrl(null)
                refreshStatus('offline')
                showToast(`Session ended: ${describeSeanceError(error)}`, 'error')
                return
            }
            if (isReconnecting) {
                return
            }
            const code = seanceErrorCode(error)
            if (code && code !== 'readonly') showToast(describeSeanceError(error), 'error')
        })
        extraUnsubs = [
            online.on('doc-reject', (info) => {
                if (info?.reason === 'reconnect_ambiguous' || info?.reason === 'readonly_draft') {
                    showToast('Sync paused to protect your edits. Copy your draft, rejoin the session, then apply your merged version.', 'warning')
                } else if (info?.reason === 'missing_document') {
                    showToast('This document is not part of the session. Copy your draft, then go offline and create a new session to share it.', 'warning')
                }
            }),
            // Being silently unable to type is the confusing half of being
            // moderated: the SDK drops the write and says nothing.
            online.on('readonly-write', () => {
                showToast('You are read-only in this session', 'warning')
                deps.onReadonlyWrite?.()
            }),
            online.on('moderation', (frame) => {
                if (frame?.action === 'readonly') refreshStatus()
                deps.onModeration?.(frame)
            }),
            // Text that someone else wrote should not look like your own.
            online.on('remote-edit', (frame) => {
                deps.onRemoteEdit?.(frame)
            }),
        ]
        refreshStatus('offline')
        return online
    }

    function refreshStatus(status = online?.getStatus?.() || 'offline') {
        const dialog = deps.dialog
        if (!dialog) return

        const isOnline = status === 'online' || status === 'readonly'
        const sessionId = online?.getSessionId?.() || ''
        const sessionUrl = (isOnline || isReconnecting) ? (online?.getShareUrl?.() || '') : ''

        // Drive the unified seance-dialog's internal view via its state; the
        // dialog is shown/hidden by its own trigger (the "go online" menu
        // item), so never toggle its visibility here. 'readonly' is passed
        // through rather than folded into 'online': the dialog renders it as
        // its own state, and a moderated user needs to see why the editor
        // stopped taking their typing.
        dialog.state = status === 'readonly'
            ? 'readonly'
            : isOnline ? 'online' : (status === 'connecting' ? 'connecting' : 'offline')
        dialog.sessionId = (isOnline || isReconnecting) ? sessionId : ''
        dialog.sessionUrl = sessionUrl

        if (isReconnecting) {
            dialog.setAttribute?.('connecting-label', 'Reconnecting…')
        } else {
            dialog.removeAttribute?.('connecting-label')
        }
    }

    function isLayerConnected(layer = online) {
        const status = layer?.getStatus?.()
        return status === 'online' || status === 'readonly' || status === 'connecting'
    }

    function closeActiveSession(layer = online) {
        imagePreparationVersion++
        preparedImageText = null
        uploadedImages.clear()
        if (!isLayerConnected(layer)) return false
        isReconnecting = false
        reconnectAttempt = 0
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
        if (actionInFlight) return null
        actionInFlight = true
        const version = ++actionVersion
        try {
            const text = getCurrentDsl()
            const layer = await ensureOnline()
            if (version !== actionVersion) return null
            closeActiveSession(layer)
            const prepared = deps.prepareImages ? await deps.prepareImages(text) : null
            if (version !== actionVersion || layer !== online) return null
            if (getCurrentDsl() !== text) {
                showToast('Program changed while preparing images. Go online again to share the latest version.', 'info')
                return null
            }
            if (prepared) {
                if (editor) editor.value = prepared.dsl
                preparedImageText = prepared.dsl
            }
            await layer.takeOnline(prepared?.images.length
                ? { docs: getInitialDocs(prepared.dsl), images: prepared.images }
                : getInitialDocs(prepared?.dsl ?? text))
            if (version !== actionVersion || layer !== online) return null
            for (const image of prepared?.images || []) uploadedImages.add(image.id)
            rememberSessionId(layer.getSessionId())
            writeSessionToBrowserUrl(layer.getSessionId())
            refreshStatus()
            showToast('Session is online', 'success')
            return layer.getSessionId()
        } finally {
            actionInFlight = false
        }
    }

    async function joinSession(sessionId) {
        const normalized = String(sessionId || '').trim()
        if (!normalized) return null
        if (actionInFlight) return null
        actionInFlight = true
        try {
            const resolvedSessionId = await resolveJoinSessionId(normalized)
            const layer = await ensureOnline()
            closeActiveSession(layer)
            await layer.joinSession(resolvedSessionId)
            rememberSessionId(layer.getSessionId())
            writeSessionToBrowserUrl(layer.getSessionId())
            refreshStatus()
            showToast('Joined session', 'success')
            return layer.getSessionId()
        } catch (err) {
            handleJoinFailure(err)
            return null
        } finally {
            actionInFlight = false
        }
    }

    /**
     * A join that can never succeed has to stop advertising itself. Leaving
     * ?seance= in the URL meant every reload retried a dead session and
     * reported the server's operator-facing detail string as if it were
     * advice.
     */
    function handleJoinFailure(err) {
        const terminal = isTerminalJoinError(err)
        if (terminal) {
            closeActiveSession()
            writeSessionToBrowserUrl(null)
            refreshStatus('offline')
        }
        console.error('[Polymorphic] Seance join failed:', err)
        showToast(`Could not join session: ${describeSeanceError(err)}`, 'error')
    }

    async function joinFromUrl() {
        const sessionId = readSessionFromLocation(location)
        if (!sessionId) return null
        return joinSession(sessionId)
    }

    function isOnline() {
        const status = online?.getStatus?.()
        return status === 'online' || status === 'readonly'
    }

    function goOffline() {
        actionVersion++
        isReconnecting = false
        reconnectAttempt = 0
        if (!online) return
        closeActiveSession()
        writeSessionToBrowserUrl(null)
        refreshStatus('offline')
        showToast('Offline', 'info')
    }

    function updateLocalText(source = 'local') {
        if (!online) return null
        if ((deps.validatePublication?.() ?? true) !== true) return null
        if (deps.prepareImages && /\burl\b/.test(getCurrentDsl())) return publishImageText(getCurrentDsl(), source)
        imagePreparationVersion++
        return online.updateLocalText(DEFAULT_DOC_ID, getCurrentDsl(), { source })
    }

    async function publishImageText(text, source) {
        const version = ++imagePreparationVersion
        const layer = online, sessionId = layer?.getSessionId?.()
        if (!layer || !sessionId || !['online', 'connecting'].includes(layer.getStatus())) return null
        const prepared = await deps.prepareImages(text)
        if (version !== imagePreparationVersion || getCurrentDsl() !== text || layer !== online || sessionId !== layer.getSessionId()) return null
        for (const image of prepared.images) {
            if (uploadedImages.has(image.id)) continue
            await layer.uploadImage(await deps.imageBlob(image))
            if (version !== imagePreparationVersion || layer !== online || sessionId !== layer.getSessionId()) return null
            uploadedImages.add(image.id)
        }
        if (version !== imagePreparationVersion || getCurrentDsl() !== text || layer !== online || sessionId !== layer.getSessionId()) return null
        preparedImageText = prepared.dsl
        if (editor) editor.value = prepared.dsl
        return layer.updateLocalText(DEFAULT_DOC_ID, prepared.dsl, { source })
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
                showToast(`Could not take online: ${describeSeanceError(err)}`, 'error')
            })
        })
        dialog?.addEventListener?.('join-session', (event) => {
            // joinSession reports its own failures (it also has to clear a
            // dead ?seance= from the URL), so this only guards against an
            // unexpected throw.
            joinSession(event.detail?.sessionId).catch((err) => {
                console.error('[Polymorphic] Join session failed:', err)
                showToast(`Could not join session: ${describeSeanceError(err)}`, 'error')
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
        actionVersion++
        bindCleanup?.()
        statusUnsub?.()
        disconnectUnsub?.()
        errorUnsub?.()
        for (const unsub of extraUnsubs) unsub?.()
        extraUnsubs = []
        isReconnecting = false
        reconnectAttempt = 0
        online?.goOffline?.()
        refreshStatus('offline')
        bindCleanup = null
        statusUnsub = null
        disconnectUnsub = null
        errorUnsub = null
        online = null
    }

    return {
        config,
        reconnectConfig: {
            baseMs: reconnectBaseMs,
            maxMs: reconnectMaxMs,
            jitter: reconnectJitter,
            maxAttempts: maxReconnectAttempts,
        },
        getStatus: () => online?.getStatus?.() || 'offline',
        getSessionId: () => online?.getSessionId?.() || '',
        isReconnecting: () => isReconnecting,
        getReconnectAttempt: () => reconnectAttempt,
        ensureOnline,
        getImage: async id => (await ensureOnline()).getImage(id),
        takeOnline,
        joinSession,
        joinFromUrl,
        goOffline,
        updateLocalText,
        copyShareUrl,
        openDialog,
        isOnline,
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
