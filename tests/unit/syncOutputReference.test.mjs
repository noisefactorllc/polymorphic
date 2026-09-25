import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
    createDefaultSyncConnectionProvider,
    createSyncOutputConnectionProvider,
    SyncOutputController,
    initializeSyncOutputController,
    applyBackoffJitter,
    getSyncOutputController
} from '../../public/js/syncOutput.js'
import { SyncH264CanvasSender } from '../../public/js/syncH264CanvasSender.js'
import { SyncBridgeClient } from '../../public/js/sync/bundle.js'

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

async function flushMicrotasks(turns = 4) {
    for (let turn = 0; turn < turns; turn++) await Promise.resolve()
}

function readyHealth(providerIds = ['syphon']) {
    const ids = Array.isArray(providerIds) ? providerIds : [providerIds]
    return {
        product: 'Sync',
        status: 'ok',
        version: '0.1.0',
        protocolVersions: [1],
        instanceId: 'sync-test',
        capabilities: {
            send: true,
            receive: false,
            providers: ids.map((id) => (
                { id, direction: 'send', available: true, selected: true }
            ))
        }
    }
}

function readyWelcome(providerIds = ['syphon']) {
    return {
        type: 'welcome',
        protocolVersion: 1,
        version: '0.1.0',
        instanceId: 'sync-test',
        capabilities: readyHealth(providerIds).capabilities
    }
}

function scriptedProvider(clients) {
    const calls = []
    let index = 0
    return {
        calls,
        createClient(options) {
            calls.push(['createClient', options])
            const client = clients[index++]
            if (!client) throw new Error('unexpected client creation')
            return client
        }
    }
}

function manualTimers() {
    let nextId = 1
    const intervals = new Map()
    const timeouts = new Map()
    const api = {
        intervals,
        timeouts,
        setInterval(callback, delay) {
            const id = nextId++
            intervals.set(id, { callback, delay })
            return id
        },
        clearInterval(id) {
            intervals.delete(id)
        },
        setTimeout(callback, delay) {
            const id = nextId++
            timeouts.set(id, { callback, delay })
            return id
        },
        clearTimeout(id) {
            timeouts.delete(id)
        },
        fireTimeout(delay) {
            const entry = [...timeouts.entries()].find(([, timer]) => timer.delay === delay)
            assert.ok(entry, `expected a ${delay}ms timeout`)
            const [id, timer] = entry
            timeouts.delete(id)
            timer.callback()
        }
    }
    return api
}

function senderFixture({ stats } = {}) {
    const completion = deferred()
    let closeCalls = 0
    let closed = false
    const sender = {
        stats: stats || {
            accepted: 0,
            droppedBusy: 0,
            droppedBackpressure: 0,
            sent: 0,
            failed: 0
        },
        closed: completion.promise,
        configure() {},
        submit() { return true },
        close() {
            if (closed) return
            closed = true
            closeCalls++
            completion.resolve()
        }
    }
    return {
        sender,
        completion,
        get closeCalls() { return closeCalls }
    }
}

async function connectedFixture({
    renderer,
    getCanvas,
    getDescriptor,
    sender = senderFixture().sender,
    createSender,
    providerIds = ['syphon'],
    welcomeVersion = '0.1.0',
    onStateChange,
    recoveryClients = [],
    timers = manualTimers(),
    clock = { timeOrigin: 1_700_000_000_000 },
    logger,
    random = () => 0
} = {}) {
    const defaultCanvas = { width: 1280, height: 720 }
    const canvasProvider = getCanvas || (() => defaultCanvas)
    const token = 'f'.repeat(64)
    const events = []
    const pairingClient = {
        pair: async (name) => {
            events.push(['pair', name])
            return { protocolVersion: 1, token }
        },
        close: () => events.push('pairing close')
    }
    let clientCloseCalls = 0
    const client = {
        connect: async () => {
            events.push('connect')
            return { ...readyWelcome(providerIds), version: welcomeVersion }
        },
        createSender: createSender || (async (...args) => {
            events.push(['createSender', ...args])
            return sender
        }),
        close() {
            clientCloseCalls++
            events.push('client close')
        }
    }
    const provider = scriptedProvider([pairingClient, client, ...recoveryClients])
    const controller = new SyncOutputController({
        renderer,
        getCanvas: canvasProvider,
        getDescriptor,
        connectionProvider: provider,
        clock,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        logger,
        random,
        onStateChange
    })
    await controller.connect()
    return {
        controller,
        client,
        events,
        provider,
        timers,
        clock,
        get clientCloseCalls() { return clientCloseCalls }
    }
}

function passiveProvider(probeResult) {
    const calls = []
    const client = {
        probe() {
            calls.push('probe')
            return Promise.resolve(probeResult)
        },
        pair() {
            calls.push('pair')
            throw new Error('passive discovery must not pair')
        },
        connect() {
            calls.push('connect')
            throw new Error('passive discovery must not connect')
        },
        close() {
            calls.push('close')
        }
    }
    return {
        calls,
        createClient(options) {
            calls.push(['createClient', options])
            return client
        },
        requestPermission() {
            calls.push('requestPermission')
            throw new Error('passive discovery must not prompt')
        }
    }
}

describe('SyncOutputController passive discovery', () => {
    test('starts idle and reports checking then unavailable after one passive probe', async () => {
        const provider = passiveProvider({
            available: false,
            code: 'SYNC_UNAVAILABLE',
            message: 'Sync daemon did not answer'
        })
        const statuses = []
        const controller = new SyncOutputController({
            connectionProvider: provider,
            onStateChange: (state) => statuses.push(state.status)
        })

        assert.equal(controller.state.status, 'idle')

        await controller.checkAvailability()

        assert.equal(controller.state.status, 'unavailable')
        assert.equal(controller.state.error.code, 'SYNC_UNAVAILABLE')
        assert.equal(controller.state.error.message, 'Sync daemon did not answer')
        assert.deepEqual(statuses, ['checking', 'unavailable'])
        assert.deepEqual(provider.calls, [
            ['createClient', {}],
            'probe',
            'close'
        ])
    })

    test('reports ready with the selected available send provider without pairing or connecting', async () => {
        const provider = passiveProvider({ available: true, health: readyHealth('syphon') })
        const controller = new SyncOutputController({ connectionProvider: provider })

        await controller.checkAvailability()

        assert.equal(controller.state.status, 'ready')
        assert.equal(controller.state.connected, false)
        assert.deepEqual(controller.state.providerIds, ['syphon'])
        assert.deepEqual(provider.calls, [
            ['createClient', {}],
            'probe',
            'close'
        ])
    })

    test('reports both selected send providers, sorted, when Windows exposes Spout and NDI at once', async () => {
        const provider = passiveProvider({ available: true, health: readyHealth(['ndi', 'spout']) })
        const controller = new SyncOutputController({ connectionProvider: provider })

        await controller.checkAvailability()

        assert.equal(controller.state.status, 'ready')
        assert.deepEqual(controller.state.providerIds, ['ndi', 'spout'])
    })

    test('reports an available companion with no selected send provider honestly', async () => {
        const health = readyHealth('syphon')
        health.capabilities.send = false
        health.capabilities.providers[0].available = false
        const provider = passiveProvider({ available: true, health })
        const controller = new SyncOutputController({ connectionProvider: provider })

        await controller.checkAvailability()

        assert.equal(controller.state.status, 'unavailable')
        assert.equal(controller.state.available, true)
        assert.deepEqual(controller.state.providerIds, [])
        assert.deepEqual(controller.state.error, {
            code: 'SYNC_PROVIDER_UNAVAILABLE',
            message: 'Sync has no selected available send providers'
        })
        assert.deepEqual(provider.calls, [
            ['createClient', {}],
            'probe',
            'close'
        ])
    })

    test('coalesces repeated passive checks into one in-flight operation', async () => {
        const pending = deferred()
        const provider = passiveProvider(pending.promise)
        const controller = new SyncOutputController({ connectionProvider: provider })

        const first = controller.checkAvailability()
        const second = controller.checkAvailability()

        assert.equal(first, second)
        assert.equal(controller.state.status, 'checking')
        await flushMicrotasks()
        assert.deepEqual(provider.calls, [
            ['createClient', {}],
            'probe'
        ])

        pending.resolve({ available: true, health: readyHealth('ndi') })
        await first

        assert.equal(controller.state.status, 'ready')
        assert.deepEqual(controller.state.providerIds, ['ndi'])
        assert.deepEqual(provider.calls, [
            ['createClient', {}],
            'probe',
            'close'
        ])
    })
})

