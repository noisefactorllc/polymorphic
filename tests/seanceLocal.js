import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

export const SEANCE_SDK_URL = 'https://seance.noisefactor.io/sdk/0/index.js?v=0.2.2'

export function resolveSeanceHarnessPaths({ env = process.env, cwd = process.cwd() } = {}) {
    const sdkDir = env.SEANCE_SDK_DIR ? resolve(env.SEANCE_SDK_DIR) : null
    const root = resolve(env.SEANCE_ROOT || (sdkDir ? dirname(sdkDir) : resolve(cwd, '../seance')))
    return {
        root,
        sdkDir: sdkDir || resolve(root, 'sdk'),
        python: resolve(env.SEANCE_PYTHON || resolve(root, '.venv/bin/python')),
        app: resolve(root, 'bin/app.py'),
    }
}

const harnessPaths = resolveSeanceHarnessPaths()

export function hasLocalSeanceHarness(paths = harnessPaths, exists = existsSync) {
    return exists(resolve(paths.sdkDir, 'index.js')) &&
        exists(paths.python) &&
        exists(paths.app)
}

export async function routeSeanceSdkLocal(page) {
    await page.route('https://seance.noisefactor.io/sdk/0/**', async (route) => {
        const rel = new URL(route.request().url()).pathname.replace(/^\/sdk\/0\//, '')
        const file = resolve(harnessPaths.sdkDir, rel)
        if (!file.startsWith(harnessPaths.sdkDir) || !existsSync(file)) {
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
            'set SEANCE_ROOT, or set SEANCE_SDK_DIR to a Seance checkout sdk dir and SEANCE_PYTHON.'
        )
    }
    const port = await getFreePort()
    const tmp = mkdtempSync(join(tmpdir(), 'polymorphic-seance-'))
    const key = randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    let logs = ''

    const proc = spawn(harnessPaths.python, [harnessPaths.app], {
        cwd: harnessPaths.root,
        env: {
            ...process.env,
            PYTHONPATH: [harnessPaths.root, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
            SEANCE_BIND: `127.0.0.1:${port}`,
            SEANCE_SECRET: key,
            SEANCE_DB: join(tmp, 'seance.db'),
            SEANCE_ALLOWED_ORIGINS: origin,
            SEANCE_TRUSTED_PROXIES: '',
            // The suite creates a fresh anonymous identity for every browser
            // context. Its isolated server must cover the whole suite, not
            // stop admitting the eleventh browser at the production IP quota.
            SEANCE_LIMIT_ANON_MINTS_PER_IP_HOUR: '100',
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
