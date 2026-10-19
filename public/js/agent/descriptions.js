/**
 * What each PolymorphicAgent command does and returns, in the groups and
 * order that public/llms-full.txt lists them. scripts/build-llms-full.mjs
 * renders the command reference from this file and SCHEMAS, and
 * tests/unit/agent-llms.test.mjs fails when they disagree.
 *
 * `remote: false` marks a command that a Seance session refuses with
 * REMOTE_UNAVAILABLE: one that needs the person at the browser (a download, a
 * user gesture, a permission), and one that reads or changes what the person
 * stored in this browser. Seance relays every answer to everyone in the
 * session, and any writer in it can send commands.
 *
 * @module agent/descriptions
 */

const PROGRAM_RUNS = 'The program is checked first: one that does not compile changes nothing (INVALID_PROGRAM). If the renderer rejects it, the previous program runs again (COMPILE_FAILED). While the animation plays, the command returns once the new program has drawn a frame.'

export const COMMAND_GROUPS = [
    {
        title: 'Read state',
        commands: {
            getState: {
                does: 'Returns the state snapshot. Every envelope already includes it in `state`.',
                returns: 'the snapshot',
            },
            getProgram: {
                does: 'Returns the program text in the editor, and whether it is the program that runs. Through a Seance session it returns the text that the session holds.',
                returns: '`{ dsl, running }`',
            },
        },
    },
    {
        title: 'Programs',
        commands: {
            validateProgram: {
                does: 'Compiles `dsl` without applying it.',
                returns: '`{ valid, diagnostics }`',
            },
            setProgram: {
                does: `Puts \`dsl\` in the editor and runs it, like typing it. ${PROGRAM_RUNS} A program that runs goes to the online session, the program history and the page URL. Through a session, every \`image:<sha256>\` that the program names must already be in the session (NOT_FOUND_IMAGE).`,
                returns: '`{ applied: true, diagnostics }` (warnings only)',
            },
            formatProgram: {
                does: 'Formats the program in the editor, like the "Format DSL" action, and runs the result. A program that does not compile stays as it is (INVALID_PROGRAM).',
                returns: '`{ changed }`, false when the program was already formatted',
            },
            resetProgram: {
                does: `Runs the original program again: the program loaded at startup, or the last gallery example loaded. ${PROGRAM_RUNS}`,
                returns: '`{ applied: true, diagnostics }`',
                remote: false,
            },
            stepHistory: {
                does: 'Steps through the history of programs that ran, like Cmd/Ctrl+Alt+Left and Right. `back` runs the older program, `forward` the newer one. The history is stored in the browser, so a session cannot reach it.',
                returns: '`{ applied }`, false when there is no older or newer program',
                remote: false,
            },
        },
    },
    {
        title: 'Gallery and shared links',
        commands: {
            listExamples: {
                does: 'Lists the examples in the gallery, without their program text.',
                returns: '`{ total, examples: [{ title, tagline, tags }] }`',
            },
            loadExample: {
                does: `Runs the gallery example named \`title\`. Without \`title\` it runs a random example, like "Shuffle to a random example". The example becomes the program that resetProgram restores. ${PROGRAM_RUNS}`,
                returns: '`{ title, applied: true, diagnostics }`',
            },
            importComposition: {
                does: `Loads a composition from a Noise Factor sharing link (https://sharing.noisedeck.app/s/CODE) or its code, like "import from url...". Custom effects in the composition join the \`user\` namespace. A session cannot load one: a custom effect brings its own shader code, which only the person may let into their tab. ${PROGRAM_RUNS}`,
                returns: '`{ title, effects, images, applied: true, diagnostics }`, where `effects` lists the custom effect names and `images` counts the images',
                remote: false,
            },
        },
    },
    {
        title: 'Saved programs',
        commands: {
            listPrograms: {
                does: 'Lists the programs saved in this browser.',
                returns: '`{ total, programs: [{ name, savedAt, chars }] }`, with `savedAt` in milliseconds since 1970',
                remote: false,
            },
            saveProgram: {
                does: 'Saves the program in the editor under `name`, with its images, like "save program". A name that is in use fails with CONFLICT_PROGRAM_EXISTS unless `overwrite` is true.',
                returns: '`{ saved: true, name }`',
                remote: false,
            },
            loadProgram: {
                does: `Runs the saved program named \`name\`, like "load program". ${PROGRAM_RUNS}`,
                returns: '`{ name, applied: true, diagnostics }`',
                remote: false,
            },
            deleteProgram: {
                does: 'Deletes the saved program named `name`, like "delete program". This cannot be undone.',
                returns: '`{ deleted: true, name }`',
                remote: false,
            },
        },
    },
    {
        title: 'Scenes',
        commands: {
            listScenes: {
                does: 'Lists the scene slots that hold a program. Scenes are slots 1 to 9 that the number keys recall, stored in the browser.',
                returns: '`{ scenes: [{ slot, chars }] }`',
                remote: false,
            },
            saveScene: {
                does: 'Saves the program in the editor, with its images, to scene `slot`, like Cmd/Ctrl+Shift+1 to 9.',
                returns: '`{ saved: true, slot }`',
                remote: false,
            },
            loadScene: {
                does: `Runs the program in scene \`slot\`, like the number keys 1 to 9. ${PROGRAM_RUNS}`,
                returns: '`{ slot, applied: true, diagnostics }`',
                remote: false,
            },
        },
    },
    {
        title: 'Effects',
        commands: {
            searchEffects: {
                does: 'Lists effects whose id, description or tags contain `query`. `namespace` keeps one namespace. Custom effects are in the `user` namespace; a session lists only the built-in effects.',
                returns: '`{ total, effects: [{ effectId, namespace, name, description, tags }] }`',
            },
            getEffectDefinition: {
                does: 'Returns the DSL function name and the parameters of one effect. Through a session, a custom (`user`) effect answers REMOTE_UNAVAILABLE.',
                returns: '`{ effectId, func, namespace, description, params: [{ name, type, default, min?, max?, enum?, choices?, label? }] }`',
            },
        },
    },
    {
        title: 'Output surfaces',
        commands: {
            setOutput: {
                does: `Shows surface \`surface\` on the canvas by changing the program's \`render(oN)\` line, like "Switch render output". \`next\` and \`previous\` move through the surfaces that the program writes. ${PROGRAM_RUNS}`,
                returns: '`{ surface, changed }`',
            },
            clearSurfaces: {
                does: 'Clears the feedback state of surfaces o0 to o7 by compiling the program again, like "Hush".',
                returns: '`{ cleared: true }`',
            },
        },
    },
    {
        title: 'Playback and tempo',
        commands: {
            play: { does: 'Starts the animation.', returns: '`{ playing }`' },
            pause: { does: 'Stops the animation. The current frame stays visible.', returns: '`{ playing }`' },
            setTempo: {
                does: 'Sets the tempo. One animation loop lasts one bar of four beats, times `divider`. Omit a field to keep its value. While the tempo follows MIDI clock, `bpm` fails with CONFLICT_TEMPO_SOURCE.',
                returns: '`{ bpm, divider, source, loopSeconds }`, where `source` is `manual` or `midi`',
            },
        },
    },
    {
        title: 'View',
        commands: {
            setView: {
                does: 'Shows or hides a panel: the code editor, the documentation, the live inputs panel, the surface previews (`surfacePips`), the performance overlay or the status row. `performanceMode` hides everything but the canvas.',
                returns: '`{ panel, visible }`',
                remote: false,
            },
            setBackend: {
                does: 'Selects the WebGL2 or WebGPU renderer and reloads the page, like the "Switch to ... backend" actions. A browser without WebGPU stays on WebGL2.',
                returns: '`{ backend, reloading }`',
                remote: false,
            },
        },
    },
    {
        title: 'Images',
        commands: {
            getThumbnail: {
                does: 'Returns an image of the frame on the canvas. Nothing renders for it: while the animation is paused, the image is the frame on screen, which can be from before the last program change. Through a Seance session the image is added to the session as its own bytes, and `image` replaces `bytes`.',
                returns: '`{ bytes, mimeType, width, height }`, with `bytes` in base64. Through a session: `{ image: { id, mimeType, bytes }, mimeType, width, height }`, where `image.bytes` is the byte count',
            },
            exportImage: {
                does: 'Saves the canvas as a browser download, like "quick save as png" and "quick save as jpg". Observe the browser download to confirm the file.',
                returns: '`{ started: true, format, width, height }`',
                remote: false,
            },
        },
    },
    {
        title: 'At the browser',
        commands: {
            setRecording: {
                does: 'Starts or stops a video recording of the canvas. Stopping it starts a browser download of the video. `quality` selects `high` (1080p), `standard` (720p) or `low` (480p) for the next recording.',
                returns: '`{ recording, quality }`',
                remote: false,
            },
            setFullscreen: {
                does: 'Enters or leaves fullscreen. The browser allows fullscreen only soon after the person clicked or pressed a key; otherwise this fails with BROWSER_REFUSED.',
                returns: '`{ fullscreen }`',
                remote: false,
            },
            useLiveInput: {
                does: 'Opens the live inputs panel and starts a source, like the command palette actions: the webcam or a screen capture as the media() source, the microphone for audio values, or MIDI. The browser asks the person for permission. This returns before the person answers; read `state.liveMedia` later.',
                returns: '`{ requested: true, source }`',
                remote: false,
            },
        },
    },
]