describe('SyncOutputController explicit connection', () => {
    test('pairs only on explicit connect, closes the pairing client, and connects a new token client', async () => {
        const token = 'a'.repeat(64)
        const calls = []
        const pairingClient = {
            async pair(name) {
                calls.push(['pair', name])
                return { protocolVersion: 1, token }
            },
            close() {
                calls.push('pairing close')
            }
        }
        const authenticatedClient = {
            async connect() {
                calls.push('connect')
                return readyWelcome('syphon')
            },
            close() {
                calls.push('authenticated close')
            }
        }
        const provider = scriptedProvider([pairingClient, authenticatedClient])
        const statuses = []
        const controller = new SyncOutputController({
            connectionProvider: provider,
            onStateChange: (state) => statuses.push(state.status)
        })

        await controller.connect()

        assert.equal(controller.state.status, 'ready')
        assert.equal(controller.state.available, true)
        assert.equal(controller.state.connected, true)
        assert.deepEqual(controller.state.providerIds, ['syphon'])
        assert.equal(JSON.stringify(controller.state).includes(token), false)
        assert.deepEqual(statuses, ['checking', 'ready'])
        assert.deepEqual(provider.calls, [
            ['createClient', {}],
            ['createClient', { token }]
        ])
        assert.deepEqual(calls, [
            ['pair', 'Polymorphic'],
            'pairing close',
            'connect'
        ])
    })

    test('reports every selected send provider from the welcome, sorted regardless of wire order', async () => {
        const token = 'g'.repeat(64)
        const provider = scriptedProvider([
            { pair: async () => ({ protocolVersion: 1, token }), close() {} },
            { connect: async () => readyWelcome(['spout', 'ndi']), close() {} }
        ])
        const controller = new SyncOutputController({ connectionProvider: provider })

        await controller.connect()

        assert.equal(controller.state.status, 'ready')
        assert.deepEqual(controller.state.providerIds, ['ndi', 'spout'])
    })

    test('coalesces repeated explicit connects without a second pairing attempt', async () => {
        const token = 'b'.repeat(64)
        const pairing = deferred()
        let pairCalls = 0
        const pairingClient = {
            pair() {
                pairCalls++
                return pairing.promise
            },
            close() {}
        }
        const authenticatedClient = {
            connect: async () => readyWelcome('ndi'),
            close() {}
        }
        const provider = scriptedProvider([pairingClient, authenticatedClient])
        const controller = new SyncOutputController({ connectionProvider: provider })

        const first = controller.connect()
        const second = controller.connect()

        assert.equal(first, second)
        assert.equal(controller.state.status, 'checking')
        assert.equal(pairCalls, 0)
        await flushMicrotasks()
        assert.equal(pairCalls, 1)

        pairing.resolve({ protocolVersion: 1, token })
        await first

        assert.equal(controller.state.status, 'ready')
        assert.equal(controller.state.connected, true)
        assert.equal(provider.calls.length, 2)
    })

    test('clears stale authentication without retrying or re-pairing until another explicit connect', async () => {
        const staleToken = 'c'.repeat(64)
        const freshToken = 'd'.repeat(64)
        const calls = []
        const firstPairingClient = {
            pair: async () => {
                calls.push('first pair')
                return { protocolVersion: 1, token: staleToken }
            },
            close: () => calls.push('first pairing close')
        }
        const staleClient = {
            connect: async () => {
                calls.push('stale connect')
                const error = new Error(`credential ${staleToken} was revoked`)
                error.code = 'SYNC_AUTHENTICATION'
                throw error
            },
            close: () => calls.push('stale close')
        }
        const secondPairingClient = {
            pair: async () => {
                calls.push('second pair')
                return { protocolVersion: 1, token: freshToken }
            },
            close: () => calls.push('second pairing close')
        }
        const freshClient = {
            connect: async () => {
                calls.push('fresh connect')
                return readyWelcome('syphon')
            },
            close: () => calls.push('fresh close')
        }
        const provider = scriptedProvider([
            firstPairingClient,
            staleClient,
            secondPairingClient,
            freshClient
        ])
        const controller = new SyncOutputController({ connectionProvider: provider })

        await assert.rejects(controller.connect(), {
            code: 'SYNC_AUTHENTICATION',
            message: 'Sync authentication failed; connect again to pair'
        })

        assert.equal(controller.state.status, 'error')
        assert.equal(controller.state.connected, false)
        assert.equal(JSON.stringify(controller.state).includes(staleToken), false)
        assert.equal(controller.state.error.message.includes(staleToken), false)
        assert.deepEqual(calls, [
            'first pair',
            'first pairing close',
            'stale connect',
            'stale close'
        ])
        assert.equal(provider.calls.length, 2)

        await controller.connect()

        assert.equal(controller.state.status, 'ready')
        assert.equal(controller.state.connected, true)
        assert.deepEqual(calls, [
            'first pair',
            'first pairing close',
            'stale connect',
            'stale close',
            'second pair',
            'second pairing close',
            'fresh connect'
        ])
        assert.deepEqual(provider.calls.slice(2), [
            ['createClient', {}],
            ['createClient', { token: freshToken }]
        ])
    })

    test('default provider constructs only pinned SDK clients and never touches browser storage', () => {
        const constructorOptions = []
        class ClientFixture {
            constructor(options) {
                constructorOptions.push(options)
            }
        }
        const originalLocalStorage = globalThis.localStorage
        const originalSessionStorage = globalThis.sessionStorage
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get() { throw new Error('localStorage must not be read') }
        })
        Object.defineProperty(globalThis, 'sessionStorage', {
            configurable: true,
            get() { throw new Error('sessionStorage must not be read') }
        })
        try {
            const provider = createDefaultSyncConnectionProvider({ Client: ClientFixture })
            provider.createClient({})
            provider.createClient({ token: 'e'.repeat(64) })
        } finally {
            if (originalLocalStorage === undefined) delete globalThis.localStorage
            else Object.defineProperty(globalThis, 'localStorage', {
                configurable: true,
                value: originalLocalStorage
            })
            if (originalSessionStorage === undefined) delete globalThis.sessionStorage
            else Object.defineProperty(globalThis, 'sessionStorage', {
                configurable: true,
                value: originalSessionStorage
            })
        }

        assert.deepEqual(constructorOptions, [{}, { token: 'e'.repeat(64) }])
    })

    test('default provider constructs the pinned SDK client when no test constructor is supplied', () => {
        const provider = createDefaultSyncConnectionProvider()
        const client = provider.createClient({})

        assert.equal(client instanceof SyncBridgeClient, true)
        client.close()
    })

    test('default connection provider injects only external transport beneath each real client', () => {
        const constructions = []
        class RecordingClient {
            constructor(options) { constructions.push(options) }
        }
        const transport = {
            fetch: async () => {},
            WebSocket: class {},
            permissions: null
        }
        const provider = createDefaultSyncConnectionProvider({
            Client: RecordingClient,
            transport
        })
        const token = '7'.repeat(64)

        provider.createClient({ token })

        assert.deepEqual(constructions, [{ ...transport, token }])
    })

    test('createSyncOutputConnectionProvider returns provided provider or creates default with transport', () => {
        const existing = { createClient: () => ({}) }
        assert.equal(createSyncOutputConnectionProvider({ connectionProvider: existing }), existing)

        const created = createSyncOutputConnectionProvider({
            transport: { fetch: async () => {} }
        })
        assert.equal(typeof created.createClient, 'function')
    })

    test('closes a denied pairing client without creating an authenticated client or retrying', async () => {
        let pairingCloses = 0
        let pairCalls = 0
        const error = new Error('pairing denied')
        error.code = 'SYNC_PAIRING_DENIED'
        const provider = scriptedProvider([{
            pair: async () => {
                pairCalls++
                throw error
            },
            close() { pairingCloses++ }
        }])
        const controller = new SyncOutputController({ connectionProvider: provider })

        await assert.rejects(controller.connect(), {
            code: 'SYNC_PAIRING_DENIED',
            message: 'pairing denied'
        })

        assert.equal(pairCalls, 1)
        assert.equal(pairingCloses, 1)
        assert.equal(provider.calls.length, 1)
        assert.equal(controller.state.status, 'error')
        assert.equal(controller.state.connected, false)
    })

    test('rejects a connection with no selected available send provider', async () => {
        let clientCloses = 0
        const token = '1'.repeat(64)
        const provider = scriptedProvider([
            { pair: async () => ({ protocolVersion: 1, token }), close() {} },
            {
                connect: async () => ({
                    ...readyWelcome('syphon'),
                    capabilities: {
                        send: false,
                        receive: false,
                        providers: [
                            { id: 'syphon', direction: 'send', available: false, selected: true }
                        ]
                    }
                }),
                close() { clientCloses++ }
            }
        ])
        const controller = new SyncOutputController({ connectionProvider: provider })

        await assert.rejects(controller.connect(), {
            code: 'SYNC_PROVIDER_UNAVAILABLE',
            message: 'Sync has no selected available send providers'
        })

        assert.equal(controller.state.status, 'error')
        assert.equal(controller.state.connected, false)
        assert.deepEqual(controller.state.providerIds, [])
        assert.equal(clientCloses, 1)
    })
})

