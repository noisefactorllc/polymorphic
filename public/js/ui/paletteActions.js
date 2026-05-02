/**
 * Command Palette — Action Registry
 *
 * Builds the full list of host-level actions registered with the command
 * palette. Each action's run/is callback closes over a small `deps` object
 * that the host (embed.js) populates with high-level UI hooks.
 *
 * The action list is intentionally ignorant of internals — deps exposes
 * only the high-level callables it needs (toggleLiveInputs, enableMic,
 * connectMidi, etc.), not the underlying singletons. This keeps the
 * registry decoupled from embed.js's module state.
 *
 * @typedef {Object} PaletteActionDeps
 * @property {() => void}   forceRecompile
 * @property {() => void}   forceEvalBlock
 * @property {() => void}   resetDsl
 * @property {() => void}   toggleFullscreen
 * @property {() => void}   togglePlayPause
 * @property {() => void}   toggleEditor
 * @property {() => void}   toggleDocs
 * @property {() => void}   savePNG
 * @property {() => void}   saveJPG
 * @property {() => void}   shareProgram
 * @property {() => void}   loadProgram
 * @property {() => void}   saveProgram
 * @property {() => void}   openDocs
 * @property {() => void}   toggleLiveInputs
 * @property {() => void}   enableMic
 * @property {() => void}   connectMidi
 * @property {() => void}   toggleRecording
 * @property {(preset: 'high'|'standard'|'low') => void} setRecordingQuality
 * @property {() => void}   useWebcam
 * @property {() => void}   useScreenCapture
 * @property {() => void}   togglePerfOverlay
 * @property {() => void}   openGallery
 * @property {() => Promise<void>} shuffleExample
 * @property {() => void}   snapshotBack
 * @property {() => void}   snapshotForward
 * @property {() => void}   tapTempo
 * @property {() => void}   toggleBpm
 * @property {() => void}   toggleStatusRow
 * @property {() => void}   showShortcuts
 * @property {() => void}   togglePerformanceMode
 * @property {(target: 'webgpu'|'webgl2') => void} switchBackend
 * @property {() => void}   hushSurfaces
 *
 * @param {PaletteActionDeps} deps
 * @returns {Array<Object>} Action descriptors in the same order they were
 *   originally registered in setupCommandPalette.
 */
