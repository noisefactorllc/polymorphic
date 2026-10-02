/**
 * Value plumbing for the effect controls panel that has to agree with the
 * engine's DSL writer. Kept free of the DOM so it can be tested in Node.
 *
 * @module ui/effectControlValues
 */

/**
 * The enum a `member` parameter draws from. Specs name it with `enum` or
 * `enumPath`; some only carry a dotted default such as `palette.brushedMetal`,
 * the same fallback the engine's own demo UI uses.
 * @param {object} spec
 * @returns {string|null}
 */
export function memberEnumPath(spec) {
    const named = spec?.enumPath || spec?.enum
    if (named) return String(named)
    if (typeof spec?.default === 'string') {
        const parts = spec.default.split('.')
        if (parts.length > 1) return parts.slice(0, -1).join('.')
    }
    return null
}

/**
 * Dropdown entries for a `member` parameter. Each entry's `path` is the full
 * dotted enum path (`palette.afterimage`), the value the engine's DSL writer
 * emits verbatim for a member parameter. Anything else written to program
 * state, such as an AST-shaped `{ type: 'Member', path }` object, unparses as
 * `[object Object]` and breaks the program text.
 * @param {object|null} enumObj - The enum node the path resolves to
 * @param {string|null} enumPath
 * @returns {{ key: string, path: string, numeric: * }[]}
 */
export function memberEntries(enumObj, enumPath) {
    if (!enumObj || typeof enumObj !== 'object') return []
    return Object.entries(enumObj).map(([key, entry]) => ({
        key,
        path: enumPath ? `${enumPath}.${key}` : key,
        numeric: entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry,
    }))
}

/**
 * Match a stored member value to one of its entries. Program state holds the
 * enum's number after a compile, the full path after a control change, and a
 * DSL program may name a member with or without its enum prefix.
 * @param {{ key: string, path: string, numeric: * }[]} entries
 * @param {*} value
 * @returns {string} The matching entry's path, or '' when nothing matches
 */
export function memberPathFor(entries, value) {
    if (value === undefined || value === null) return ''
    let key = null
    if (value && typeof value === 'object') {
        if (Array.isArray(value.path)) key = value.path[value.path.length - 1]
        else if ('value' in value) return memberPathFor(entries, value.value)
    }
    for (const entry of entries) {
        if (entry.numeric === value || entry.path === value || entry.key === value || entry.key === key) {
            return entry.path
        }
    }
    return ''
}

/**
 * The surface, volume or geometry name a resource parameter refers to.
 * Program state holds `{ kind, name }` references after a compile and a bare
 * name after a control change; the DSL spells a surface `read(o1)`.
 * @param {*} value
 * @returns {string|null}
 */
export function resourceName(value) {
    if (typeof value === 'string') {
        const read = /^\s*read3?d?\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/.exec(value)
        return read ? read[1] : value
    }
    if (value && typeof value === 'object') {
        if (typeof value.name === 'string') return value.name
        if (typeof value._ast?.name === 'string') return value._ast.name
    }
    return null
}

/**
 * Whether a parameter gated by `ui.enabledBy` currently does anything. Same
 * grammar and comparisons as the engine's demo UI (`_evaluateEnableCondition`):
 * a bare param name is a truthy check; `{ param, eq|neq|gt|gte|lt|lte|in|notIn }`
 * compares, several operators AND together; `{ and }`, `{ or }`, `{ not }`
 * combine. Resource parameters compare by name, so `{ neq: 'none' }` works
 * whichever form the reference takes in program state.
 * @param {string|object} condition - The `enabledBy` value
 * @param {Record<string, *>} values - The step's current parameter values
 * @param {Record<string, object>} [globals] - The effect's parameter specs
 * @returns {boolean}
 */
export function isEnabled(condition, values, globals = {}) {
    if (typeof condition === 'string') return truthy(valueOf(condition, values, globals))
    if (!condition || typeof condition !== 'object') return true
    if (Array.isArray(condition.or)) return condition.or.some(c => isEnabled(c, values, globals))
    if (Array.isArray(condition.and)) return condition.and.every(c => isEnabled(c, values, globals))
    if (condition.not !== undefined) return !isEnabled(condition.not, values, globals)
    if (!condition.param) return true

    const value = valueOf(condition.param, values, globals)
    const ops = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']
    if (!ops.some(op => condition[op] !== undefined)) return truthy(value)

    const num = typeof value === 'number'
    let result = true
    if (condition.eq !== undefined) result = result && same(value, condition.eq)
    if (condition.neq !== undefined) result = result && !same(value, condition.neq)
    if (condition.gt !== undefined) result = result && num && value > condition.gt
    if (condition.gte !== undefined) result = result && num && value >= condition.gte
    if (condition.lt !== undefined) result = result && num && value < condition.lt
    if (condition.lte !== undefined) result = result && num && value <= condition.lte
    if (Array.isArray(condition.in)) result = result && condition.in.some(v => same(value, v))
    if (Array.isArray(condition.notIn)) result = result && !condition.notIn.some(v => same(value, v))
    return result
}

