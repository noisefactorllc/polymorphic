/**
 * DSL sanitizers shared by the renderer and the preview surfaces.
 *
 * The /1 Noisemaker engine's synth.media has no `url` argument — it sources its
 * image from an external texture (uploaded as imageTex_step_N). The app, though,
 * writes `media(url: "<data-url|http|live>")` (drag-drop / camera / video), which
 * the engine rejects at compile with "Unknown argument 'url' for media()". These
 * helpers strip the url before the DSL reaches the engine, and restore it when
 * regenerating editor text, so the url survives round-trips (save / share /
 * parameter edits) while compilation still succeeds.
 *
 * The media-call matcher tolerates one level of nested parens — enough for real
 * URLs (e.g. ".../File_(1).png" or signed query strings). Deeper nesting is left
 * untouched and fails safe (the engine reports it) rather than being corrupted.
 */

// A single media(...) call, capturing its argument list. Global for replace().
const MEDIA_CALL = /\bmedia\s*\(((?:[^()]*|\([^()]*\))*)\)/gi
// A url:"..." / url:'...' argument (non-global; used with match/test only).
const URL_ARG = /\burl\s*:\s*("[^"]*"|'[^']*')/i

/**
 * Remove the engine-rejected url:"..." argument from every media() call.
 * Non-media DSL (and media() calls without a url) are returned unchanged.
 * @param {string} dsl - DSL source
 * @returns {string} DSL with media() url arguments removed
 */
export function stripMediaUrlArg(dsl) {
    if (!dsl) return dsl
    return dsl.replace(MEDIA_CALL, (_full, args) => {
        const cleaned = args
            .replace(/\burl\s*:\s*(?:"[^"]*"|'[^']*')\s*,?/i, '') // drop url:"..." (+ optional trailing comma)
            .replace(/,\s*$/, '')    // dangling comma if url was last
            .replace(/^\s*,\s*/, '') // dangling comma if url was first
            .trim()
        return `media(${cleaned})`
    })
}

/**
 * Carry media url arguments from a reference DSL into a regenerated one that has
 * had them stripped (e.g. the output of the engine's ProgramState.toDsl(), which
 * round-trips through the url-less compiled DSL). media() calls are matched by
 * source order — stable across parameter edits, which never add or remove
 * effects. A target call that already has a url, or whose reference counterpart
 * has none, is left unchanged.
 * @param {string} referenceDsl - DSL that still carries the urls (e.g. editor text)
 * @param {string} targetDsl - regenerated DSL with media urls missing
 * @returns {string} targetDsl with media urls restored
 */
export function restoreMediaUrls(referenceDsl, targetDsl) {
    if (!referenceDsl || !targetDsl) return targetDsl
    const urls = []
    referenceDsl.replace(MEDIA_CALL, (_full, args) => {
        const m = args.match(URL_ARG)
        urls.push(m ? m[1] : null)
        return _full
    })
    if (!urls.some(Boolean)) return targetDsl
    let i = 0
    return targetDsl.replace(MEDIA_CALL, (full, args) => {
        const url = urls[i++]
        if (!url || URL_ARG.test(args)) return full
        const inner = args.trim()
        return inner ? `media(url: ${url}, ${inner})` : `media(url: ${url})`
    })
}