describe('SyncOutputController sender start', () => {
    test('validates the sender name as well-formed Unicode within 64 UTF-8 bytes before resources', async (t) => {
        const invalidNames = [
            ['', 'empty'],
            ['x'.repeat(65), '65 ASCII bytes'],
            ['€'.repeat(22), '66 UTF-8 bytes'],
            ['bad\ud800name', 'unpaired high surrogate'],
            ['bad\udc00name', 'unpaired low surrogate'],
            ['line\nbreak', 'control character'],
            ['zero\u200bwidth', 'zero-width formatting character'],
            ['right\u202eto-left', 'bidirectional formatting character']
        ]

        for (const [name, label] of invalidNames) {
            await t.test(`rejects ${label}`, async () => {
                let queueCalls = 0
                let senderCalls = 0
                const renderer = {
                    createFrameExportQueue() {
                        queueCalls++
                        return { close() {} }
                    },
                    addSink() { return () => {} }
                }
                const fixture = await connectedFixture({
                    renderer,
                    createSender: async () => {
                        senderCalls++
                        return senderFixture().sender
                    }
                })

                await assert.rejects(fixture.controller.start(name), {
                    code: 'SYNC_INVALID_SENDER_NAME'
                })
                assert.equal(queueCalls, 0)
                assert.equal(senderCalls, 0)
                assert.equal(fixture.clientCloseCalls, 0)
                assert.equal(fixture.controller.state.status, 'error')
                assert.equal(fixture.controller.state.connected, true)
            })
        }
    })

    test('accepts a well-formed sender name exactly 64 UTF-8 bytes long', async () => {
        const sender = senderFixture()
        const queue = { close() {} }
        const renderer = {
            createFrameExportQueue: () => queue,
            addSink: () => () => {}
        }
        const fixture = await connectedFixture({ renderer, sender: sender.sender })

        await fixture.controller.start('😀'.repeat(16))

        assert.equal(fixture.controller.state.status, 'sending')
    })

    test('requires both renderer seam methods before creating an export queue or sender', async (t) => {
        for (const [label, renderer] of [
            ['addSink', { createFrameExportQueue() { throw new Error('must not create') } }],
            ['createFrameExportQueue', { addSink() { throw new Error('must not add') } }]
        ]) {
            await t.test(`missing ${label}`, async () => {
                let senderCalls = 0
                const fixture = await connectedFixture({
                    renderer,
                    createSender: async () => {
                        senderCalls++
                        return senderFixture().sender
                    }
                })

                await assert.rejects(fixture.controller.start('Polymorphic'), {
                    code: 'SYNC_RENDERER_UNAVAILABLE'
                })
                assert.equal(senderCalls, 0)
                assert.equal(fixture.clientCloseCalls, 1)
                assert.equal(fixture.controller.state.status, 'error')
                assert.equal(fixture.controller.state.connected, false)
            })
        }
    })

    test('creates a three-slot queue, sender, and renderer sink before reporting sending', async () => {
        const senderPending = deferred()
        const sender = senderFixture({
            stats: {
                accepted: 7,
                droppedBusy: 2,
                droppedBackpressure: 3,
                sent: 5,
                failed: 1
            }
        })
        const queue = { close() {} }
        const calls = []
        const statuses = []
        const canvas = { width: 1920, height: 1080 }
        const renderer = {
            createFrameExportQueue(options) {
                calls.push(['queue', options])
                return queue
            },
            addSink(value) {
                calls.push(['addSink', value])
                return () => calls.push('removeSink')
            }
        }
        const fixture = await connectedFixture({
            renderer,
            getCanvas: () => canvas,
            createSender: async (...args) => {
                calls.push(['createSender', ...args])
                return senderPending.promise
            },
            onStateChange: (state) => statuses.push(state.status)
        })

        const starting = fixture.controller.start('Main output')
        assert.equal(fixture.controller.state.status, 'starting')
        assert.equal(statuses.at(-1), 'starting')
        assert.deepEqual(calls, [
            ['queue', { slots: 3 }],
            ['createSender', 'Main output', {
                exportQueue: queue,
                maxBufferedFrames: 1,
                clock: fixture.clock
            }]
        ])

        senderPending.resolve(sender.sender)
        await starting

        assert.equal(fixture.controller.state.status, 'sending')
        assert.deepEqual(fixture.controller.state.providerIds, ['syphon'])
        assert.equal(fixture.controller.state.senderName, 'Main output')
        assert.equal(fixture.controller.state.width, 1920)
        assert.equal(fixture.controller.state.height, 1080)
        assert.equal(fixture.controller.state.fps, 60)
        assert.deepEqual(fixture.controller.state.stats, {
            accepted: 7,
            droppedBusy: 2,
            droppedBackpressure: 3,
            sent: 5,
            failed: 1
        })
        assert.notEqual(fixture.controller.state.stats, sender.sender.stats)
        assert.deepEqual(calls.slice(0, 2), [
            ['queue', { slots: 3 }],
            ['createSender', 'Main output', {
                exportQueue: queue,
                maxBufferedFrames: 1,
                clock: fixture.clock
            }]
        ])
        assert.equal(calls[2][0], 'addSink')
        assert.notEqual(calls[2][1], sender.sender)
        assert.equal(typeof calls[2][1].configure, 'function')
        assert.equal(typeof calls[2][1].submit, 'function')
        assert.equal(typeof calls[2][1].close, 'function')
        assert.deepEqual(statuses.slice(-2), ['starting', 'sending'])
        assert.equal(fixture.timers.intervals.size, 1)
    })

    test('reports the latest successful live sink configuration after resize', async () => {
        const sender = senderFixture()
        const canvas = { width: 800, height: 600 }
        let attachedSink
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink(sink) {
                attachedSink = sink
                return () => sink.close()
            }
        }
        const fixture = await connectedFixture({
            renderer,
            sender: sender.sender,
            getCanvas: () => canvas
        })
        await fixture.controller.start('Resizable output')

        canvas.width = 1280
        canvas.height = 720
        attachedSink.configure({
            width: 1280,
            height: 720,
            format: 'rgba8unorm',
            colorSpace: 'srgb',
            alphaMode: 'premultiplied',
            fps: 30
        })

        assert.equal(fixture.controller.state.width, 1280)
        assert.equal(fixture.controller.state.height, 720)
        assert.equal(fixture.controller.state.fps, 30)
    })

    test('does not classify a sender close after live resize as renderer replacement', async () => {
        const sender = senderFixture()
        const canvas = { width: 800, height: 600 }
        let attachedSink
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink(sink) {
                attachedSink = sink
                return () => sink.close()
            }
        }
        const fixture = await connectedFixture({
            renderer,
            sender: sender.sender,
            getCanvas: () => canvas
        })
        await fixture.controller.start('Resizable output')

        canvas.width = 1280
        canvas.height = 720
        attachedSink.configure({
            width: 1280,
            height: 720,
            format: 'rgba8unorm',
            colorSpace: 'srgb',
            alphaMode: 'premultiplied',
            fps: 60
        })
        sender.completion.resolve()
        await flushMicrotasks()

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_SENDER_CLOSED')
    })

    test('coalesces double-clicked starts and does not attach before sender acquisition finishes', async () => {
        const pending = deferred()
        const sender = senderFixture()
        let queueCalls = 0
        let senderCalls = 0
        let addCalls = 0
        const renderer = {
            createFrameExportQueue() {
                queueCalls++
                return { close() {} }
            },
            addSink() {
                addCalls++
                return () => {}
            }
        }
        const fixture = await connectedFixture({
            renderer,
            createSender: async () => {
                senderCalls++
                return pending.promise
            }
        })

        const first = fixture.controller.start('One')
        const second = fixture.controller.start('Two')
        await Promise.resolve()

        assert.equal(first, second)
        assert.equal(queueCalls, 1)
        assert.equal(senderCalls, 1)
        assert.equal(addCalls, 0)
        assert.equal(fixture.controller.state.status, 'starting')

        pending.resolve(sender.sender)
        await first

        assert.equal(addCalls, 1)
        assert.equal(fixture.controller.state.senderName, 'One')
    })

    test('passes the sender backlog signal through the renderer sink', async () => {
        const sender = senderFixture()
        let backlog = false
        sender.sender.deferRender = () => backlog
        let sink = null
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink: (added) => { sink = added; return () => sender.sender.close() }
        }
        const fixture = await connectedFixture({ renderer, sender: sender.sender })

        await fixture.controller.start('Polymorphic')

        assert.equal(sink.deferRender(), false)
        backlog = true
        assert.equal(sink.deferRender(), true)
        delete sender.sender.deferRender
        assert.equal(sink.deferRender(), false)
        await fixture.controller.stop()
    })

    test('rolls back queue and client exactly once when sender acquisition fails', async () => {
        const calls = []
        const queue = { close: () => calls.push('queue close') }
        const renderer = {
            createFrameExportQueue: () => queue,
            addSink: () => { throw new Error('must not attach') }
        }
        const fixture = await connectedFixture({
            renderer,
            createSender: async () => {
                calls.push('create sender')
                throw new Error('sender rejected')
            }
        })

        await assert.rejects(fixture.controller.start('Polymorphic'), {
            message: 'sender rejected'
        })

        assert.deepEqual(calls, ['create sender', 'queue close'])
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.controller.state.status, 'error')
    })

    test('rolls back sender ownership and client exactly once when renderer attachment fails', async () => {
        const sender = senderFixture()
        let queueCloses = 0
        const queue = { close: () => { queueCloses++ } }
        const renderer = {
            createFrameExportQueue: () => queue,
            addSink: () => { throw new Error('pipeline replaced') }
        }
        const fixture = await connectedFixture({ renderer, sender: sender.sender })

        await assert.rejects(fixture.controller.start('Polymorphic'), {
            message: 'pipeline replaced'
        })

        assert.equal(sender.closeCalls, 1)
        assert.equal(queueCloses, 0)
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.controller.state.status, 'error')
    })

    test('rejects an unavailable export queue without attempting sender creation', async () => {
        let senderCalls = 0
        const renderer = {
            createFrameExportQueue: () => null,
            addSink: () => () => {}
        }
        const fixture = await connectedFixture({
            renderer,
            createSender: async () => {
                senderCalls++
                return senderFixture().sender
            }
        })

        await assert.rejects(fixture.controller.start('Polymorphic'), {
            code: 'SYNC_EXPORT_UNAVAILABLE'
        })

        assert.equal(senderCalls, 0)
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('closes the connected client when export queue creation throws', async () => {
        let senderCalls = 0
        const renderer = {
            createFrameExportQueue() {
                throw new Error('GPU context unavailable')
            },
            addSink: () => () => {}
        }
        const fixture = await connectedFixture({
            renderer,
            createSender: async () => {
                senderCalls++
                return senderFixture().sender
            }
        })

        await assert.rejects(fixture.controller.start('Polymorphic'), {
            message: 'GPU context unavailable'
        })

        assert.equal(senderCalls, 0)
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('reads the current backend canvas at start rather than retaining an earlier canvas', async () => {
        let canvas = { width: 640, height: 360 }
        const sender = senderFixture()
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink: () => () => {}
        }
        const fixture = await connectedFixture({
            renderer,
            sender: sender.sender,
            getCanvas: () => canvas
        })
        canvas = { width: 2048, height: 1024 }

        await fixture.controller.start('Changed backend')

        assert.equal(fixture.controller.state.width, 2048)
        assert.equal(fixture.controller.state.height, 1024)
        assert.equal(fixture.controller.state.fps, 60)
    })

    test('rejects a pipeline replacement while sender acquisition is pending before sink attachment', async () => {
        const canvas = { width: 1280, height: 720 }
        let pipeline = { id: 'webgl pipeline' }
        let queueCloses = 0
        let senderCloses = 0
        let addSinkCalls = 0
        const queue = {
            close() { queueCloses++ }
        }
        const senderCreated = deferred()
        const senderClosed = deferred()
        let senderIsClosed = false
        const sender = {
            stats: { accepted: 0, droppedBusy: 0, droppedBackpressure: 0, sent: 0, failed: 0 },
            closed: senderClosed.promise,
            configure() {},
            submit() { return true },
            close() {
                if (senderIsClosed) return
                senderIsClosed = true
                senderCloses++
                queue.close()
                senderClosed.resolve()
            }
        }
        const renderer = {
            get pipeline() { return pipeline },
            createFrameExportQueue: () => queue,
            addSink() {
                addSinkCalls++
                return () => sender.close()
            }
        }
        const statuses = []
        const fixture = await connectedFixture({
            renderer,
            getCanvas: () => canvas,
            createSender: async () => senderCreated.promise,
            onStateChange: (state) => statuses.push(state.status)
        })

        const starting = fixture.controller.start('Pipeline race')
        assert.equal(fixture.controller.state.status, 'starting')
        pipeline = { id: 'webgpu replacement' }
        senderCreated.resolve(sender)

        await assert.rejects(starting, {
            code: 'SYNC_RENDERER_REPLACED',
            message: 'Renderer backend or context was replaced; start Sync output again'
        })
        await flushMicrotasks()

        assert.equal(addSinkCalls, 0)
        assert.equal(senderCloses, 1)
        assert.equal(queueCloses, 1)
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.timers.timeouts.size, 0)
        assert.equal(statuses.includes('sending'), false)
        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_RENDERER_REPLACED')
    })
})

