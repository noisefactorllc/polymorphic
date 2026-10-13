// SPDX-License-Identifier: MIT
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const importer = resolve('scripts/import-curated-programs.mjs')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function fixture(t) {
    const dir = await mkdtemp(join(tmpdir(), 'polymorphic-curated-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    await mkdir(join(dir, 'programs', 'abc123'), { recursive: true })
    const dsl = 'search synth, render\nnoise().write(o0)\nrender(o0)\n'
    const effects = '[{"name":"custom","func":"custom","shaders":{"main":{"glsl":"shader source"}}}]\n'
    await writeFile(join(dir, 'programs/abc123/program.dsl'), dsl)
    await writeFile(join(dir, 'programs/abc123/effects.json'), effects)
    const entry = {
        id: 'curated:abc123', code: 'abc123', title: 'Selected program',
        author: 'Jess Hewitt', license: 'MIT', variant: 'Selected version',
        dslFile: 'programs/abc123/program.dsl', dslSha256: hash(dsl),
        effectsFile: 'programs/abc123/effects.json', effectsSha256: hash(effects),
    }
    const manifest = { version: 1, license: 'MIT', count: 1, programs: [entry] }
    const out = join(dir, 'examples.json')
    await writeFile(out, 'previous collection')
    return { dir, out, dsl, effects, entry, manifest }
}
async function run(f) {
    await writeFile(join(f.dir, 'programs.json'), JSON.stringify(f.manifest))
    return spawnSync(process.execPath, [importer, f.dir, '--out', f.out], { encoding: 'utf8' })
}

test('curated import preserves selected DSL, custom shaders and attribution', async t => {
    const f = await fixture(t)
    const result = await run(f)
    assert.equal(result.status, 0, result.stderr)
    const [program] = JSON.parse(await readFile(f.out, 'utf8'))
    assert.equal(program.dsl, f.dsl)
    assert.equal(program.author, 'Jess Hewitt')
    assert.equal(program.title, 'Selected program')
    assert.equal(program.id, 'curated:abc123')
    assert.equal(program.license, 'MIT')
    assert.equal(program.variant, 'Selected version')
    assert.equal(program.tagline, 'Jess Hewitt')
    assert.deepEqual(program.effects, JSON.parse(f.effects))
    assert.equal(program.dslSha256, f.entry.dslSha256)
    assert.equal(program.effectsSha256, f.entry.effectsSha256)
})

for (const kind of ['dsl', 'effects']) {
    test(`curated import rejects damaged ${kind} bytes without replacing the collection`, async t => {
        const f = await fixture(t)
        await writeFile(join(f.dir, f.entry[`${kind}File`]), 'damaged')
        const result = await run(f)
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /SHA-256 mismatch/)
        assert.equal(await readFile(f.out, 'utf8'), 'previous collection')
    })
}

test('curated import rejects paths outside the collection', async t => {
    const f = await fixture(t)
    f.entry.dslFile = '../outside.dsl'
    const result = await run(f)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Invalid collection path/)
    assert.equal(await readFile(f.out, 'utf8'), 'previous collection')
})

test('curated import rejects incomplete and duplicate rosters', async t => {
    const f = await fixture(t)
    f.manifest.count = 2
    assert.match((await run(f)).stderr, /count/)
    f.manifest.programs.push(f.entry)
    assert.match((await run(f)).stderr, /Duplicate/)
    assert.equal(await readFile(f.out, 'utf8'), 'previous collection')
})
