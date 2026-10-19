// Guards the agent contract: every command is described, llms-full.txt is
// current, and llms.txt lists every error code the agent API returns.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { COMMAND_GROUPS } from '../../public/js/agent/descriptions.js'
import { SCHEMAS, validate } from '../../public/js/agent/schemas.js'
import { LLMS_PATH, LLMS_FULL_PATH, renderLlmsFull } from '../../scripts/build-llms-full.mjs'

const AGENT_DIR = new URL('../../public/js/agent/', import.meta.url)
const described = () => COMMAND_GROUPS.flatMap(group => Object.keys(group.commands))

test('every command has exactly one description and one schema entry', () => {
    const names = described()
    assert.deepEqual(names.filter((name, i) => names.indexOf(name) !== i), [], 'a command is described twice')
    assert.deepEqual([...names].sort(), Object.keys(SCHEMAS).sort())
    for (const group of COMMAND_GROUPS) {
        for (const [name, entry] of Object.entries(group.commands)) {
            assert.ok(entry.does && entry.returns, `${name} needs does and returns`)
        }
    }
})

test('every command has a handler in commands.js', async () => {
    const source = await readFile(new URL('commands.js', AGENT_DIR), 'utf8')
    const handlers = new Set([...source.matchAll(/^export (?:async )?function (\w+)/gm)].map(m => m[1]))
    assert.deepEqual(Object.keys(SCHEMAS).filter(name => !handlers.has(name)), [])
})

test('public/llms-full.txt matches a fresh render (run node scripts/build-llms-full.mjs)', async () => {
    assert.equal(await readFile(LLMS_FULL_PATH, 'utf8'), await renderLlmsFull())
})

test('llms.txt lists every error code that the agent API returns', async () => {
    const codes = new Set()
    for (const name of await readdir(AGENT_DIR)) {
        if (!name.endsWith('.js')) continue
        const source = await readFile(new URL(name, AGENT_DIR), 'utf8')
        // commandError('X', ...), fail('X', ...), makeFailure(name, 'X', ...)
        const pattern = /(?:commandError|fail)\(\s*'([A-Z][A-Z_]+)'|makeFailure\(\w+,\s*'([A-Z][A-Z_]+)'/g
        for (const m of source.matchAll(pattern)) codes.add(m[1] || m[2])
    }
    for (const code of ['INVALID_PROGRAM', 'INVALID_ARGS_UNKNOWN', 'INTERNAL_ERROR', 'REMOTE_UNAVAILABLE', 'NOT_FOUND_COMMAND',
        'IMAGE_UPLOAD_FAILED', 'IMAGE_LIMIT', 'IMAGE_AS_TEXT', 'OUTSIDE_LINK', 'NOT_FOUND_IMAGE']) {
        assert.ok(codes.has(code), `the code scan no longer finds ${code}`)
    }
    const llms = await readFile(LLMS_PATH, 'utf8')
    assert.deepEqual([...codes].filter(code => !llms.includes(`| \`${code}\` |`)).sort(), [])
    // And the reverse: the table lists no code that the API no longer returns.
    const listed = [...llms.matchAll(/^\| `([A-Z][A-Z_]+)` \|/gm)].map(m => m[1])
    assert.deepEqual(listed.filter(code => !codes.has(code)).sort(), [])
})

test('llms.txt describes the Seance route before the browser routes', async () => {
    const llms = await readFile(LLMS_PATH, 'utf8')
    const at = text => llms.indexOf(text)
    assert.ok(at('curl -fsSLO https://noisedeck.app/agent/seance-agent.mjs') > 0)
    assert.ok(at('node seance-agent.mjs join') < at('## Control Polymorphic in a browser you drive'))
    assert.ok(at('## Control Polymorphic in a browser you drive') < at('1. WebMCP'))
    assert.ok(at('1. WebMCP') < at('2. Page JavaScript'))
    assert.ok(!llms.includes('agent=1'), 'the page has no command form')
    assert.ok(llms.includes('https://noisemaker.app/llms-full.txt'))
    assert.doesNotMatch(llms, /[\u2013\u2014]/, 'no em or en dashes')
})

test('a command with no arguments accepts only an empty object', () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
        if (Object.keys(schema.properties).length) continue
        assert.equal(validate({}, schema).ok, true, name)
        assert.equal(validate({ force: true }, schema).code, 'INVALID_ARGS_UNKNOWN', name)
        assert.equal(validate('x', schema).code, 'INVALID_ARGS_TYPE', name)
    }
})