describe('SyncOutputController live lifecycle', () => {
    test('invokes timer dependencies with the global receiver required by browser timers', async () => {
        const timers = manualTimers()
        for (const name of ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']) {
            const implementation = timers[name]
            timers[name] = function (...args) {
                assert.equal(this, globalThis)
                return implementation(...args)
            }
        }
        const sender = senderFixture()
        const fixture = await connectedFixture({
            timers,
            sender: sender.sender,
            renderer: {
                createFrameExportQueue: () => ({ close() {} }),
                addSink: () => () => sender.sender.close()
            }
        })

        await fixture.controller.start('Browser timer receiver')
        await fixture.controller.stop()

        assert.equal(fixture.controller.state.status, 'ready')
        assert.equal(timers.intervals.size, 0)
        assert.equal(timers.timeouts.size, 0)
    })

    test('does not probe, reconnect, or create another sender while already sending', async () => {
        const sender = senderFixture()
        let queueCalls = 0
        let senderCalls = 0
        const renderer = {
            createFrameExportQueue() {
                queueCalls++
                return { close() {} }
            },
            addSink: () => () => sender.sender.close()
        }
        const fixture = await connectedFixture({
            renderer,
            sender: sender.sender,
            createSender: async () => {
                senderCalls++
                return sender.sender
            }
        })
        await fixture.controller.start('Live guard')
        const providerCalls = fixture.provider.calls.length

        const checkResult = await fixture.controller.checkAvailability()
        const connectResult = await fixture.controller.connect()
        const startResult = await fixture.controller.start('Duplicate')

        assert.equal(checkResult.status, 'sending')
        assert.equal(connectResult.status, 'sending')
        assert.equal(startResult.status, 'sending')
        assert.equal(fixture.controller.state.status, 'sending')
        assert.equal(fixture.controller.state.senderName, 'Live guard')
        assert.equal(fixture.provider.calls.length, providerCalls)
        assert.equal(queueCalls, 1)
        assert.equal(senderCalls, 1)
        assert.equal(fixture.timers.intervals.size, 1)
    })

    test('coalesces every public action with the in-flight start operation', async () => {
        const pending = deferred()
        const sender = senderFixture()
        let queueCalls = 0
        let senderCalls = 0
        let removeCalls = 0
        const renderer = {
            createFrameExportQueue() {
                queueCalls++
                return { close() {} }
            },
            addSink: () => () => { removeCalls++ }
        }
        const fixture = await connectedFixture({
            renderer,
            createSender: async () => {
                senderCalls++
                return pending.promise
            }
        })
        const providerCalls = fixture.provider.calls.length

        const starting = fixture.controller.start('Starting guard')
        assert.equal(fixture.controller.checkAvailability(), starting)
        assert.equal(fixture.controller.connect(), starting)
        assert.equal(fixture.controller.start('Duplicate'), starting)
        assert.equal(fixture.controller.stop(), starting)
        assert.equal(fixture.controller.state.status, 'starting')
        assert.equal(fixture.provider.calls.length, providerCalls)
        assert.equal(queueCalls, 1)
        assert.equal(senderCalls, 1)
        assert.equal(removeCalls, 0)

        pending.resolve(sender.sender)
        await starting
        assert.equal(fixture.controller.state.status, 'sending')
    })

    test('coalesces every public action with the in-flight stop operation', async () => {
        const completion = deferred()
        const sender = {
            stats: { accepted: 0, droppedBusy: 0, droppedBackpressure: 0, sent: 0, failed: 0 },
            closed: completion.promise,
            configure() {},
            submit() { return true },
            close() {}
        }
        let queueCalls = 0
        let senderCalls = 0
        let removeCalls = 0
        const renderer = {
            createFrameExportQueue() {
                queueCalls++
                return { close() {} }
            },
            addSink: () => () => {
                removeCalls++
                sender.close()
            }
        }
        const fixture = await connectedFixture({
            renderer,
            sender,
            createSender: async () => {
                senderCalls++
                return sender
            }
        })
        await fixture.controller.start('Stopping guard')
        const providerCalls = fixture.provider.calls.length
        const stopping = fixture.controller.stop()

        assert.equal(fixture.controller.checkAvailability(), stopping)
        assert.equal(fixture.controller.connect(), stopping)
        assert.equal(fixture.controller.start('Duplicate'), stopping)
        assert.equal(fixture.controller.stop(), stopping)
        assert.equal(fixture.controller.state.status, 'stopping')
        assert.equal(fixture.provider.calls.length, providerCalls)
        assert.equal(queueCalls, 1)
        assert.equal(senderCalls, 1)
        assert.equal(removeCalls, 1)

        completion.resolve()
        await stopping
        assert.equal(fixture.controller.state.status, 'ready')
    })

    test('stops in renderer-remove, sender-closed, client-close order and transitions once', async () => {
        const completion = deferred()
        const events = []
        let senderCloseCalls = 0
        const sender = {
            stats: { accepted: 1, droppedBusy: 0, droppedBackpressure: 0, sent: 1, failed: 0 },
            closed: completion.promise,
            configure() {},
            submit() { return true },
            close() {
                senderCloseCalls++
                events.push('sender close')
            }
        }
        let removeCalls = 0
        const renderer = {
            createFrameExportQueue: () => ({ close() { events.push('queue close') } }),
            addSink: () => () => {
                removeCalls++
                events.push('renderer remove')
                sender.close()
            }
        }
        const statuses = []
        const fixture = await connectedFixture({
            renderer,
            sender,
            onStateChange: (state) => statuses.push(state.status)
        })
        await fixture.controller.start('Ordered stop')
        const priorEvents = fixture.events.length

        const stopping = fixture.controller.stop()
        const duplicate = fixture.controller.stop()

        assert.equal(stopping, duplicate)
        assert.equal(fixture.controller.state.status, 'stopping')
        assert.equal(removeCalls, 1)
        assert.equal(senderCloseCalls, 1)
        assert.deepEqual(events, ['renderer remove', 'sender close'])
        assert.equal(fixture.events.length, priorEvents)
        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.timers.timeouts.size, 1)

        completion.resolve()
        await stopping

        assert.equal(fixture.clientCloseCalls, 1)
        assert.deepEqual(fixture.events.slice(priorEvents), ['client close'])
        assert.equal(fixture.controller.state.status, 'ready')
        assert.equal(fixture.controller.state.connected, false)
        assert.deepEqual(statuses.slice(-2), ['stopping', 'ready'])
        assert.equal(statuses.filter((status) => status === 'ready').length, 2)
        assert.equal(fixture.timers.timeouts.size, 0)
    })

    test('uses a bounded sender-close deadline then closes the client and clears every timer', async () => {
        const completion = deferred()
        const events = []
        const sender = {
            stats: { accepted: 0, droppedBusy: 0, droppedBackpressure: 0, sent: 0, failed: 0 },
            closed: completion.promise,
            configure() {},
            submit() { return true },
            close() { events.push('sender close') }
        }
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink: () => () => {
                events.push('renderer remove')
                sender.close()
            }
        }
        const fixture = await connectedFixture({ renderer, sender })
        await fixture.controller.start('Bounded stop')

        const stopping = fixture.controller.stop()
        assert.deepEqual(events, ['renderer remove', 'sender close'])
        assert.equal(fixture.clientCloseCalls, 0)
        const [{ callback, delay }] = [...fixture.timers.timeouts.values()]
        assert.equal(delay, 3000)

        callback()
        await assert.rejects(stopping, {
            code: 'SYNC_STOP_TIMEOUT',
            message: 'Sync sender did not close within 3000ms'
        })

        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.connected, false)
        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.timers.timeouts.size, 0)
    })

    test('cleans up after a remote sender close with a specific error and no live monitor', async () => {
        const sender = senderFixture()
        let removeCalls = 0
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink: () => () => {
                removeCalls++
                sender.sender.close()
            }
        }
        const fixture = await connectedFixture({ renderer, sender: sender.sender })
        await fixture.controller.start('Remote close')

        sender.completion.resolve()
        await flushMicrotasks()

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_SENDER_CLOSED')
        assert.equal(fixture.controller.state.error.message, 'Sync sender connection closed; connect and start again')
        assert.equal(fixture.controller.state.connected, false)
        assert.equal(removeCalls, 1)
        assert.equal(sender.closeCalls, 1)
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)

        await flushMicrotasks()
        assert.equal(removeCalls, 1)
        assert.equal(sender.closeCalls, 1)
        assert.equal(fixture.clientCloseCalls, 1)
    })

    test('identifies a backend canvas replacement when the live sink closes', async () => {
        const sender = senderFixture()
        const firstCanvas = { width: 800, height: 600 }
        let canvas = firstCanvas
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink: () => () => sender.sender.close()
        }
        const fixture = await connectedFixture({
            renderer,
            sender: sender.sender,
            getCanvas: () => canvas
        })
        await fixture.controller.start('Backend switch')

        canvas = { width: 800, height: 600 }
        sender.completion.resolve()
        await flushMicrotasks()

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_RENDERER_REPLACED')
        assert.equal(
            fixture.controller.state.error.message,
            'Renderer backend or context was replaced; start Sync output again'
        )
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('identifies a same-canvas same-dimensions pipeline replacement when the live sink closes', async () => {
        const canvas = { width: 800, height: 600 }
        let pipeline = { id: 'first pipeline' }
        let queueCloses = 0
        let senderCloses = 0
        let removeCalls = 0
        const queue = { close() { queueCloses++ } }
        const completion = deferred()
        let senderIsClosed = false
        const sender = {
            stats: { accepted: 0, droppedBusy: 0, droppedBackpressure: 0, sent: 0, failed: 0 },
            closed: completion.promise,
            configure() {},
            submit() { return true },
            close() {
                if (senderIsClosed) return
                senderIsClosed = true
                senderCloses++
                queue.close()
                completion.resolve()
            }
        }
        const renderer = {
            get pipeline() { return pipeline },
            createFrameExportQueue: () => queue,
            addSink: () => () => {
                removeCalls++
                sender.close()
            }
        }
        const fixture = await connectedFixture({
            renderer,
            sender,
            getCanvas: () => canvas
        })
        await fixture.controller.start('Pipeline switch')

        pipeline = { id: 'replacement pipeline' }
        completion.resolve()
        await flushMicrotasks()

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_RENDERER_REPLACED')
        assert.equal(
            fixture.controller.state.error.message,
            'Renderer backend or context was replaced; start Sync output again'
        )
        assert.equal(removeCalls, 1)
        assert.equal(senderCloses, 1)
        assert.equal(queueCloses, 1)
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('treats a renderer pipeline getter failure during live close as replacement', async () => {
        const canvas = { width: 800, height: 600 }
        const pipeline = { id: 'initial pipeline' }
        let getterFails = false
        const sender = senderFixture()
        const renderer = {
            get pipeline() {
                if (getterFails) throw new Error('context unavailable')
                return pipeline
            },
            createFrameExportQueue: () => ({ close() {} }),
            addSink: () => () => sender.sender.close()
        }
        const fixture = await connectedFixture({
            renderer,
            sender: sender.sender,
            getCanvas: () => canvas
        })
        await fixture.controller.start('Getter failure')

        getterFails = true
        sender.completion.resolve()
        await flushMicrotasks()

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_RENDERER_REPLACED')
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('publishes exact copied stats only while sending and clears the interval on stop', async () => {
        const sender = senderFixture({
            stats: { accepted: 1, droppedBusy: 2, droppedBackpressure: 3, sent: 4, failed: 5 }
        })
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink: () => () => sender.sender.close()
        }
        const fixture = await connectedFixture({ renderer, sender: sender.sender })
        await fixture.controller.start('Stats')
        const [{ callback }] = [...fixture.timers.intervals.values()]

        sender.sender.stats.accepted = 9
        sender.sender.stats.droppedBusy = 8
        sender.sender.stats.droppedBackpressure = 7
        sender.sender.stats.sent = 6
        sender.sender.stats.failed = 5
        callback()

        assert.deepEqual(fixture.controller.state.stats, {
            accepted: 9,
            droppedBusy: 8,
            droppedBackpressure: 7,
            sent: 6,
            failed: 5
        })
        assert.notEqual(fixture.controller.state.stats, sender.sender.stats)
        sender.sender.stats.sent = 100
        assert.equal(fixture.controller.state.stats.sent, 6)

        await fixture.controller.stop()

        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.controller.state.stats.sent, 100)
        sender.sender.stats.sent = 101
        callback()
        assert.equal(fixture.controller.state.stats.sent, 100)
    })

    test('always closes the client when renderer removal reports a failure', async () => {
        const sender = senderFixture()
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink: () => () => {
                sender.sender.close()
                throw new Error('remove failed')
            }
        }
        const fixture = await connectedFixture({ renderer, sender: sender.sender })
        await fixture.controller.start('Cleanup')

        await assert.rejects(fixture.controller.stop(), { message: 'remove failed' })

        assert.equal(sender.closeCalls, 1)
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.timers.timeouts.size, 0)
    })

    test('falls back to sender close when renderer removal throws before closing it', async () => {
        const completion = deferred()
        const events = []
        let senderCloseCalls = 0
        const sender = {
            stats: { accepted: 0, droppedBusy: 0, droppedBackpressure: 0, sent: 0, failed: 0 },
            closed: completion.promise,
            configure() {},
            submit() { return true },
            close() {
                senderCloseCalls++
                events.push('sender close fallback')
            }
        }
        const renderer = {
            createFrameExportQueue: () => ({ close() {} }),
            addSink: () => () => {
                events.push('renderer remove')
                throw new Error('remove failed before close')
            }
        }
        const fixture = await connectedFixture({ renderer, sender })
        await fixture.controller.start('Removal fallback')

        const stopping = fixture.controller.stop()
        assert.deepEqual(events, ['renderer remove', 'sender close fallback'])
        assert.equal(senderCloseCalls, 1)
        assert.equal(fixture.clientCloseCalls, 0)
        assert.equal(fixture.timers.timeouts.size, 1)

        const [{ callback }] = [...fixture.timers.timeouts.values()]
        callback()
        await assert.rejects(stopping, { message: 'remove failed before close' })

        assert.equal(senderCloseCalls, 1)
        assert.equal(fixture.clientCloseCalls, 1)
        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_STOP_FAILED')
        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.timers.timeouts.size, 0)
    })

    test('dispose closes an in-flight pairing client and prevents a late token from connecting', async () => {
        const pendingPair = deferred()
        let pairingCloses = 0
        let authenticatedCreations = 0
        const controller = new SyncOutputController({
            connectionProvider: {
                createClient(options) {
                    if (Object.hasOwn(options, 'token')) {
                        authenticatedCreations++
                        throw new Error('late pairing must not create an authenticated client')
                    }
                    return {
                        pair: () => pendingPair.promise,
                        close() { pairingCloses++ }
                    }
                }
            }
        })

        const connecting = controller.connect()
        await flushMicrotasks()
        controller.dispose()
        controller.dispose()

        assert.equal(pairingCloses, 1)
        pendingPair.resolve({ protocolVersion: 1, token: 'd'.repeat(64) })
        await assert.rejects(connecting, { code: 'SYNC_LIFECYCLE' })
        assert.equal(authenticatedCreations, 0)
        assert.equal(controller.state.connected, false)
    })

    test('immediate dispose closes synchronously tracked client without yielding microtasks', async () => {
        const pendingPair = deferred()
        let pairingCloses = 0
        const controller = new SyncOutputController({
            connectionProvider: {
                createClient() {
                    return {
                        pair: () => pendingPair.promise,
                        close() { pairingCloses++ }
                    }
                }
            }
        })

        const connecting = controller.connect()
        controller.dispose()

        assert.equal(pairingCloses, 1)
        pendingPair.resolve({ protocolVersion: 1, token: 'a'.repeat(64) })
        await assert.rejects(connecting, { code: 'SYNC_LIFECYCLE' })
    })

    test('dispose closes an in-flight authenticated client and ignores its late welcome', async () => {
        const pendingWelcome = deferred()
        let authenticatedCloses = 0
        const clients = [
            {
                async pair() { return { protocolVersion: 1, token: 'e'.repeat(64) } },
                close() {}
            },
            {
                connect: () => pendingWelcome.promise,
                close() { authenticatedCloses++ }
            }
        ]
        const controller = new SyncOutputController({
            connectionProvider: { createClient: () => clients.shift() }
        })

        const connecting = controller.connect()
        await flushMicrotasks(8)
        controller.dispose()

        assert.equal(authenticatedCloses, 1)
        pendingWelcome.resolve(readyWelcome())
        await assert.rejects(connecting, { code: 'SYNC_LIFECYCLE' })
        assert.equal(controller.state.connected, false)
    })

    test('dispose releases a pending start queue and closes the late sender exactly once', async () => {
        const pendingSender = deferred()
        const senderClosed = deferred()
        const canvas = { width: 1280, height: 720 }
        let queueCloses = 0
        let senderCloses = 0
        let clientCloses = 0
        let sinkAttachments = 0
        const sender = {
            closed: senderClosed.promise,
            stats: { accepted: 0, droppedBusy: 0, droppedBackpressure: 0, sent: 0, failed: 0 },
            configure() {},
            submit() { return true },
            close() {
                senderCloses++
                senderClosed.resolve()
            }
        }
        const clients = [
            {
                async pair() { return { protocolVersion: 1, token: 'f'.repeat(64) } },
                close() {}
            },
            {
                async connect() { return readyWelcome() },
                createSender: () => pendingSender.promise,
                close() { clientCloses++ }
            }
        ]
        const controller = new SyncOutputController({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() { queueCloses++ } }),
                addSink() {
                    sinkAttachments++
                    return () => {}
                }
            },
            getCanvas: () => canvas,
            connectionProvider: { createClient: () => clients.shift() }
        })
        await controller.connect()

        const starting = controller.start('Pending sender')
        await flushMicrotasks()
        controller.dispose()

        assert.equal(queueCloses, 1)
        assert.equal(clientCloses, 1)
        pendingSender.resolve(sender)
        await assert.rejects(starting, { code: 'SYNC_LIFECYCLE' })
        assert.equal(senderCloses, 1)
        assert.equal(sinkAttachments, 0)
        assert.notEqual(controller.state.status, 'sending')
    })

    test('dispose tears down a live sender once and is idempotent', async () => {
        const events = []
        const sender = senderFixture()
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() { events.push('queue close') } }),
                addSink: (sink) => () => {
                    events.push('sink removed')
                    sink.close()
                }
            },
            sender: {
                ...sender.sender,
                close() {
                    events.push('sender close')
                    sender.sender.close()
                }
            }
        })
        await fixture.controller.start('Live sender')

        fixture.controller.dispose()
        fixture.controller.dispose()

        assert.equal(events.filter((event) => event === 'sink removed').length, 1)
        assert.equal(events.filter((event) => event === 'sender close').length, 1)
        assert.equal(fixture.events.filter((event) => event === 'client close').length, 1)
        assert.equal(fixture.controller.state.connected, false)
        assert.equal(fixture.controller.state.senderName, null)
        await assert.rejects(fixture.controller.checkAvailability(), { code: 'SYNC_LIFECYCLE' })
        await assert.rejects(fixture.controller.connect(), { code: 'SYNC_LIFECYCLE' })
        await assert.rejects(fixture.controller.start('Late'), { code: 'SYNC_LIFECYCLE' })
    })
})

