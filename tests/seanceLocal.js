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

// Restricted runners (the macOS GPU host broker) only permit explicit fixed
// loopback ports (43117-43126), so an ephemeral listen(0) fails with EPERM
// there. Try ephemeral first, then the fixed range minus the ports this run
// already owns: the page origin (serve-book, 43117) and the native audio
// daemon (43126). On macOS a specific 127.0.0.1 bind succeeds next to an
// existing wildcard bind on the same port and then wins all loopback traffic,
// so binding a port the app serves would silently steal page requests.
const SEANCE_FIXED_FALLBACK_PORTS = [43118, 43119, 43120, 43121, 43122, 43123, 43124, 43125]

function tryListen(port) {
    const server = net.createServer()
    server.unref()
    return new Promise((resolve, reject) => {
        const onError = err => {
            server.close()
            reject(err)
        }
        server.once('error', onError)
        server.listen(port, '127.0.0.1', () => {
            const address = server.address()
            server.removeListener('error', onError)
            server.close(() => resolve(address.port))
        })
    })
}

async function getFreePort() {
    try {
        return await tryListen(0)
    } catch (error) {
        if (error.code !== 'EPERM') throw error
        let lastError = error
        for (const port of SEANCE_FIXED_FALLBACK_PORTS) {
            try {
                return await tryListen(port)
            } catch (err) {
                lastError = err
            }
        }
        throw lastError
    }
}
