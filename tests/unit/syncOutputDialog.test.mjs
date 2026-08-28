import assert from 'node:assert/strict'
import { test } from 'node:test'

test('Sync target state exposes the correct action and live counters', async () => {
    const dialogModule = await import('../../public/js/ui/syncOutputDialog.js').catch(() => null)
    assert.ok(dialogModule, 'Sync output dialog module must exist')

    const ready = dialogModule.deriveSyncOutputView({
        status: 'ready',
        connected: true,
        providerIds: ['syphon', 'future-provider'],
        fps: 60,
        stats: {}
    })
    assert.deepEqual(ready.action, { kind: 'start', label: 'Start sending', disabled: false })
    assert.deepEqual(dialogModule.providerDisplayNames(ready.providerIds), ['Syphon', 'future-provider'])

    const sending = dialogModule.deriveSyncOutputView({
        status: 'sending',
        connected: true,
        providerIds: ['spout', 'ndi'],
        width: 1920,
        height: 1080,
        fps: 60,
        stats: {
            accepted: 14,
            droppedBusy: 2,
            droppedBackpressure: 3,
            sent: 9,
            failed: 1
        }
    })
    assert.equal(sending.live, true)
    assert.equal(sending.stateLabel, 'Sending')
    assert.deepEqual(sending.action, { kind: 'stop', label: 'Stop sending', disabled: false })
    assert.deepEqual(sending.counters, { sent: 9, gpuBusy: 2, network: 3, failed: 1 })

    const blocked = dialogModule.deriveSyncOutputView({
        status: 'idle',
        providerIds: [],
        fps: 60,
        stats: {}
    }, { policy: { status: 'blocked', feature: 'loopback-network' } })
    assert.equal(blocked.policyBlocked, true)
    assert.deepEqual(blocked.action, { kind: 'connect', label: 'Connect Sync', disabled: true })
    assert.match(blocked.recovery, /loopback network access/)
})

test('Sync target state never exposes an unmapped transport error message', async () => {
    const { deriveSyncOutputView } = await import('../../public/js/ui/syncOutputDialog.js')
    const secret = 'credential-must-not-render'

    const view = deriveSyncOutputView({
        status: 'error',
        connected: false,
        error: {
            code: 'SYNC_PROTOCOL',
            message: `daemon rejected token ${secret}`
        }
    })

    assert.equal(view.recovery, 'Sync could not continue. Check the companion and try again.')
    assert.doesNotMatch(view.recovery, new RegExp(secret))
})

test('Invalid sender-name recovery explains both rejected character classes', async () => {
    const { deriveSyncOutputView } = await import('../../public/js/ui/syncOutputDialog.js')
    const view = deriveSyncOutputView({
        status: 'error',
        connected: true,
        error: { code: 'SYNC_INVALID_SENDER_NAME', message: 'must not render' }
    })

    assert.equal(
        view.recovery,
        'Use an output name with 1–64 UTF-8 bytes and no control or formatting characters.'
    )
})

test('Connect notice paints before pairing and target actions stay explicit', async () => {
    const { runSyncOutputAction } = await import('../../public/js/ui/syncOutputDialog.js')
    const events = []
    const controller = {
        async connect() { events.push('connect') },
        async start(name) { events.push(`start:${name}`) },
        async stop() { events.push('stop') }
    }

    await runSyncOutputAction('connect', {
        controller,
        onConnectIntent: () => events.push('notice'),
        afterPaint: async () => { events.push('paint') }
    })
    await runSyncOutputAction('start', { controller, name: 'Polymorphic' })
    await runSyncOutputAction('stop', { controller })

    assert.deepEqual(events, ['notice', 'paint', 'connect', 'start:Polymorphic', 'stop'])
})