function senderLoss(closeCode, closeReason = '') {
    const error = new Error('private transport detail')
    error.code = 'SYNC_SENDER_LOST'
    error.closeCode = closeCode
    error.closeReason = closeReason
    return error
}

function recoveryProbe(result, events = []) {
    return {
        async probe() {
            events.push('probe')
            return result
        },
        pair() {
            events.push('pair')
            throw new Error('automatic recovery must not pair')
        },
        close() { events.push('probe close') }
    }
}

function recoveryConnection({ sender, providerIds = ['syphon'], events = [], connect } = {}) {
    return {
        async connect() {
            events.push('connect')
            return connect ? connect() : readyWelcome(providerIds)
        },
        async createSender(...args) {
            events.push(['createSender', ...args])
            return sender
        },
        pair() {
            events.push('pair')
            throw new Error('automatic recovery must not pair')
        },
        close() { events.push('connection close') }
    }
}

describe('SyncOutputController bounded recovery', () => {
    test('reconstructs off-side after 250ms with the same token, provider, name, descriptor, and renderer', async () => {
        const initial = senderFixture()
        const replacement = senderFixture({
            stats: { accepted: 3, droppedBusy: 1, droppedBackpressure: 2, sent: 2, failed: 0 }
        })
        const recoveryEvents = []
        const canvas = { width: 1920, height: 1080 }
        const pipeline = { id: 'stable pipeline' }
        const queues = []
        const sinks = []
        const renderer = {
            pipeline,
            createFrameExportQueue(options) {
                const queue = { options, close() {} }
                queues.push(queue)
                return queue
            },
            addSink(sink) {
                sinks.push(sink)
                return () => sink.close()
            }
        }
        const probe = recoveryProbe({ available: true, health: readyHealth() }, recoveryEvents)
        const connection = recoveryConnection({ sender: replacement.sender, events: recoveryEvents })
        const fixture = await connectedFixture({
            renderer,
            getCanvas: () => canvas,
            sender: initial.sender,
            recoveryClients: [probe, connection]
        })
        await fixture.controller.start('Main output')

        initial.completion.reject(senderLoss(1013, 'inbound_budget_exhausted'))
        await flushMicrotasks()

        assert.equal(fixture.controller.state.status, 'recovering')
        assert.equal(fixture.controller.state.connected, false)
        assert.equal(fixture.controller.state.senderName, 'Main output')
        assert.equal(fixture.controller.state.width, 1920)
        assert.equal(fixture.controller.state.height, 1080)
        assert.equal(fixture.timers.intervals.size, 0)
        assert.deepEqual([...fixture.timers.timeouts.values()].map(({ delay }) => delay), [250])

        fixture.timers.fireTimeout(250)
        await flushMicrotasks(12)

        assert.equal(fixture.controller.state.status, 'sending')
        assert.equal(fixture.controller.state.connected, true)
        assert.deepEqual(fixture.controller.state.providerIds, ['syphon'])
        assert.equal(fixture.controller.state.senderName, 'Main output')
        assert.equal(queues.length, 2)
        assert.equal(sinks.length, 2)
        assert.equal(fixture.timers.intervals.size, 1)
        assert.deepEqual([...fixture.timers.timeouts.values()].map(({ delay }) => delay), [60_000])
        assert.deepEqual(recoveryEvents.map((event) => Array.isArray(event) ? event[0] : event), [
            'probe', 'probe close', 'connect', 'createSender'
        ])
        assert.deepEqual(fixture.provider.calls.map(([, options]) => options), [
            {},
            { token: 'f'.repeat(64) },
            {},
            { token: 'f'.repeat(64) }
        ])
        assert.equal(fixture.events.filter((event) => Array.isArray(event) && event[0] === 'pair').length, 1)
    })

    test('recovery succeeds when a multi-provider set is unchanged, in any wire order', async () => {
        const initial = senderFixture()
        const replacement = senderFixture()
        const probe = recoveryProbe({ available: true, health: readyHealth(['ndi', 'spout']) })
        const connection = recoveryConnection({ sender: replacement.sender, providerIds: ['spout', 'ndi'] })
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            providerIds: ['spout', 'ndi'],
            recoveryClients: [probe, connection]
        })
        await fixture.controller.start('Two providers')
        assert.deepEqual(fixture.controller.state.providerIds, ['ndi', 'spout'])

        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks(12)

        assert.equal(fixture.controller.state.status, 'sending')
        assert.deepEqual(fixture.controller.state.providerIds, ['ndi', 'spout'])
    })

    test('recovery fails with SYNC_PROVIDER_REPLACED when a provider is added mid-session', async () => {
        const initial = senderFixture()
        const probe = recoveryProbe({ available: true, health: readyHealth(['ndi', 'syphon']) })
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            providerIds: ['syphon'],
            recoveryClients: [probe]
        })
        await fixture.controller.start('Provider added')

        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks(12)

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_PROVIDER_REPLACED')
        assert.equal(fixture.timers.timeouts.size, 0)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('recovery fails with SYNC_PROVIDER_REPLACED when a provider disappears mid-session', async () => {
        const initial = senderFixture()
        const probe = recoveryProbe({ available: true, health: readyHealth(['syphon']) })
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            providerIds: ['ndi', 'syphon'],
            recoveryClients: [probe]
        })
        await fixture.controller.start('Provider removed')

        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks(12)

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_PROVIDER_REPLACED')
        assert.equal(fixture.timers.timeouts.size, 0)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('continues transport recovery after 250ms, 1000ms, and 4000ms', async () => {
        const initial = senderFixture()
        const unavailable = () => recoveryProbe({
            available: false,
            code: 'SYNC_UNAVAILABLE',
            message: 'private helper detail'
        })
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            recoveryClients: [unavailable(), unavailable(), unavailable()]
        })
        await fixture.controller.start('Ceiling')
        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()

        for (const delay of [250, 1000, 4000]) {
            assert.deepEqual([...fixture.timers.timeouts.values()].map((timer) => timer.delay), [delay])
            fixture.timers.fireTimeout(delay)
            await flushMicrotasks(12)
        }

        assert.equal(fixture.controller.state.status, 'recovering')
        assert.equal(fixture.controller.state.error, null)
        assert.deepEqual([...fixture.timers.timeouts.values()].map(timer => timer.delay), [10_000])
        await fixture.controller.stop()
        assert.equal(fixture.timers.timeouts.size, 0)
        assert.equal(fixture.timers.intervals.size, 0)
        assert.equal(fixture.provider.calls.length, 5)
    })

    test('retains retry consumption before 60 seconds and resets it at the probation boundary', async () => {
        const initial = senderFixture()
        const replacementOne = senderFixture()
        const replacementTwo = senderFixture()
        const recoveryClients = [
            recoveryProbe({ available: true, health: readyHealth() }),
            recoveryConnection({ sender: replacementOne.sender }),
            recoveryProbe({ available: true, health: readyHealth() }),
            recoveryConnection({ sender: replacementTwo.sender })
        ]
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            recoveryClients
        })
        await fixture.controller.start('Probation')

        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks(12)
        assert.deepEqual([...fixture.timers.timeouts.values()].map((timer) => timer.delay), [60_000])

        replacementOne.completion.reject(senderLoss(1011))
        await flushMicrotasks()
        assert.deepEqual([...fixture.timers.timeouts.values()].map((timer) => timer.delay), [1000])
        fixture.timers.fireTimeout(1000)
        await flushMicrotasks(12)

        fixture.timers.fireTimeout(60_000)
        await flushMicrotasks()
        replacementTwo.completion.reject(senderLoss(1013))
        await flushMicrotasks()
        assert.deepEqual([...fixture.timers.timeouts.values()].map((timer) => timer.delay), [250])
    })

    test('retries only bounded transport and exact incomplete-frame failures', async (t) => {
        const retryable = [
            senderLoss(null),
            senderLoss(1005),
            senderLoss(1006),
            senderLoss(1011),
            senderLoss(1013, 'inbound_budget_exhausted'),
            senderLoss(1008, 'incomplete_frame_timeout'),
            Object.assign(new Error('gone'), { code: 'SYNC_UNAVAILABLE' }),
            Object.assign(new Error('late'), { code: 'SYNC_TIMEOUT' }),
            Object.assign(new Error('control gone'), { code: 'SYNC_LIFECYCLE' })
        ]
        const terminal = [
            senderLoss(1000),
            senderLoss(1008, 'unrelated_policy'),
            senderLoss(1002, 'protocol'),
            Object.assign(new Error('denied'), { code: 'SYNC_AUTHENTICATION' }),
            Object.assign(new Error('permission'), { code: 'SYNC_PERMISSION_DENIED' }),
            Object.assign(new Error('protocol'), { code: 'SYNC_PROTOCOL' }),
            Object.assign(new Error('capability'), { code: 'SYNC_CAPABILITY' }),
            Object.assign(new Error('configuration'), { code: 'SYNC_CONFIGURATION' })
        ]

        for (const [index, error] of retryable.entries()) {
            await t.test(`retryable ${index}`, async () => {
                const live = senderFixture()
                const fixture = await connectedFixture({
                    renderer: {
                        pipeline: {},
                        createFrameExportQueue: () => ({ close() {} }),
                        addSink: (sink) => () => sink.close()
                    },
                    sender: live.sender
                })
                await fixture.controller.start('Retry classification')
                live.completion.reject(error)
                await flushMicrotasks()
                assert.equal(fixture.controller.state.status, 'recovering')
                assert.deepEqual([...fixture.timers.timeouts.values()].map((timer) => timer.delay), [250])
                await fixture.controller.stop()
            })
        }

        for (const [index, error] of terminal.entries()) {
            await t.test(`terminal ${index}`, async () => {
                const live = senderFixture()
                const fixture = await connectedFixture({
                    renderer: {
                        pipeline: {},
                        createFrameExportQueue: () => ({ close() {} }),
                        addSink: (sink) => () => sink.close()
                    },
                    sender: live.sender
                })
                await fixture.controller.start('Terminal classification')
                live.completion.reject(error)
                await flushMicrotasks()
                assert.equal(fixture.controller.state.status, 'error')
                assert.equal(fixture.controller.state.error.code, 'SYNC_SENDER_CLOSED')
                assert.equal(fixture.timers.timeouts.size, 0)
            })
        }
    })

    test('Stop cancels a scheduled attempt and an in-flight passive probe without later resurrection', async () => {
        const initial = senderFixture()
        const pendingProbe = deferred()
        let probeCloseCalls = 0
        const probe = {
            probe: () => pendingProbe.promise,
            pair() { throw new Error('must not pair') },
            close() { probeCloseCalls++ }
        }
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            recoveryClients: [probe]
        })
        await fixture.controller.start('Cancellation')
        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks()

        await fixture.controller.stop()
        assert.equal(fixture.controller.state.status, 'ready')
        assert.equal(fixture.controller.state.senderName, null)
        assert.equal(probeCloseCalls, 1)
        assert.equal(fixture.timers.timeouts.size, 0)
        assert.equal(fixture.timers.intervals.size, 0)

        pendingProbe.resolve({ available: true, health: readyHealth() })
        await flushMicrotasks(12)
        assert.equal(fixture.controller.state.status, 'ready')
        assert.equal(fixture.provider.calls.length, 3)
    })

    test('Stop closes an in-flight authenticated connection before its late welcome can create a sender', async () => {
        const initial = senderFixture()
        const pendingConnect = deferred()
        let connectionCloses = 0
        let senderCalls = 0
        const connection = {
            connect: () => pendingConnect.promise,
            createSender() {
                senderCalls++
                throw new Error('late connect must not create a sender')
            },
            close() { connectionCloses++ }
        }
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            recoveryClients: [
                recoveryProbe({ available: true, health: readyHealth() }),
                connection
            ]
        })
        await fixture.controller.start('Connect cancellation')
        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks(8)

        await fixture.controller.stop()
        assert.equal(connectionCloses, 1)
        pendingConnect.resolve(readyWelcome())
        await flushMicrotasks(12)

        assert.equal(senderCalls, 0)
        assert.equal(fixture.controller.state.status, 'ready')
        assert.equal(fixture.timers.timeouts.size, 0)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('Stop during sender creation closes its queue immediately and the late sender exactly once', async () => {
        const initial = senderFixture()
        const replacement = senderFixture()
        const pendingSender = deferred()
        let queueNumber = 0
        let recoveryQueueCloses = 0
        let connectionCloses = 0
        const renderer = {
            pipeline: {},
            createFrameExportQueue() {
                queueNumber++
                return {
                    close() {
                        if (queueNumber === 2) recoveryQueueCloses++
                    }
                }
            },
            addSink: (sink) => () => sink.close()
        }
        const connection = {
            connect: async () => readyWelcome(),
            createSender: () => pendingSender.promise,
            close() { connectionCloses++ }
        }
        const fixture = await connectedFixture({
            renderer,
            sender: initial.sender,
            recoveryClients: [
                recoveryProbe({ available: true, health: readyHealth() }),
                connection
            ]
        })
        await fixture.controller.start('Sender cancellation')
        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks(12)

        await fixture.controller.stop()
        assert.equal(recoveryQueueCloses, 1)
        assert.equal(connectionCloses, 1)
        pendingSender.resolve(replacement.sender)
        await flushMicrotasks(12)

        assert.equal(replacement.closeCalls, 1)
        assert.equal(fixture.controller.state.status, 'ready')
        assert.equal(fixture.timers.timeouts.size, 0)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('a Stop re-entered from sink attachment removes the late handle and cannot publish LIVE', async () => {
        const initial = senderFixture()
        const replacement = senderFixture()
        let controller
        let attachCalls = 0
        let recoveryRemoveCalls = 0
        const renderer = {
            pipeline: {},
            createFrameExportQueue: () => ({ close() {} }),
            addSink(sink) {
                attachCalls++
                if (attachCalls === 2) void controller.stop()
                return () => {
                    if (attachCalls === 2) recoveryRemoveCalls++
                    sink.close()
                }
            }
        }
        const fixture = await connectedFixture({
            renderer,
            sender: initial.sender,
            recoveryClients: [
                recoveryProbe({ available: true, health: readyHealth() }),
                recoveryConnection({ sender: replacement.sender })
            ]
        })
        controller = fixture.controller
        await controller.start('Attach cancellation')
        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks(12)

        assert.equal(controller.state.status, 'ready')
        assert.equal(recoveryRemoveCalls, 1)
        assert.equal(replacement.closeCalls, 1)
        assert.equal(fixture.timers.timeouts.size, 0)
        assert.equal(fixture.timers.intervals.size, 0)
    })

    test('authentication denial is terminal, redacted, and requires the next explicit connect to pair', async () => {
        const initial = senderFixture()
        const secret = 'credential-must-not-escape'
        const denied = {
            async connect() {
                throw Object.assign(new Error(secret), { code: 'SYNC_AUTHENTICATION' })
            },
            createSender() { throw new Error('must not create') },
            close() {}
        }
        let freshPairCalls = 0
        const freshToken = 'e'.repeat(64)
        const freshPairing = {
            async pair() {
                freshPairCalls++
                return { protocolVersion: 1, token: freshToken }
            },
            close() {}
        }
        const freshConnection = {
            connect: async () => readyWelcome(),
            close() {}
        }
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            recoveryClients: [
                recoveryProbe({ available: true, health: readyHealth() }),
                denied,
                freshPairing,
                freshConnection
            ]
        })
        await fixture.controller.start('Authentication')
        initial.completion.reject(senderLoss(1006))
        await flushMicrotasks()
        fixture.timers.fireTimeout(250)
        await flushMicrotasks(12)

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.controller.state.error.code, 'SYNC_AUTHENTICATION')
        assert.equal(JSON.stringify(fixture.controller.state).includes(secret), false)
        assert.equal(fixture.timers.timeouts.size, 0)

        await fixture.controller.connect()
        assert.equal(freshPairCalls, 1)
        assert.equal(fixture.controller.state.status, 'ready')
        assert.deepEqual(fixture.provider.calls.slice(-2), [
            ['createClient', {}],
            ['createClient', { token: freshToken }]
        ])
    })

    test('an encoder timeout under load recovers instead of ending the output', async () => {
        const initial = senderFixture()
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender,
            recoveryClients: [recoveryProbe({ available: false, code: 'SYNC_UNAVAILABLE' })]
        })
        await fixture.controller.start('Loaded')
        const timeout = new Error('H.264 frame encoding timed out')
        timeout.code = 'SYNC_ENCODING_FAILED'
        timeout.transient = true
        initial.completion.reject(timeout)
        await flushMicrotasks()

        assert.equal(fixture.controller.state.status, 'recovering')
        assert.equal(fixture.controller.state.error, null)
        assert.equal(fixture.controller._lastRecoveryCause.code, 'SYNC_ENCODING_FAILED')
        assert.equal(fixture.timers.timeouts.size, 1, 'the first recovery attempt is scheduled')
    })

    test('a transient encoder warmup timeout during start retries and succeeds', async () => {
        const original = {
            encoder: globalThis.VideoEncoder,
            frame: globalThis.VideoFrame,
            stream: globalThis.WebSocketStream,
            create: SyncH264CanvasSender.create
        }
        const sender = senderFixture()
        let attempts = 0
        try {
            globalThis.VideoEncoder = class VideoEncoder {}
            globalThis.VideoFrame = class VideoFrame {}
            globalThis.WebSocketStream = class WebSocketStream {}
            SyncH264CanvasSender.create = async () => {
                attempts++
                if (attempts === 1) {
                    const timeout = new Error('H.264 hardware encoder warmup timed out')
                    timeout.code = 'SYNC_ENCODING_FAILED'
                    timeout.transient = true
                    throw timeout
                }
                return sender.sender
            }
            const fixture = await connectedFixture({
                welcomeVersion: '0.2.87',
                renderer: { addSink: () => () => sender.sender.close() }
            })
            const starting = fixture.controller.start('WarmupRetry')
            await flushMicrotasks(12)

            assert.equal(attempts, 1)
            assert.equal(fixture.controller.state.status, 'starting')
            assert.equal(fixture.timers.timeouts.size, 1, 'retry timeout scheduled')

            fixture.timers.fireTimeout(250)
            await starting
            assert.equal(attempts, 2)
            assert.equal(fixture.controller.state.status, 'sending')
            assert.equal(fixture.timers.timeouts.size, 0)
        } finally {
            globalThis.VideoEncoder = original.encoder
            globalThis.VideoFrame = original.frame
            globalThis.WebSocketStream = original.stream
            SyncH264CanvasSender.create = original.create
        }
    })

    test('a persistent encoder warmup timeout during start fails after exhausting retries', async () => {
        const original = {
            encoder: globalThis.VideoEncoder,
            frame: globalThis.VideoFrame,
            stream: globalThis.WebSocketStream,
            create: SyncH264CanvasSender.create
        }
        let attempts = 0
        try {
            globalThis.VideoEncoder = class VideoEncoder {}
            globalThis.VideoFrame = class VideoFrame {}
            globalThis.WebSocketStream = class WebSocketStream {}
            SyncH264CanvasSender.create = async () => {
                attempts++
                const timeout = new Error('H.264 hardware encoder warmup timed out')
                timeout.code = 'SYNC_ENCODING_FAILED'
                timeout.transient = true
                throw timeout
            }
            const fixture = await connectedFixture({
                welcomeVersion: '0.2.87',
                renderer: { addSink: () => () => {} }
            })
            const starting = fixture.controller.start('WarmupPersistent')
            await flushMicrotasks(12)

            assert.equal(attempts, 1)
            assert.equal(fixture.timers.timeouts.size, 1)
            fixture.timers.fireTimeout(250)
            await flushMicrotasks(12)

            assert.equal(attempts, 2)
            assert.equal(fixture.timers.timeouts.size, 1)
            fixture.timers.fireTimeout(1000)
            await flushMicrotasks(12)

            assert.equal(attempts, 3)
            await assert.rejects(starting, {
                code: 'SYNC_ENCODING_FAILED'
            })
            assert.equal(fixture.controller.state.status, 'error')
            assert.equal(fixture.timers.timeouts.size, 0)
        } finally {
            globalThis.VideoEncoder = original.encoder
            globalThis.VideoFrame = original.frame
            globalThis.WebSocketStream = original.stream
            SyncH264CanvasSender.create = original.create
        }
    })

    test('dispose during start retry cancels the retry timer and rejects with SYNC_LIFECYCLE', async () => {
        const original = {
            encoder: globalThis.VideoEncoder,
            frame: globalThis.VideoFrame,
            stream: globalThis.WebSocketStream,
            create: SyncH264CanvasSender.create
        }
        let attempts = 0
        try {
            globalThis.VideoEncoder = class VideoEncoder {}
            globalThis.VideoFrame = class VideoFrame {}
            globalThis.WebSocketStream = class WebSocketStream {}
            SyncH264CanvasSender.create = async () => {
                attempts++
                const timeout = new Error('H.264 hardware encoder warmup timed out')
                timeout.code = 'SYNC_ENCODING_FAILED'
                timeout.transient = true
                throw timeout
            }
            const fixture = await connectedFixture({
                welcomeVersion: '0.2.87',
                renderer: { addSink: () => () => {} }
            })
            const starting = fixture.controller.start('WarmupDispose')
            await flushMicrotasks(12)

            assert.equal(attempts, 1)
            assert.equal(fixture.timers.timeouts.size, 1)

            fixture.controller.dispose()
            assert.equal(fixture.timers.timeouts.size, 0)
            await assert.rejects(starting, {
                code: 'SYNC_LIFECYCLE'
            })
            assert.equal(fixture.controller.state.status, 'idle')
        } finally {
            globalThis.VideoEncoder = original.encoder
            globalThis.VideoFrame = original.frame
            globalThis.WebSocketStream = original.stream
            SyncH264CanvasSender.create = original.create
        }
    })

    test('an encoding failure that is not a timeout still ends the output', async () => {
        const initial = senderFixture()
        const fixture = await connectedFixture({
            renderer: {
                pipeline: {},
                createFrameExportQueue: () => ({ close() {} }),
                addSink: (sink) => () => sink.close()
            },
            sender: initial.sender
        })
        await fixture.controller.start('Broken')
        const failure = new Error('H.264 encoder returned an invalid frame')
        failure.code = 'SYNC_ENCODING_FAILED'
        initial.completion.reject(failure)
        await flushMicrotasks()

        assert.equal(fixture.controller.state.status, 'error')
        assert.equal(fixture.timers.timeouts.size, 0, 'no retry may be scheduled')
    })
})

