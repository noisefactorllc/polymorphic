import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    SyncBridgeClient,
    SyncPermissionRequiredError
} from '../../public/js/sync/sdk/0.3.4/browser/index.js'

// Sync's connect() must open the control socket before it reads the loopback
// permission state, so a browser that reports `prompt` until a network request
// happens can still show its local-network prompt and reach the daemon. The
// passive gate that probe() uses must stay probe-only: a connect that fails to
// open explains the failure with the permission state. These tests pin that
// contract on the snapshot polymorphic actually serves, because a snapshot
// refresh could otherwise silently reintroduce a connect that never opens a
// socket on a prompt-state page.

const ENDPOINT = 'http://127.0.0.1:53979'
const TOKEN = 'a'.repeat(64)
const CAPABILITIES = Object.freeze({
    send: true,
    receive: false,
    providers: Object.freeze([
        Object.freeze({ id: 'test', direction: 'send', available: true, selected: true })
    ])
})
const WELCOME = Object.freeze({
    type: 'welcome',
    protocolVersion: 1,
    version: '0.3.3',
    instanceId: 'instance-1',
    capabilities: CAPABILITIES
})

class FakeControlSocket {
    static instances = []
    static onConstruct = null

    constructor(url) {
        this.url = url
        this.readyState = 0
        this.bufferedAmount = 0
        this.sent = []
        this.listeners = new Map()
        FakeControlSocket.instances.push(this)
        const hook = FakeControlSocket.onConstruct
        queueMicrotask(() => hook?.(this))
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener)
    }

    emit(type, event = {}) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this, event)
    }

    send(data) {
        this.sent.push(data)
        this.onSend?.(data)
    }

    close() {
        this.readyState = 3
        this.emit('close', {})
    }
}

function scriptedControl() {
    FakeControlSocket.instances.length = 0
    FakeControlSocket.onConstruct = socket => {
        socket.readyState = 1
        socket.onSend = text => {
            const message = JSON.parse(text)
            if (message.type === 'hello') socket.emit('message', { data: JSON.stringify(WELCOME) })
        }
        socket.emit('open', {})
    }
}

test('connect opens the control socket while the loopback permission query reports prompt', async () => {
    scriptedControl()
    let queries = 0
    const bridge = new SyncBridgeClient({
        endpoint: ENDPOINT,
        token: TOKEN,
        WebSocket: FakeControlSocket,
        permissions: { query: async () => { queries += 1; return { state: 'prompt' } } },
        timeoutMs: 5000
    })
    try {
        const welcome = await bridge.connect()
        assert.equal(JSON.stringify(welcome), JSON.stringify(WELCOME))
        assert.equal(FakeControlSocket.instances.length, 1,
            'connect must open its control socket before any permission read')
        assert.equal(queries, 0,
            'a successful open must not consult the passive permission gate')
        assert.equal(bridge.welcome, welcome)
    } finally {
        bridge.close()
    }
})

test('a failed control open explains itself with the loopback permission state', async () => {
    FakeControlSocket.instances.length = 0
    FakeControlSocket.onConstruct = socket => {
        socket.emit('error', {})
    }
    let queries = 0
    const bridge = new SyncBridgeClient({
        endpoint: ENDPOINT,
        token: TOKEN,
        WebSocket: FakeControlSocket,
        permissions: { query: async () => { queries += 1; return { state: 'prompt' } } },
        timeoutMs: 5000
    })
    try {
        await assert.rejects(bridge.connect(), error => {
            assert.ok(error instanceof SyncPermissionRequiredError)
            return true
        })
        assert.equal(FakeControlSocket.instances.length, 1)
        assert.equal(queries, 1, 'only a failed open reads the permission state')
    } finally {
        bridge.close()
    }
})
