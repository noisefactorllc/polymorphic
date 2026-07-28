/**
 * Text effect parameters
 *
 * Turns compiled DSL steps into the parameters the embed renderer needs to
 * rasterize a text overlay.
 *
 * The input is `extractEffectsFromDsl()` output, i.e. the real compiler's view
 * of the program. Reading the compiler's args rather than pattern-matching the
 * DSL source is what lets this handle triple-quoted multi-line strings, quotes
 * and parens inside the text, aliased parameter names, and more than one text
 * effect in a chain. It also means the effect definition's own defaults arrive
 * already resolved.
 *
 * Kept free of DOM and bundle imports so it can be unit tested directly.
 *
 * @module textParams
 */

/**
 * Fallbacks for a parameter the compiler did not resolve. These mirror the
 * defaults on the upstream `filter.text` effect definition.
 */
export const TEXT_DEFAULTS = {
    text: 'Hello World',
    font: 'Nunito',
    size: 0.1,
    posX: 0.5,
    posY: 0.5,
    color: '#ffffff',
    rotation: 0,
    bgColor: '#000000',
    bgOpacity: 0,
    justify: 'center'
}

/** Fully-qualified name of the upstream text effect. */
const TEXT_EFFECT = 'filter.text'

/**
 * Convert a compiler color value to an RGB triple in the 0-1 range.
 *
 * The compiler hands back a hex string for a color left at its default and an
 * RGBA float array for one authored in the DSL, so both forms are accepted.
 *
 * @param {string|number[]|null|undefined} value
 * @returns {number[]} `[r, g, b]`, white if the value is unusable
 */
export function toRgb(value) {
    if (Array.isArray(value)) {
        const rgb = value.slice(0, 3).map(Number)
        while (rgb.length < 3) rgb.push(0)
        return rgb.every(Number.isFinite) ? rgb : [1, 1, 1]
    }

    if (typeof value === 'string') {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value.trim())
        if (match) {
            return [
                parseInt(match[1], 16) / 255,
                parseInt(match[2], 16) / 255,
                parseInt(match[3], 16) / 255
            ]
        }
    }

    return [1, 1, 1]
}

/**
 * @param {object} effect - A parsed effect from `extractEffectsFromDsl()`
 * @returns {boolean} Whether it is the text overlay effect
 */
function isTextEffect(effect) {
    if (!effect) return false
    return effect.effectKey === TEXT_EFFECT ||
        effect.fullName === TEXT_EFFECT ||
        effect.name === 'text'
}

/**
 * Pick the first defined value, so that `0` and `''` are kept rather than
 * being replaced by a default.
 *
 * @param {...*} values
 * @returns {*} The first value that is neither undefined nor null
 */
function firstDefined(...values) {
    return values.find(v => v !== undefined && v !== null)
}

/**
 * @param {*} value
 * @param {number} fallback
 * @returns {number} `value` as a finite number, or `fallback`
 */
function num(value, fallback) {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

/**
 * Build render parameters from one compiled text step.
 *
 * @param {object} args - Resolved args for the step
 * @returns {object} Parameters for the text canvas
 */
function paramsFromArgs(args = {}) {
    // `matteColor`/`matteOpacity` are the effect's own parameter names;
    // `bgColor`/`bgOpacity` are the documented aliases. Accept either.
    const bgColor = firstDefined(args.matteColor, args.bgColor, TEXT_DEFAULTS.bgColor)
    const bgOpacity = firstDefined(args.matteOpacity, args.bgOpacity, TEXT_DEFAULTS.bgOpacity)

    return {
        text: String(firstDefined(args.text, TEXT_DEFAULTS.text)),
        font: String(firstDefined(args.font, TEXT_DEFAULTS.font)),
        size: num(firstDefined(args.size, TEXT_DEFAULTS.size), TEXT_DEFAULTS.size),
        posX: num(firstDefined(args.posX, TEXT_DEFAULTS.posX), TEXT_DEFAULTS.posX),
        posY: num(firstDefined(args.posY, TEXT_DEFAULTS.posY), TEXT_DEFAULTS.posY),
        rotation: num(firstDefined(args.rotation, TEXT_DEFAULTS.rotation), TEXT_DEFAULTS.rotation),
        justify: String(firstDefined(args.justify, TEXT_DEFAULTS.justify)),
        color: toRgb(firstDefined(args.color, TEXT_DEFAULTS.color)),
        bgColor: toRgb(bgColor),
        bgOpacity: num(bgOpacity, TEXT_DEFAULTS.bgOpacity)
    }
}

/**
 * Collect the render parameters for every text effect in a compiled program.
 *
 * @param {object[]} effects - `extractEffectsFromDsl()` output
 * @returns {Array<{params: object, stepIndex: number}>} One entry per text
 *   effect, in chain order. `stepIndex` is the effect's `temp`, which is what
 *   the pipeline binds its texture to (`pass.stepIndex = step.temp`) — not the
 *   global step index.
 */
export function textEffectsFromParsed(effects) {
    if (!Array.isArray(effects)) return []

    return effects.filter(isTextEffect).map(effect => ({
        params: paramsFromArgs(effect.args),
        stepIndex: num(firstDefined(effect.temp, effect.stepIndex), 0)
    }))
}