describe('SyncOutputController app attachment', () => {
    test('supports DOM-free state listener attachment and complete unsubscription', async () => {
        const provider = passiveProvider({ available: true, health: readyHealth('syphon') })
        const controller = new SyncOutputController({ connectionProvider: provider })
        const states = []
        const unsubscribe = controller.subscribe((state) => states.push(state.status))

        await controller.checkAvailability()
        unsubscribe()
        await controller.checkAvailability()

        assert.deepEqual(states, ['idle', 'checking', 'ready'])
    })

    test('initializes one passive app singleton without probing, pairing, connecting, or UI', () => {
        const calls = []
        const connectionProvider = {
            createClient() {
                calls.push('createClient')
                throw new Error('singleton initialization must stay passive')
            }
        }
        const renderer = {
            createFrameExportQueue() {},
            addSink() {}
        }
        const canvas = { width: 1024, height: 1024 }

        const first = initializeSyncOutputController({
            renderer,
            getCanvas: () => canvas,
            connectionProvider
        })
        const second = initializeSyncOutputController({
            renderer: null,
            getCanvas: () => null,
            connectionProvider
        })

        assert.equal(first, second)
        assert.equal(getSyncOutputController(), first)
        assert.equal(first.state.status, 'idle')
        assert.deepEqual(calls, [])
        assert.equal('document' in first, false)
        assert.equal(globalThis.syncOutputController, undefined)
        assert.equal(globalThis._testExports?.syncOutputController, undefined)
    })

    test('initializes a fresh singleton when the previous instance has been disposed', () => {
        const first = initializeSyncOutputController({
            renderer: { pipeline: {} },
            getCanvas: () => ({}),
            connectionProvider: { createClient: () => ({}) }
        })
        first.dispose()

        const second = initializeSyncOutputController({
            renderer: { pipeline: {} },
            getCanvas: () => ({}),
            connectionProvider: { createClient: () => ({}) }
        })

        assert.notEqual(first, second)
        assert.equal(getSyncOutputController(), second)
        assert.equal(second.state.status, 'idle')
    })
})

