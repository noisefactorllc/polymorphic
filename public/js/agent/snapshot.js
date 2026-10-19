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

export function buildSnapshot(app) {
    const dsl = app.getDsl()
    const surface = effectiveRenderTarget(dsl)
    const canvas = app.canvas
    return {
        schemaVersion: SCHEMA_VERSION,
        program: { chars: dsl.length, running: app.isRunning(), error: app.compilerError() },
        canvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0 },
        output: { surface: surface === null ? null : `o${surface}`, written: surfacesWrittenInDsl(dsl).map(n => `o${n}`) },
        playback: { playing: app.isPlaying() },
        tempo: { bpm: tempoController.getBpm(), divider: tempoController.getDivider(), source: tempoController.getSource() },
        backend: app.renderer?.backend ?? null,
        history: { canBack: snapshotHistory.canBack(), canForward: snapshotHistory.canForward() },
        online: app.onlineStatus(),
        recording: recorder.isRecording(),
        liveMedia: liveInputsPanel.hasLiveMedia,
        view: app.getView(),
    }
}