const RESOURCE_TYPES = new Set(['surface', 'volume', 'geometry'])

function valueOf(param, values, globals) {
    let value = values?.[param]
    if (value && typeof value === 'object' && '_varRef' in value) value = value.value
    if (RESOURCE_TYPES.has(globals?.[param]?.type)) return resourceName(value)
    return value
}

/**
 * A step's parameter values in the form `ui.enabledBy` conditions are written
 * in. Member conditions name enum paths (`{ in: ['oscType.noise1d'] }`), but
 * after a compile program state holds the enum's number, so members are
 * resolved to their full path first.
 * @param {Record<string, *>} values - Raw values from program state
 * @param {Record<string, object>} globals - The effect's parameter specs
 * @param {(path: string) => object|null} lookupEnum - Resolves an enum path
 * @returns {Record<string, *>}
 */
export function gateValues(values, globals, lookupEnum) {
    const out = { ...values }
    for (const [name, spec] of Object.entries(globals || {})) {
        if (spec?.type !== 'member' || out[name] === undefined) continue
        const enumPath = memberEnumPath(spec)
        const path = memberPathFor(memberEntries(lookupEnum(enumPath), enumPath), out[name])
        if (path) out[name] = path
    }
    return out
}

function same(a, b) {
    if (a === b) return true
    if (a === null || a === undefined || b === null || b === undefined) return false
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.0001)
    }
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.0001
    return false
}

function truthy(value) {
    if (value === undefined || value === null) return false
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (Array.isArray(value)) return value.some((v, i) => i !== 3 && Math.abs(v - 0.5) > 0.01)
    if (typeof value === 'string') return value.length > 0
    return true
}

/**
 * The step that owns the volume size a step renders at.
 *
 * Inside a 3D chain only the step that creates the volume decides its size:
 * the engine marks every downstream consumer's passes `inheritsVolumeSize` and
 * ignores the consumer's own `volumeSize`, at runtime and on a fresh compile
 * alike. A consumer's control therefore has to drive the owner, or moving it
 * changes the program text and nothing on screen.
 *
 * Walks the consumer's chain upstream. A chain that starts from
 * `read3d(volN)` continues from the step that wrote that volume.
 *
 * @param {object[]} plans - Compiled plans (`programState.getCompiled().plans`)
 * @param {object[]} passes - Pipeline graph passes
 * @param {number} stepIndex - The step whose control was moved
 * @returns {number|null} The owning step index, `stepIndex` itself when the
 *   step owns its volume, or null when no owner can be found
 */
export function volumeSizeOwner(plans, passes, stepIndex) {
    const passesOf = (index) => (passes || []).filter(p => p && p.stepIndex === index)
    const inherits = (index) => passesOf(index).some(p => p.inheritsVolumeSize)
    if (!inherits(stepIndex)) return stepIndex

    const steps = new Map()
    for (const plan of plans || []) {
        for (const step of plan?.chain || []) {
            if (typeof step?.temp === 'number') steps.set(step.temp, step)
        }
    }
    const volumeName = (tex) => (tex && typeof tex === 'object' ? tex.name : tex) || null
    const writerOf = (name) => {
        for (const step of steps.values()) {
            if (step.op === '_write3d' && volumeName(step.args?.tex3d) === name) return step
        }
        return null
    }

    const seen = new Set()
    let current = steps.get(stepIndex)
    while (current && !seen.has(current.temp)) {
        seen.add(current.temp)
        let prev = typeof current.from === 'number' ? steps.get(current.from) : null
        if (!prev) return null
        if (prev.op === '_read3d') {
            const writer = writerOf(volumeName(prev.args?.tex3d))
            prev = writer && typeof writer.from === 'number' ? steps.get(writer.from) : null
            if (!prev) return null
        }
        if (!prev.builtin && passesOf(prev.temp).length > 0 && !inherits(prev.temp)) {
            return prev.temp
        }
        current = prev
    }
    return null
}
