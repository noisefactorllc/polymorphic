/**
 * Argument schemas for PolymorphicAgent commands, and the validator that
 * checks them. Every schema is strict: an undeclared field fails with
 * INVALID_ARGS_UNKNOWN, so a command with no arguments accepts only {}.
 * `default` documents the value a handler uses when the field is omitted.
 *
 * Supported subset: object (properties, required, additionalProperties),
 * string (enum, minLength), number and integer (min, max, enum), boolean.
 *
 * @module agent/schemas
 */

const strict = (properties, required = []) =>
    ({ type: 'object', properties, required, additionalProperties: false })

const PROGRAM = strict({ dsl: { type: 'string', minLength: 1 } }, ['dsl'])
const NONE = strict({})
const NAME = { type: 'string', minLength: 1 }
const SLOT = { type: 'integer', min: 1, max: 9 }

/** The surfaces a program writes and renders: o0 to o7. */
export const SURFACES = ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']

/** The panels and modes that setView shows and hides. */
export const VIEW_PANELS = ['editor', 'docs', 'liveInputs', 'surfacePips', 'performanceOverlay', 'statusRow', 'performanceMode']

export const SCHEMAS = {
    getState: NONE,
    getProgram: NONE,
    validateProgram: PROGRAM,
    setProgram: PROGRAM,
    formatProgram: NONE,
    resetProgram: NONE,
    stepHistory: strict({ direction: { type: 'string', enum: ['back', 'forward'] } }, ['direction']),
    listExamples: NONE,
    loadExample: strict({ title: NAME }),
    importComposition: strict({ link: NAME }, ['link']),
    listPrograms: NONE,
    saveProgram: strict({ name: NAME, overwrite: { type: 'boolean', default: false } }, ['name']),
    loadProgram: strict({ name: NAME }, ['name']),
    deleteProgram: strict({ name: NAME }, ['name']),
    listScenes: NONE,
    saveScene: strict({ slot: SLOT }, ['slot']),
    loadScene: strict({ slot: SLOT }, ['slot']),
    searchEffects: strict({
        query: { type: 'string' },
        namespace: { type: 'string' },
        limit: { type: 'integer', min: 1, max: 500, default: 50 },
    }),
    getEffectDefinition: strict({ effectId: NAME }, ['effectId']),
    setOutput: strict({ surface: { type: 'string', enum: [...SURFACES, 'next', 'previous'] } }, ['surface']),
    clearSurfaces: NONE,
    play: NONE,
    pause: NONE,
    setTempo: strict({
        bpm: { type: 'number', min: 20, max: 400 },
        divider: { type: 'integer', enum: [1, 2, 4, 8, 16, 32] },
    }),
    setView: strict({ panel: { type: 'string', enum: VIEW_PANELS }, visible: { type: 'boolean' } }, ['panel', 'visible']),
    setBackend: strict({ backend: { type: 'string', enum: ['webgl2', 'webgpu'] } }, ['backend']),
    getThumbnail: strict({
        maxDimension: { type: 'integer', min: 16, max: 1024, default: 256 },
        format: { type: 'string', enum: ['png', 'jpg'], default: 'jpg' },
    }),
    exportImage: strict({ format: { type: 'string', enum: ['png', 'jpg'], default: 'png' } }),
    setRecording: strict({
        recording: { type: 'boolean' },
        quality: { type: 'string', enum: ['high', 'standard', 'low'] },
    }, ['recording']),
    setFullscreen: strict({ fullscreen: { type: 'boolean' } }, ['fullscreen']),
    useLiveInput: strict({ source: { type: 'string', enum: ['webcam', 'screen', 'microphone', 'midi'] } }, ['source']),
}

function fail(code, message, details) {
    return { ok: false, code, message, details }
}

function typeName(v) {
    if (v === null) return 'null'
    if (Array.isArray(v)) return 'array'
    return typeof v
}

/**
 * Validate `value` against `schema`.
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string, details: object}}
 */
export function validate(value, schema, path = '') {
    if (!schema) return { ok: true }
    const field = path || 'args'
    switch (schema.type) {
        case 'object': {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                return fail('INVALID_ARGS_TYPE', `${field}: expected object, got ${typeName(value)}`,
                    { field, expected: 'object', got: typeName(value) })
            }
            for (const req of schema.required || []) {
                if (!(req in value)) {
                    const f = path ? `${path}.${req}` : req
                    return fail('INVALID_ARGS_REQUIRED', `${f} is required`, { field: f })
                }
            }
            for (const key of Object.keys(value)) {
                const f = path ? `${path}.${key}` : key
                const sub = schema.properties?.[key]
                if (!sub) {
                    if (schema.additionalProperties === false) {
                        return fail('INVALID_ARGS_UNKNOWN', `${f}: unknown field`, { field: f })
                    }
                    continue
                }
                const r = validate(value[key], sub, f)
                if (!r.ok) return r
            }
            return { ok: true }
        }
        case 'string':
            if (typeof value !== 'string') {
                return fail('INVALID_ARGS_TYPE', `${field}: expected string, got ${typeName(value)}`,
                    { field, expected: 'string', got: typeName(value) })
            }
            if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
                return fail('INVALID_ARGS_RANGE', `${field}: shorter than ${schema.minLength} characters`,
                    { field, min: schema.minLength, got: value.length })
            }
            if (schema.enum && !schema.enum.includes(value)) {
                return fail('INVALID_ARGS_ENUM', `${field}: expected one of [${schema.enum.join(', ')}]`,
                    { field, allowed: schema.enum, got: value })
            }
            return { ok: true }
        case 'number':
        case 'integer':
            if (typeof value !== 'number' || !Number.isFinite(value)
                || (schema.type === 'integer' && !Number.isInteger(value))) {
                return fail('INVALID_ARGS_TYPE', `${field}: expected ${schema.type}, got ${typeName(value)}`,
                    { field, expected: schema.type, got: typeName(value) })
            }
            if ((typeof schema.min === 'number' && value < schema.min)
                || (typeof schema.max === 'number' && value > schema.max)) {
                return fail('INVALID_ARGS_RANGE', `${field}: ${value} is outside ${schema.min} to ${schema.max}`,
                    { field, min: schema.min, max: schema.max, got: value })
            }
            if (schema.enum && !schema.enum.includes(value)) {
                return fail('INVALID_ARGS_ENUM', `${field}: expected one of [${schema.enum.join(', ')}]`,
                    { field, allowed: schema.enum, got: value })
            }
            return { ok: true }
        case 'boolean':
            if (typeof value !== 'boolean') {
                return fail('INVALID_ARGS_TYPE', `${field}: expected boolean, got ${typeName(value)}`,
                    { field, expected: 'boolean', got: typeName(value) })
            }
            return { ok: true }
        default:
            return { ok: true }
    }
}
