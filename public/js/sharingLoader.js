/**
 * Sharing Loader Module for Polymorphic
 *
 * Handles loading compositions from sharing.noisedeck.app URLs.
 * Supports loading DSL programs and portable effects.
 *
 * @module sharingLoader
 */

import {
    CanvasRenderer,
    unregisterEffect
} from './noisemaker/bundle.js'

const SHARING_API_BASE = 'https://sharing.noisedeck.app'

/**
 * Storage for portable effects loaded from sharing URLs.
 * These are kept so they can be re-shared when the user shares.
 * @type {Map<string, object>}
 */
const loadedPortableEffects = new Map()

/**
 * Get all loaded portable effects
 * @returns {Map<string, object>}
 */
export function getLoadedPortableEffects() {
    return loadedPortableEffects
}

/**
 * Clear all loaded portable effects
 */
export function clearLoadedPortableEffects() {
    loadedPortableEffects.clear()
}

/**
 * Fetch composition data from the sharing API
 * @param {string} code - The short code
 * @returns {Promise<object>} Composition data including dsl, effects, title, etc.
 */
export async function fetchComposition(code) {
    const response = await fetch(`${SHARING_API_BASE}/api/composition/${code}`)

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Composition not found or expired')
        }
        throw new Error(`Failed to fetch composition: ${response.status}`)
    }

    return response.json()
}

/** Build the declarative definition shared by import, registration and export. */
export function portableDefinition(data) {
    const definition = {
        name: data.name || data.func,
        func: data.func || data.name,
        namespace: 'user',
        description: data.description || '',
        tags: data.tags || ['user'],
        globals: data.globals || {},
        passes: data.passes || []
    }
    for (const key of ['starter', 'textures', 'outputTex3d', 'outputGeo',
        'uniformLayout', 'uniformLayouts', 'defaultProgram', 'paramAliases', 'openCategories']) {
        if (data[key] !== undefined) definition[key] = data[key]
    }
    return definition
}

/**
 * Renderer instance (if the app has booted one) that portable effects register
 * through, so enum merges and loaded-effect tracking stay live on the
 * renderer's own state. Before boot, registration falls back to a static
 * receiver sharing the engine prototype.
 * @type {object|null}
 */
let runtimeRenderer = null

/**
 * Provide the booted noisemaker CanvasRenderer instance.
 * @param {object} renderer - CanvasRenderer from the PolymorphicRenderer
 */
export function setRuntimeRenderer(renderer) {
    runtimeRenderer = renderer ?? null
}

/**
 * Register a portable effect from the sharing API response format
 * Effects come pre-parsed with shaders embedded.
 *
 * Registration, validation and starter classification are delegated to the
 * shared CanvasRenderer.registerPortableEffect contract (noisemaker cb22a05),
 * which rejects untrusted definitions: reserved/prototype-polluting keys,
 * non-identifier funcs, passes without programs, missing shader sources and
 * undeclared paramAliases. A portable effect this loader registered earlier
 * may be replaced (re-importing an updated ZIP); unknown duplicates are
 * rejected by the shared contract.
 *
 * @param {object} effectData - Effect data from the API
 * @returns {Promise<object>} Registered effect info
 */
export async function registerPortableEffect(effectData) {
    const definition = portableDefinition(effectData)
    const shaders = effectData.shaders || {}
    const func = definition.func || definition.name
    const effectId = `user/${func}`

    const receiver = runtimeRenderer ?? {
        registerEffectWithRuntime: CanvasRenderer.prototype.registerEffectWithRuntime,
        _enums: {},
        _loadedEffects: new Map()
    }
    const register = () => CanvasRenderer.prototype
        .registerPortableEffect.call(receiver, { ...definition, shaders })

    let registered
    try {
        // The shared contract validates completely before touching any
        // registry state, so a rejected definition leaves the prior effect
        // untouched.
        registered = await register()
    } catch (error) {
        const duplicate = error instanceof Error && error.message.includes('is already registered')
        if (!duplicate || !loadedPortableEffects.has(effectId)) throw error
        // Replacement of an effect this loader registered earlier (e.g.
        // re-importing an updated ZIP): drop the prior registration keys and
        // retry. If the retry still fails, the prior runtime registration is
        // already gone, so a retained entry would re-share an effect that no
        // longer resolves — invalidate it and surface the error.
        for (const key of [func, `user.${func}`, `user/${func}`]) {
            unregisterEffect(key)
        }
        try {
            registered = await register()
        } catch (retryError) {
            loadedPortableEffects.delete(effectId)
            throw retryError
        }
    }

    // Product wrapper: retain the engine result plus the fields the app and
    // the unit contract read back.
    const effect = {
        id: effectId,
        namespace: 'user',
        name: registered.name,
        func,
        instance: registered.instance,
        globals: definition.globals,
        passes: definition.passes,
        shaders,
        isUserEffect: true,
        isPortable: true
    }

    // Retain the complete declarative contract for re-sharing (only after a
    // successful registration so rejected definitions are not kept).
    loadedPortableEffects.set(effectId, { ...definition, shaders })

    console.log(`[sharingLoader] Registered portable effect: ${func}`)

    return effect
}

/**
 * Load a composition from a short code
 * Fetches the composition and registers any portable effects
 * @param {string} code - The short code
 * @returns {Promise<{dsl: string, title: string, effects: object[]}>} Loaded composition
 */
export async function loadFromCode(code) {
    const composition = await fetchComposition(code)

    // Register any portable effects
    const registeredEffects = []
    if (composition.effects && Array.isArray(composition.effects)) {
        for (const effectData of composition.effects) {
            try {
                const registered = await registerPortableEffect(effectData)
                registeredEffects.push(registered)
            } catch (err) {
                console.error(`Failed to register effect ${effectData.name}:`, err)
            }
        }
    }

    return {
        dsl: composition.dsl,
        images: composition.images || [],
        title: composition.title || '',
        description: composition.description || '',
        effects: registeredEffects,
        code: composition.code
    }
}

/**
 * Check if there's a code parameter in the URL
 * @returns {string|null} The short code or null
 */
export function getCodeFromUrl() {
    const urlParams = new URLSearchParams(window.location.search)
    return urlParams.get('code')
}
