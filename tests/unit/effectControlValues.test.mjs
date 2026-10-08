import { test } from 'node:test'
import assert from 'node:assert'
import {
    gateValues,
    isEnabled,
    memberEnumPath,
    memberEntries,
    memberPathFor,
    resourceName,
    volumeSizeOwner,
} from '../../public/js/ui/effectControlValues.js'

const palette = { none: 0, afterimage: { value: 3 }, brushedMetal: 7 }

test('memberEnumPath prefers the named enum, then the dotted default', () => {
    assert.strictEqual(memberEnumPath({ enum: 'palette' }), 'palette')
    assert.strictEqual(memberEnumPath({ enumPath: 'oscKind' }), 'oscKind')
    assert.strictEqual(memberEnumPath({ default: 'palette.brushedMetal' }), 'palette')
    assert.strictEqual(memberEnumPath({ default: 'plain' }), null)
    assert.strictEqual(memberEnumPath(null), null)
})

test('memberEntries carry the full enum path the DSL writer emits', () => {
    assert.deepStrictEqual(memberEntries(palette, 'palette'), [
        { key: 'none', path: 'palette.none', numeric: 0 },
        { key: 'afterimage', path: 'palette.afterimage', numeric: 3 },
        { key: 'brushedMetal', path: 'palette.brushedMetal', numeric: 7 },
    ])
    assert.deepStrictEqual(memberEntries(null, 'palette'), [])
})

test('memberPathFor resolves every form program state holds', () => {
    const entries = memberEntries(palette, 'palette')
    assert.strictEqual(memberPathFor(entries, 7), 'palette.brushedMetal')
    assert.strictEqual(memberPathFor(entries, 0), 'palette.none')
    assert.strictEqual(memberPathFor(entries, 'palette.afterimage'), 'palette.afterimage')
    assert.strictEqual(memberPathFor(entries, 'afterimage'), 'palette.afterimage')
    assert.strictEqual(memberPathFor(entries, { type: 'Member', path: ['palette', 'afterimage'] }), 'palette.afterimage')
    assert.strictEqual(memberPathFor(entries, 'missing'), '')
    assert.strictEqual(memberPathFor(entries, undefined), '')
})

test('resourceName reads every form a resource reference takes', () => {
    assert.strictEqual(resourceName('o1'), 'o1')
    assert.strictEqual(resourceName('read(o3)'), 'o3')
    assert.strictEqual(resourceName({ kind: 'output', name: 'o2' }), 'o2')
    assert.strictEqual(resourceName({ kind: 'vol', name: 'vol1' }), 'vol1')
    assert.strictEqual(resourceName({ _ast: { type: 'Ident', name: 'geo4' } }), 'geo4')
    assert.strictEqual(resourceName(null), null)
    assert.strictEqual(resourceName(7), null)
})

test('isEnabled follows the engine UI condition grammar', () => {
    assert.strictEqual(isEnabled({ param: 'poi', eq: 0 }, { poi: 0 }), true)
    assert.strictEqual(isEnabled({ param: 'poi', eq: 0 }, { poi: 2 }), false)
    assert.strictEqual(isEnabled({ param: 'layers', gt: 3 }, { layers: 3 }), false)
    assert.strictEqual(isEnabled({ param: 'layers', gt: 3 }, { layers: 4 }), true)
    assert.strictEqual(isEnabled({ param: 'animation', in: [2, 6] }, { animation: 6 }), true)
    assert.strictEqual(isEnabled({ param: 'animation', notIn: [2, 6] }, { animation: 6 }), false)
    assert.strictEqual(isEnabled({ and: [{ param: 'a', eq: 1 }, { param: 'b', gt: 2 }] }, { a: 1, b: 3 }), true)
    assert.strictEqual(isEnabled({ or: [{ param: 'a', eq: 1 }, { param: 'b', gt: 2 }] }, { a: 0, b: 0 }), false)
    assert.strictEqual(isEnabled({ not: { param: 'a', eq: 1 } }, { a: 1 }), false)
    assert.strictEqual(isEnabled('flag', { flag: true }), true)
    assert.strictEqual(isEnabled('flag', { flag: 0 }), false)
    assert.strictEqual(isEnabled(undefined, {}), true)
})

