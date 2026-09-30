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
    Effect,
    registerStarterOps,
    mergeIntoEnums
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
 * Register a portable effect from the sharing API response format
 * Effects come pre-parsed with shaders embedded.
 * @param {object} effectData - Effect data from the API
 * @returns {object} Registered effect info
 */
export function registerPortableEffect(effectData) {
    const {
        name,
        func,
        namespace,
        globals = {},
        passes = [],
        shaders = {}
    } = { ...portableDefinition(effectData), shaders: effectData.shaders || {} }

    const effectFunc = func || name

    // Retain the complete declarative contract for re-sharing
    const effectId = `${namespace}/${effectFunc}`
    loadedPortableEffects.set(effectId, { ...portableDefinition(effectData), shaders })

    // Construct a real Effect instance so lifecycle hooks (asyncInit, onInit,
    // onUpdate, onDestroy) inherit from Effect.prototype. Plain objects fail
    // the pipeline's `effectDef.asyncInit === Effect.prototype.asyncInit` guard
    // and crash compilation with `t.asyncInit is not a function`.
    const instance = new Effect(portableDefinition(effectData))
    instance.starter = effectData.starter
    instance.shaders = shaders

    // Determine if this is a starter effect (no pipeline inputs)
    const isStarter = checkIsStarter(instance)

    // Build effect wrapper
    const effect = {
        id: `${namespace}/${effectFunc}`,
        namespace,
        name: effectFunc,
        func: effectFunc,
        instance,
        globals,
        passes,
        shaders,
        isUserEffect: true,
        isPortable: true
    }

    // Build the full effect key (namespace.func)
    const fullEffectKey = `${namespace}.${effect.func}`

    // Use the engine's registration contract for parameter types and aliases.
    const choicesToRegister = CanvasRenderer.prototype.registerEffectWithRuntime(effect)
    if (choicesToRegister && Object.keys(choicesToRegister).length > 0) {
        mergeIntoEnums(choicesToRegister)
    }

    if (isStarter) {
        registerStarterOps([fullEffectKey])
    }

    console.log(`[sharingLoader] Registered portable effect: ${effectFunc}`)

    return effect
}

/**
 * Check if an effect is a starter (doesn't need pipeline input)
 * @private
 */
function checkIsStarter(instance) {
    if (typeof instance.starter === 'boolean') return instance.starter
    const passes = instance.passes || []
    if (passes.length === 0) return true

    const pipelineInputs = [
        'inputTex', 'inputTex3d', 'inputGeo', 'src',
        'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'
    ]

    for (const pass of passes) {
        if (!pass.inputs) continue
        const inputs = Object.values(pass.inputs)
        if (inputs.some(val => pipelineInputs.includes(val))) {
            return false
        }
    }

    return true
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
                const registered = registerPortableEffect(effectData)
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
