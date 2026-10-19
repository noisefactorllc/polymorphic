// A small agent for the Seance relay tests: it joins a session the way the
// shared agent tool does and sends nf-agent/1 requests to the app's tab.
// Node's own WebSocket and fetch only; the frames are the relay's wire format
// (public/js/agent/relay.js).
//
// Like the shared agent tool, it trusts relay frames only from the session
// owner, by the sender that the server stamps on every relayed frame, and it
// takes a response only from the tab that it asked.
import { randomUUID } from 'node:crypto'

const RELAY = 'nf-agent/1'
// Seance's control lane refills at 5 frames a second with a burst of 10; the
// agent tool sends at most 4 a second with a burst of 8, and so does this one.
const SEND_RATE = 4
const SEND_BURST = 8

function waitFor(predicate, frames, timeoutMs, what) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            frames.waiters.delete(waiter)
            reject(new Error(`Timed out waiting for ${what}`))
        }, timeoutMs)
        const waiter = (frame) => {
            if (!predicate(frame)) return false
            clearTimeout(timer)
            resolve(frame)
            return true
        }
        frames.waiters.add(waiter)
    })
}

/**
 * Join session `code` on the Seance server at `server` as an agent.
 * @param {{server: string, code: string, origin: string}} options
 */
export async function joinAsAgent({ server, code, origin }) {
    const probe = await fetch(`${server}/v1/sessions/${encodeURIComponent(code)}`, { headers: { Origin: origin } })
    if (!probe.ok) throw new Error(`Session lookup answered ${probe.status}`)
    const sessionId = (await probe.json()).id || code
    const socket = new WebSocket(`${server.replace(/^http/, 'ws')}/v1/sessions/${encodeURIComponent(sessionId)}/ws`, { headers: { Origin: origin } })
    const frames = { waiters: new Set() }
    const partial = new Map()
    // Every relay frame that reached this agent, owner's or not.
    const relayed = []
    let anonToken = null
    let owner = null
    socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        let frame
        try { frame = JSON.parse(event.data) } catch { return }
        if (frame.type === 'welcome') {
            anonToken = frame.anon_token || anonToken
            owner = frame.owner?.user_id || null
        }
        if (frame.type === 'owner-changed') owner = frame.user_id || null
        if (frame.type === 'clicked-button' && frame.relay === RELAY) {
            relayed.push(frame)
            if (!owner || frame.user_id !== owner) return
            if (frame.body === undefined) {
                // A body too large for one frame arrives as JSON text slices.
                const key = `${frame.kind}:${frame.id}:${frame.connection_id}`
                const slices = partial.get(key) || []
                slices[frame.part] = frame.chunk
                partial.set(key, slices)
                if (slices.filter(slice => slice !== undefined).length < frame.parts) return
                partial.delete(key)
                frame = { ...frame, body: JSON.parse(slices.join('')) }
            }
        }
        for (const waiter of [...frames.waiters]) if (waiter(frame)) frames.waiters.delete(waiter)
    })
    const opened = new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', () => reject(new Error('The agent socket failed')), { once: true })
    })
    const joined = waitFor(frame => frame.type === 'session-snapshot', frames, 15000, 'the session snapshot')
    await opened
    socket.send(JSON.stringify({ type: 'hello', protocol: 1, dialects: ['noisemaker-dsl'] }))
    await joined

    let tokens = SEND_BURST
    let tokensAt = Date.now()
    async function sendRelay(frame) {
        for (;;) {
            const now = Date.now()
            tokens = Math.min(SEND_BURST, tokens + (now - tokensAt) * SEND_RATE / 1000)
            tokensAt = now
            if (tokens >= 1) break
            await new Promise(done => setTimeout(done, Math.ceil((1 - tokens) * 1000 / SEND_RATE)))
        }
        tokens -= 1
        socket.send(JSON.stringify(frame))
    }

    const headers = (extra = {}) => ({ Origin: origin, ...(anonToken ? { 'X-Seance-Anon': anonToken } : {}), ...extra })
    const ownerFrame = frame => frame.type === 'clicked-button' && frame.relay === RELAY &&
        frame.user_id === owner && frame.body !== undefined

    return {
        relayed,
        /** The session owner's user id, as the server last announced it. */
        owner: () => owner,
        /** Wait for the owner's tab to announce itself, as it does when it joins. */
        announced: (timeoutMs = 15000) => waitFor(frame => ownerFrame(frame) && frame.kind === 'announce', frames, timeoutMs, 'an announce'),
        /** Ask every tab to describe itself; only the owner's tab answers. */
        async describe(timeoutMs = 15000) {
            const id = randomUUID()
            const response = waitFor(frame => ownerFrame(frame) && frame.kind === 'response' && frame.id === id, frames, timeoutMs, 'describe')
            await sendRelay({ type: 'clicked-button', relay: RELAY, kind: 'request', id, to: '*', body: { command: 'describe', args: {} } })
            return response
        },
        /** Send a request frame as it is, and return its id. */
        async send(to, command, args = {}) {
            const id = randomUUID()
            await sendRelay({ type: 'clicked-button', relay: RELAY, kind: 'request', id, to, body: { command, args } })
            return id
        },
        /** Send one command to tab `to` and resolve with that tab's response frame. */
        async request(to, command, args = {}, { timeoutMs = 60000 } = {}) {
            const id = randomUUID()
            const response = waitFor(frame => ownerFrame(frame) && frame.kind === 'response' && frame.id === id && frame.from === to,
                frames, timeoutMs, command)
            await sendRelay({ type: 'clicked-button', relay: RELAY, kind: 'request', id, to, body: { command, args } })
            return response
        },
        /** The session's documents, from a fresh snapshot. */
        async documents() {
            const snapshot = waitFor(frame => frame.type === 'session-snapshot', frames, 15000, 'a session snapshot')
            socket.send(JSON.stringify({ type: 'session-state' }))
            return (await snapshot).docs || []
        },
        async downloadImage(id) {
            const response = await fetch(`${server}/v1/sessions/${encodeURIComponent(sessionId)}/images/${id}`, { headers: headers() })
            if (!response.ok) throw new Error(`Image download answered ${response.status}`)
            return Buffer.from(await response.arrayBuffer())
        },
        async uploadImage(bytes, mimeType) {
            const response = await fetch(`${server}/v1/sessions/${encodeURIComponent(sessionId)}/images`, {
                method: 'POST', headers: headers({ 'Content-Type': mimeType }), body: bytes,
            })
            if (!response.ok) throw new Error(`Image upload answered ${response.status}`)
            return (await response.json()).id
        },
        close() {
            socket.close()
        },
    }
}