test('isEnabled keeps a gate open while an automation drives its condition', () => {
    const lfo = { type: 'Oscillator', min: 1, max: 5 }
    const knob = { type: 'Midi', channel: 1 }
    const beat = { _ast: { type: 'Audio' } }
    const bound = { _varRef: 'osc1', value: 0 }
    const focal = { and: ['viewMode', { param: 'aperture', gt: 0 }] }
    for (const aperture of [lfo, knob, beat, bound]) {
        assert.strictEqual(isEnabled(focal, { viewMode: 2, aperture }), true)
    }
    assert.strictEqual(isEnabled(focal, { viewMode: 0, aperture: lfo }), false)
    assert.strictEqual(isEnabled(focal, { viewMode: 2, aperture: 0 }), false)
    const refract = { and: [{ param: 'refractAAmt', gt: 0 }, { param: 'blendMode', neq: 100 }] }
    assert.strictEqual(isEnabled(refract, { refractAAmt: lfo, blendMode: 100 }), false)
    assert.strictEqual(isEnabled(refract, { refractAAmt: lfo, blendMode: 10 }), true)
    assert.strictEqual(isEnabled({ not: { param: 'a', eq: 1 } }, { a: lfo }), true)
    assert.strictEqual(isEnabled({ or: [{ param: 'a', eq: 1 }, { param: 'b', gt: 2 }] }, { a: 0, b: lfo }), true)
    assert.strictEqual(isEnabled('flag', { flag: bound }), true)
})

test('isEnabled compares resource parameters by name', () => {
    const globals = { tex: { type: 'surface' } }
    const gate = { param: 'tex', neq: 'none' }
    assert.strictEqual(isEnabled(gate, { tex: { kind: 'output', name: 'none' } }, globals), false)
    assert.strictEqual(isEnabled(gate, { tex: { kind: 'output', name: 'o0' } }, globals), true)
    assert.strictEqual(isEnabled(gate, { tex: 'o2' }, globals), true)
})

test('a member gate matches whether state holds the number or the path', () => {
    // osc2d: seed is enabled for oscType in [noise1d, noise2d]
    const globals = { oscType: { type: 'member', enum: 'oscType' }, seed: { type: 'int' } }
    const enums = { oscType: { sine: 0, noise1d: 5, noise2d: { value: 6 } } }
    const gate = { param: 'oscType', in: ['oscType.noise1d', 'oscType.noise2d'] }
    const lookup = path => enums[path] || null
    assert.strictEqual(isEnabled(gate, gateValues({ oscType: 5 }, globals, lookup), globals), true)
    assert.strictEqual(isEnabled(gate, gateValues({ oscType: 6 }, globals, lookup), globals), true)
    assert.strictEqual(isEnabled(gate, gateValues({ oscType: 'oscType.noise1d' }, globals, lookup), globals), true)
    assert.strictEqual(isEnabled(gate, gateValues({ oscType: 0 }, globals, lookup), globals), false)
})

// noise3d(volumeSize: x64).palette3d().render3d().write(o0)
const chainPlans = [{
    chain: [
        { op: 'synth3d.noise3d', temp: 0, from: null },
        { op: 'filter3d.palette3d', temp: 1, from: 0 },
        { op: 'render.render3d', temp: 2, from: 1 },
        { op: '_write', temp: 3, from: 2, builtin: true },
    ],
}]
const chainPasses = [
    { stepIndex: 0, scopedParams: { volumeSize: 'volumeSize_chain_0' } },
    { stepIndex: 1, inheritsVolumeSize: true },
    { stepIndex: 2, inheritsVolumeSize: true },
    { stepIndex: 3 },
]

test('volumeSizeOwner returns the step itself when it owns its volume', () => {
    assert.strictEqual(volumeSizeOwner(chainPlans, chainPasses, 0), 0)
})

test('volumeSizeOwner walks a consumer up to the generator', () => {
    assert.strictEqual(volumeSizeOwner(chainPlans, chainPasses, 1), 0)
    assert.strictEqual(volumeSizeOwner(chainPlans, chainPasses, 2), 0)
})

test('volumeSizeOwner follows read3d back to the chain that wrote the volume', () => {
    // noise3d().write3d(vol0)   read3d(vol0).render3d().write(o0)
    const plans = [
        { chain: [
            { op: 'synth3d.noise3d', temp: 0, from: null },
            { op: '_write3d', temp: 1, from: 0, builtin: true, args: { tex3d: { kind: 'vol', name: 'vol0' } } },
        ] },
        { chain: [
            { op: '_read3d', temp: 2, from: null, builtin: true, args: { tex3d: { kind: 'vol', name: 'vol0' } } },
            { op: 'render.render3d', temp: 3, from: 2 },
        ] },
    ]
    const passes = [{ stepIndex: 0 }, { stepIndex: 1 }, { stepIndex: 3, inheritsVolumeSize: true }]
    assert.strictEqual(volumeSizeOwner(plans, passes, 3), 0)
})

test('volumeSizeOwner returns null when the owner cannot be found', () => {
    const plans = [{ chain: [{ op: 'render.render3d', temp: 0, from: null }] }]
    assert.strictEqual(volumeSizeOwner(plans, [{ stepIndex: 0, inheritsVolumeSize: true }], 0), null)
})
