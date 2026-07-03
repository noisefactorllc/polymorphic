import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const SEANCE_SDK_URL = 'https://seance.noisefactor.io/sdk/0/index.js'

const seanceRoot = resolve(process.env.SEANCE_ROOT || resolve(process.cwd(), '../seance'))
const seanceSdkDir = resolve(process.env.SEANCE_SDK_DIR || resolve(seanceRoot, 'sdk'))
const seancePython = resolve(process.env.SEANCE_PYTHON || resolve(seanceRoot, '.venv/bin/python'))

export function hasLocalSeanceHarness() {
    return existsSync(resolve(seanceSdkDir, 'index.js')) &&
        existsSync(seancePython) &&
        existsSync(resolve(seanceRoot, 'bin/app.py'))
}

export async function routeSeanceSdkLocal(page) {
    await page.route('https://seance.noisefactor.io/sdk/0/**', async (route) => {
        const rel = new URL(route.request().url()).pathname.replace(/^\/sdk\/0\//, '')
        const file = resolve(seanceSdkDir, rel)
        if (!file.startsWith(seanceSdkDir) || !existsSync(file)) {
            await route.fulfill({ status: 404, body: `missing ${rel}` })
            return
        }
        const body = readFileSync(file)
        await route.fulfill({
            status: 200,
            contentType: rel.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body,
        })
    })
}

export async function startSeanceServer({ origin = 'http://localhost:3017' } = {}) {
    if (!hasLocalSeanceHarness()) {
        throw new Error(
            'Polymorphic collaboration tests require a local Seance harness; ' +
            'set SEANCE_SDK_DIR and SEANCE_PYTHON, or keep ../seance with .venv/bin/python.'
        )
    }
    const port = await getFreePort()
    const tmp = mkdtempSync(join(tmpdir(), 'polymorphic-seance-'))
    const key = randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    let logs = ''

    const proc = spawn(seancePython, ['bin/app.py'], {
        cwd: seanceRoot,
        env: {
            ...process.env,
            PYTHONPATH: seanceRoot,
            SEANCE_BIND: `127.0.0.1:${port}`,
            SEANCE_SECRET: key,
            SEANCE_DB: join(tmp, 'seance.db'),
            SEANCE_ALLOWED_ORIGINS: origin,
            SEANCE_TRUSTED_PROXIES: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    proc.stdout.on('data', (chunk) => { logs += chunk.toString() })
    proc.stderr.on('data', (chunk) => { logs += chunk.toString() })

    const url = `http://127.0.0.1:${port}`
    try {
        await waitForHealthy(url, () => proc.exitCode, () => logs)
    } catch (error) {
        proc.kill('SIGTERM')
        rmSync(tmp, { recursive: true, force: true })
        throw error
    }

    return {
        url,
        stop: async () => {
            if (proc.exitCode == null) {
                proc.kill('SIGTERM')
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, 1500)
                    proc.once('exit', () => {
                        clearTimeout(timer)
                        resolve()
                    })
                })
            }
            rmSync(tmp, { recursive: true, force: true })
        },
        logs: () => logs,
    }
}

async function waitForHealthy(url, exitCode, logs) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
        if (exitCode() != null) {
            throw new Error(`Seance exited before startup:\n${logs()}`)
        }
        try {
            const response = await fetch(`${url}/up`)
            if (response.ok) return
        } catch {
            // keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error(`Timed out waiting for Seance:\n${logs()}`)
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer()
        server.unref()
        server.on('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            server.close(() => resolve(address.port))
        })
    })
}
