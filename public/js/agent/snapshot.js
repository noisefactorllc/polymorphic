/**
 * State snapshot attached to every PolymorphicAgent envelope. It stays small:
 * the program text itself comes from getProgram.
 *
 * @module agent/snapshot
 */

import { effectiveRenderTarget, surfacesWrittenInDsl } from '../ui/outputPicker.js'
import { snapshotHistory } from '../ui/snapshotHistory.js'
import { tempoController } from '../ui/tempo.js'
import { recorder } from '../ui/recorder.js'
import { liveInputsPanel } from '../ui/liveInputsPanel.js'

/** Snapshot schema version. Bump for renamed or removed fields. */
export const SCHEMA_VERSION = '1.0'

/**
 * @param {object} app - The app references and actions from embed.js
 * @param {{remote?: boolean}} [call] - A command from a Seance session sees the
 *   program text that the session holds, not text that stayed in the editor.
 */
export function buildSnapshot(app, { remote = false } = {}) {
    const editor = app.getDsl()
    const session = remote ? app.sessionText() ?? '' : null
    const dsl = remote ? session : editor
    const program = remote
        ? { chars: dsl.length, running: app.runs(dsl), error: dsl === editor ? app.compilerError() : null }
        : { chars: dsl.length, running: app.isRunning(), error: app.compilerError() }
    const surface = effectiveRenderTarget(dsl)
    const canvas = app.canvas
    return {
        schemaVersion: SCHEMA_VERSION,
        program,
        canvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0 },
        output: { surface: surface === null ? null : `o${surface}`, written: surfacesWrittenInDsl(dsl).map(n => `o${n}`) },
        playback: { playing: app.isPlaying() },
        tempo: { bpm: tempoController.getBpm(), divider: tempoController.getDivider(), source: tempoController.getSource() },
        backend: app.renderer?.backend ?? null,
        // The program history is stored in this browser: a session does not see it.
        history: remote ? null : { canBack: snapshotHistory.canBack(), canForward: snapshotHistory.canForward() },
        online: app.onlineStatus(),
        recording: recorder.isRecording(),
        liveMedia: liveInputsPanel.hasLiveMedia,
        view: app.getView(),
    }
}