export function buildPaletteActions(deps) {
    return [
        {
            id: 'eval-all',
            title: 'Evaluate whole program',
            subtitle: 'Compile and run the entire editor',
            icon: 'play_arrow',
            keywords: ['compile', 'run', 'all', 'recompile'],
            run: () => deps.forceRecompile()
        },
        {
            id: 'eval-block',
            title: 'Evaluate current block',
            subtitle: 'Run the paragraph under the cursor (or current selection)',
            icon: 'play_circle',
            keywords: ['block', 'eval', 'paragraph', 'selection'],
            run: () => deps.forceEvalBlock()
        },
        {
            id: 'reset',
            title: 'Reset to original',
            subtitle: 'Restore the program loaded at startup',
            icon: 'restart_alt',
            keywords: ['original', 'undo'],
            run: () => deps.resetDsl()
        },
        {
            id: 'fullscreen',
            title: 'Toggle fullscreen',
            icon: 'fullscreen',
            keywords: ['expand', 'large'],
            run: () => deps.toggleFullscreen()
        },
        {
            id: 'play-pause',
            title: 'Play / pause animation',
            icon: 'pause',
            keywords: ['stop', 'animate'],
            run: () => deps.togglePlayPause()
        },
        {
            id: 'toggle-editor',
            title: 'Toggle code editor',
            icon: 'code',
            keywords: ['hide', 'show', 'visible'],
            run: () => deps.toggleEditor()
        },
        {
            id: 'toggle-docs',
            title: 'Toggle documentation panel',
            icon: 'menu_book',
            keywords: ['help', 'reference'],
            run: () => deps.toggleDocs()
        },
        {
            id: 'save-png',
            title: 'Save canvas as PNG',
            icon: 'image',
            keywords: ['screenshot', 'export'],
            run: () => deps.savePNG()
        },
        {
            id: 'save-jpg',
            title: 'Save canvas as JPG',
            icon: 'photo_camera',
            keywords: ['screenshot', 'export'],
            run: () => deps.saveJPG()
        },
        {
            id: 'share',
            title: 'Share program publicly',
            icon: 'share',
            keywords: ['link', 'url', 'export'],
            run: () => deps.shareProgram()
        },
        {
            id: 'load-program',
            title: 'Load saved program',
            icon: 'folder_open',
            run: () => deps.loadProgram()
        },
        {
            id: 'save-program',
            title: 'Save program',
            icon: 'save',
            run: () => deps.saveProgram()
        },
        {
            id: 'docs-search',
            title: 'Open documentation',
            icon: 'menu_book',
            run: () => deps.openDocs()
        },
        {
            id: 'live-inputs',
            title: 'Toggle live inputs panel',
            subtitle: 'Audio FFT meters, MIDI CCs, oscillator snippets',
            icon: 'tune',
            keywords: ['audio', 'midi', 'mic', 'osc', 'oscillator'],
            run: () => deps.toggleLiveInputs()
        },
        {
            id: 'mic-enable',
            title: 'Enable microphone (audio FFT)',
            subtitle: 'Use a.low / a.mid / a.high / a.vol in your DSL',
            icon: 'mic',
            keywords: ['audio', 'fft', 'microphone'],
            run: () => deps.enableMic()
        },
        {
            id: 'midi-enable',
            title: 'Connect MIDI device',
            subtitle: 'Live-map any MIDI CC into your DSL',
            icon: 'piano',
            keywords: ['midi', 'controller', 'cc'],
            run: () => deps.connectMidi()
        },
        {
            id: 'record',
            title: 'Start / stop recording',
            subtitle: 'Capture canvas as WebM video',
            icon: 'fiber_manual_record',
            keywords: ['record', 'video', 'webm', 'capture'],
            run: () => deps.toggleRecording()
        },
        {
            id: 'record-quality-high',
            title: 'Recording quality: high (1080p / 16Mbps)',
            subtitle: 'Best quality — may strain the encoder on busy shaders',
            icon: 'high_quality',
            keywords: ['record', 'quality', 'high', '1080p'],
            run: () => deps.setRecordingQuality('high')
        },
        {
            id: 'record-quality-standard',
            title: 'Recording quality: standard (720p / 8Mbps)',
            subtitle: 'Default — smooth on most machines',
            icon: 'sd',
            keywords: ['record', 'quality', 'standard', 'medium', '720p'],
            run: () => deps.setRecordingQuality('standard')
        },
        {
            id: 'record-quality-low',
            title: 'Recording quality: low (480p / 3Mbps)',
            subtitle: 'For slower machines / longer recordings',
            icon: 'compress',
            keywords: ['record', 'quality', 'low', '480p', 'small'],
            run: () => deps.setRecordingQuality('low')
        },
        {
            id: 'webcam',
            title: 'Use webcam as media source',
            subtitle: 'Stream the camera into your sketch',
            icon: 'videocam',
            keywords: ['camera', 'video', 'cam'],
            run: () => deps.useWebcam()
        },
        {
            id: 'screen-capture',
            title: 'Use screen capture as media source',
            icon: 'screen_share',
            keywords: ['screen', 'display', 'capture', 'window'],
            run: () => deps.useScreenCapture()
        },
        {
            id: 'perf',
            title: 'Toggle performance overlay',
            subtitle: 'FPS, frame time, jitter, render passes',
            icon: 'speed',
            keywords: ['fps', 'performance', 'stats', 'profiler'],
            run: () => deps.togglePerfOverlay()
        },
        {
            id: 'gallery',
            title: 'Open inspiration gallery',
            subtitle: 'Browse curated example sketches',
            icon: 'collections',
            keywords: ['examples', 'inspiration', 'sketches', 'browse'],
            run: () => deps.openGallery()
        },
        {
            id: 'shuffle',
            title: 'Shuffle to a random example',
            subtitle: 'Load a random sketch from the gallery',
            icon: 'shuffle',
            keywords: ['random', 'next', 'roll'],
            run: () => deps.shuffleExample()
        },
        {
            id: 'snapshot-back',
            title: 'Step back through program history',
            subtitle: 'Cmd/Ctrl+Alt+← — older successful program',
            icon: 'undo',
            keywords: ['undo', 'history', 'previous'],
            run: () => deps.snapshotBack()
        },
        {
            id: 'snapshot-forward',
            title: 'Step forward through program history',
            subtitle: 'Cmd/Ctrl+Alt+→ — newer successful program',
            icon: 'redo',
            keywords: ['redo', 'history', 'next'],
            run: () => deps.snapshotForward()
        },
        {
            id: 'bpm-tap',
            title: 'Tap tempo',
            subtitle: 'Press T to tap, or use this action',
            icon: 'touch_app',
            keywords: ['bpm', 'tempo', 'beat', 'clock'],
            run: () => deps.tapTempo()
        },
        {
            id: 'bpm-toggle',
            title: 'Toggle BPM indicator',
            icon: 'metronome',
            keywords: ['bpm', 'tempo', 'clock', 'beat'],
            run: () => deps.toggleBpm()
        },
        {
            id: 'status-row',
            title: 'Toggle status row',
            subtitle: 'Bottom-edge live state strip',
            icon: 'view_agenda',
            keywords: ['status', 'bar', 'bottom'],
            run: () => deps.toggleStatusRow()
        },
        {
            id: 'shortcuts',
            title: 'Show keyboard shortcuts',
            subtitle: 'Press ? to open at any time',
            icon: 'keyboard',
            keywords: ['help', 'keys', 'cheatsheet'],
            run: () => deps.showShortcuts()
        },
        {
            id: 'performance-mode',
            title: 'Toggle performance mode',
            subtitle: 'Hide all UI for projection / clean recording (⌘⇧H)',
            icon: 'visibility_off',
            keywords: ['hide', 'fullscreen', 'projection', 'clean', 'algorave'],
            run: () => deps.togglePerformanceMode()
        },
        {
            id: 'backend-webgpu',
            title: 'Switch to WebGPU backend',
            subtitle: 'Reload page using the WebGPU pipeline',
            icon: 'memory',
            keywords: ['gpu', 'wgsl', 'webgpu', 'backend'],
            run: () => deps.switchBackend('webgpu')
        },
        {
            id: 'backend-webgl2',
            title: 'Switch to WebGL2 backend',
            subtitle: 'Reload page using the WebGL2 pipeline',
            icon: 'view_in_ar',
            keywords: ['gpu', 'glsl', 'webgl', 'backend'],
            run: () => deps.switchBackend('webgl2')
        },
        {
            id: 'hush',
            title: 'Hush — clear surfaces',
            subtitle: 'Reset all o0..o7 surfaces (clear feedback state)',
            icon: 'clear_all',
            keywords: ['stop', 'clear', 'reset', 'hush', 'feedback'],
            run: () => deps.hushSurfaces()
        }
    ]
}