test('documented defaults match the handler defaults', async () => {
    const source = await readFile(new URL('commands.js', AGENT_DIR), 'utf8')
    for (const [name, schema] of Object.entries(SCHEMAS)) {
        for (const [field, spec] of Object.entries(schema.properties)) {
            if (spec.default === undefined) continue
            const literal = typeof spec.default === 'string' ? `'${spec.default}'` : String(spec.default)
            const signature = new RegExp(`export async function ${name}\\(\\{[^)]*\\b${field} = ${literal}[,\\s}]`)
            assert.match(source, signature, `${name}.${field} default ${literal}`)
        }
    }
})

test('schemas reject undeclared fields and accept declared ones', () => {
    assert.equal(validate({ dsl: 'x' }, SCHEMAS.setProgram).ok, true)
    assert.equal(validate({ dsl: 'x', force: true }, SCHEMAS.setProgram).code, 'INVALID_ARGS_UNKNOWN')
    assert.equal(validate({}, SCHEMAS.setProgram).code, 'INVALID_ARGS_REQUIRED')
    assert.equal(validate({ maxDimension: 2048 }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_RANGE')
    assert.equal(validate({ format: 'gif' }, SCHEMAS.exportImage).code, 'INVALID_ARGS_ENUM')
    assert.equal(validate({ slot: 10 }, SCHEMAS.loadScene).code, 'INVALID_ARGS_RANGE')
    assert.equal(validate({ slot: 1.5 }, SCHEMAS.saveScene).code, 'INVALID_ARGS_TYPE')
    assert.equal(validate({ surface: 'o8' }, SCHEMAS.setOutput).code, 'INVALID_ARGS_ENUM')
    assert.equal(validate({ divider: 4, bpm: 128.5 }, SCHEMAS.setTempo).ok, true)
    assert.equal(validate({ divider: 3 }, SCHEMAS.setTempo).code, 'INVALID_ARGS_ENUM')
    assert.equal(validate({ panel: 'docs' }, SCHEMAS.setView).code, 'INVALID_ARGS_REQUIRED')
})

test('commands that need the person at the browser or reach their stored data are kept out of a session', async () => {
    const local = COMMAND_GROUPS.flatMap(group => Object.entries(group.commands))
        .filter(([, entry]) => entry.remote === false).map(([name]) => name).sort()
    // Seance relays every answer to everyone in the session, and any writer
    // can send commands, so what the person keeps in this browser (saved
    // programs, scenes, the program history, custom shader code) and what acts
    // on their browser rather than the shared program stay with the person.
    assert.deepEqual(local, [
        'deleteProgram', 'exportImage', 'importComposition', 'listPrograms', 'listScenes', 'loadProgram',
        'loadScene', 'resetProgram', 'saveProgram', 'saveScene', 'setBackend', 'setFullscreen', 'setRecording',
        'setView', 'stepHistory', 'useLiveInput',
    ])
    const full = await readFile(LLMS_FULL_PATH, 'utf8')
    const llms = await readFile(LLMS_PATH, 'utf8')
    for (const name of local) {
        const section = full.slice(full.indexOf(`#### \`${name}\``)).split('\n#### ')[0]
        assert.match(section, /Not available through a Seance session/, name)
        assert.ok(llms.includes(`\`${name}\``), `llms.txt names ${name} among the commands a session cannot reach`)
    }
})