test('SyncOutputController accepts and retains injected logger', () => {
    const customLogger = { warn() {}, error() {}, info() {} }
    const defaultController = new SyncOutputController({
        renderer: {},
        getCanvas: () => ({}),
        connectionProvider: { createClient: () => ({}) }
    })
    assert.equal(defaultController._logger, globalThis.console)

    const customController = new SyncOutputController({
        renderer: {},
        getCanvas: () => ({}),
        connectionProvider: { createClient: () => ({}) },
        logger: customLogger
    })
    assert.equal(customController._logger, customLogger)
})

test('SyncOutputController forwards injected logger to SyncH264CanvasSender.create', async () => {
    const original = {
        encoder: globalThis.VideoEncoder,
        frame: globalThis.VideoFrame,
        stream: globalThis.WebSocketStream,
        create: SyncH264CanvasSender.create
    }
    const canvas = { width: 1920, height: 1080 }
    const sender = senderFixture()
    let capturedOptions
    const customLogger = { warn() {}, error() {}, info() {} }
    try {
        globalThis.VideoEncoder = class VideoEncoder {}
        globalThis.VideoFrame = class VideoFrame {}
        globalThis.WebSocketStream = class WebSocketStream {}
        SyncH264CanvasSender.create = async (options) => {
            capturedOptions = options
            return sender.sender
        }
        const fixture = await connectedFixture({
            welcomeVersion: '0.2.87',
            getCanvas: () => canvas,
            renderer: { addSink: () => () => sender.sender.close() },
            logger: customLogger
        })

        await fixture.controller.start('Logger forwarding test')
        assert.equal(capturedOptions?.logger, customLogger)
        await fixture.controller.stop()
    } finally {
        globalThis.VideoEncoder = original.encoder
        globalThis.VideoFrame = original.frame
        globalThis.WebSocketStream = original.stream
        SyncH264CanvasSender.create = original.create
    }
})

