#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const root = resolve(args[0] || resolve(repo, '../noisemaker-curated'))
const outIndex = args.indexOf('--out')
const output = outIndex < 0 ? resolve(repo, 'public/data/examples.json') : resolve(args[outIndex + 1])

async function verifiedFile(file, expected) {
    if (typeof file !== 'string' || isAbsolute(file)) throw new Error(`Invalid collection path: ${file}`)
    const path = resolve(root, file)
    const rel = relative(root, path)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Invalid collection path: ${file}`)
    const bytes = await readFile(path)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== expected) throw new Error(`SHA-256 mismatch: ${file}`)
    return bytes.toString('utf8')
}

try {
    const manifest = JSON.parse(await readFile(resolve(root, 'programs.json'), 'utf8'))
    if (manifest.version !== 1 || manifest.license !== 'MIT') throw new Error('Unsupported collection version or license')
    if (!Array.isArray(manifest.programs) || !manifest.programs.length || manifest.count !== manifest.programs.length) {
        throw new Error('Collection count does not match its programs')
    }
    const ids = new Set()
    const programs = []
    for (const entry of manifest.programs) {
        if (!entry.id || ids.has(entry.id)) throw new Error(`Duplicate or missing program id: ${entry.id}`)
        ids.add(entry.id)
        if (!entry.title || !entry.author || entry.license !== 'MIT') throw new Error(`Missing attribution: ${entry.id}`)
        const dsl = await verifiedFile(entry.dslFile, entry.dslSha256)
        if (!dsl.trim()) throw new Error(`Empty program: ${entry.id}`)
        const program = {
            id: entry.id, code: entry.code, title: entry.title,
            author: entry.author, license: entry.license, variant: entry.variant,
            tagline: entry.author, tags: [], dslSha256: entry.dslSha256, dsl,
        }
        if (entry.effectsFile) {
            const effects = JSON.parse(await verifiedFile(entry.effectsFile, entry.effectsSha256))
            if (!Array.isArray(effects) || !effects.length) throw new Error(`Invalid effects: ${entry.id}`)
            program.effectsSha256 = entry.effectsSha256
            program.effects = effects
        }
        programs.push(program)
    }
    // Validate the complete collection before replacing the bundled roster.
    await writeFile(output, JSON.stringify(programs, null, 2) + '\n')
    console.log(`Imported ${programs.length} curated programs`)
} catch (error) {
    console.error(error.message)
    process.exitCode = 1
}
