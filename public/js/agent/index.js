/**
 * Polymorphic Agent API: a JSON command surface on window.PolymorphicAgent
 * for software agents that control Polymorphic. The contract's source is
 * public/llms.txt. It is served with the command reference at /llms-full.txt.
 *
 * @module agent
 */

import { API_VERSION, makeFailure, registerCommand, runCommand } from './dispatcher.js'
import { SCHEMAS } from './schemas.js'
import * as commands from './commands.js'
import { catalog, registerWebMCP, REMOTE } from './transports.js'
import { createAgentRelay } from './relay.js'

let _readyResolve
export const PolymorphicAgent = {
    version: API_VERSION,
    ready: new Promise((resolve) => { _readyResolve = resolve }),
}

if (typeof window !== 'undefined') {
    window.PolymorphicAgent = PolymorphicAgent
}

/**
 * Register every command. Call once, when the editor and the menus are set
 * up; the handlers reach the renderer through `ctx` when they run. `ready`
 * resolves later, from markAgentReady().
 *
 * @param {object} ctx - The app references and actions that commands.js uses (see embed.js)
 */
export function bootstrapAgent(ctx) {
    Object.defineProperty(PolymorphicAgent, '_ctx', { value: ctx, enumerable: false })
    for (const name of Object.keys(SCHEMAS)) {
        registerCommand(PolymorphicAgent, name, commands[name])
    }
    registerWebMCP(PolymorphicAgent)
}

/**
 * Resolve `ready` once app startup has finished, so an agent's first command
 * does not race the startup program load.
 */
export function markAgentReady() {
    _readyResolve()
}

/**
 * The Seance relay for this tab (see relay.js): its WebSocket class goes to the
 * Seance SDK, and sessionCreated marks a session this tab took online.
 *
 * @param {{appVersion: string, uploadImage: (blob: Blob) => Promise<string>}} options
 * @returns {{ WebSocket: typeof WebSocket, sessionCreated: (sessionId: string) => void }}
 */
export function createSeanceAgentRelay({ appVersion, uploadImage }) {
    return createAgentRelay({
        app: 'polymorphic',
        appVersion,
        catalog,
        uploadImage,
        async invoke(command, args) {
            if (!REMOTE.has(command)) {
                return {
                    envelope: SCHEMAS[command]
                        ? makeFailure(command, 'REMOTE_UNAVAILABLE',
                            `${command} is not available through a session: it needs the person at the browser, or it reaches what they keep in this browser.`)
                        : makeFailure(command, 'NOT_FOUND_COMMAND', `Unknown command: ${command}`),
                }
            }
            await PolymorphicAgent.ready
            return runCommand(command, args, { remote: true })
        },
    })
}