test('applyBackoffJitter keeps the exact base delay with a zero random source', () => {
    for (const base of [250, 1000, 4000, 10_000]) {
        assert.equal(applyBackoffJitter(base, () => 0), base)
    }
})

test('applyBackoffJitter stays within +25% of the base delay', () => {
    for (const base of [250, 1000, 4000, 10_000]) {
        for (const sample of [0, 0.5, 0.999]) {
            const delay = applyBackoffJitter(base, () => sample)
            const spread = Math.round(base * 0.25)
            assert.ok(delay >= base && delay <= base + spread,
                `${delay} expected within [${base}, ${base + spread}]`)
        }
    }
})

test('applyBackoffJitter never shortens the base delay across a random sweep', () => {
    let previous = 0
    let sawVariation = false
    for (let index = 0; index <= 10; index++) {
        const delay = applyBackoffJitter(1000, () => index / 10)
        assert.ok(delay >= 1000 && delay <= 1250)
        if (previous && delay !== previous) sawVariation = true
        previous = delay
    }
    assert.equal(sawVariation, true)
})

test('applyBackoffJitter guards against invalid delays and random sources', () => {
    assert.equal(applyBackoffJitter(0, () => 0.9), 0)
    assert.equal(applyBackoffJitter(-5, () => 0.9), 0)
    assert.equal(applyBackoffJitter(Number.NaN, () => 0.9), 0)
    // A non-function random source falls back to zero jitter.
    assert.equal(applyBackoffJitter(1000, null), 1000)
    assert.equal(applyBackoffJitter(1000, () => Number.NaN), 1000)
})

test('recovery backoff timers carry jitter while remaining within the ramp bounds', async () => {
    const initial = senderFixture()
    const replacement = senderFixture()
    const timers = manualTimers()
    const canvas = { width: 1920, height: 1080 }
    const renderer = {
        pipeline: { id: 'test' },
        createFrameExportQueue: () => ({ close() {} }),
        addSink: (sink) => () => sink.close()
    }
    const fixture = await connectedFixture({
        renderer,
        getCanvas: () => canvas,
        sender: initial.sender,
        random: () => 1,
        timers,
        recoveryClients: [
            recoveryProbe({ available: false, code: 'SYNC_UNAVAILABLE' }),
            recoveryConnection({ sender: replacement.sender })
        ]
    })
    await fixture.controller.start('Jittered recovery')

    initial.completion.reject(senderLoss(1006))
    await flushMicrotasks()
    const scheduled = [...timers.timeouts.values()].map((timer) => timer.delay)
    assert.equal(scheduled.length, 1)
    const spread = Math.round(250 * 0.25)
    assert.ok(scheduled[0] > 250 && scheduled[0] <= 250 + spread,
        `jittered delay ${scheduled[0]} expected in (250, ${250 + spread}]`)
    // The probe fails, so the next recovery attempt schedules again with the
    // same deterministic random source above the base 1000ms ramp delay.
    timers.fireTimeout(scheduled[0])
    await flushMicrotasks(12)
    assert.equal(fixture.controller.state.status, 'recovering')
    const next = [...timers.timeouts.values()].map((timer) => timer.delay)
    assert.equal(next.length, 1)
    assert.ok(next[0] > 1000 && next[0] <= 1250,
        `jittered delay ${next[0]} expected in (1000, 1250]`)
    await fixture.controller.stop()
})
