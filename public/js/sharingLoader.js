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
// The sharing image helpers. The file is cached as immutable for each `v`, so
// a change to the helpers needs a new `v` here.
export const PORTABLE_IMAGES_URL = 'https://sharing.noisedeck.app/js/portableImages.js?v=images-20261006'

/** The sharing image helpers module. */
export function loadImageTools() {
    return import(PORTABLE_IMAGES_URL)
}

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
 * @param {object} [options]
 * @param {boolean} [options.loadImages] - Load the image files the composition lists
 * @returns {Promise<object>} Composition data including dsl, effects, title, etc.
 */
export async function fetchComposition(code, { loadImages = true } = {}) {
    // ?images=files keeps the program's image:<id> media URLs and lists the
    // composition's images as { id, url } files.
    const response = await fetch(`${SHARING_API_BASE}/api/composition/${code}?images=files`)

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Composition not found or expired')
        }
        throw new Error(`Failed to fetch composition: ${response.status}`)
    }

    const composition = await response.json()
    if (loadImages) await loadSharedImages(composition)
    return composition
}

/**
 * Load a fetched composition's image files into the { id, blob, ... }
 * images the renderer binds. A program image that cannot be loaded is removed
 * from the program, so the program renders as it did before images were
 * shared, instead of failing to compile.
 */
async function loadSharedImages(composition) {
    const listed = Array.isArray(composition.images) ? composition.images : []
    composition.images = await loadSharedImageFiles(listed)
    const loaded = new Set(composition.images.map(image => image.id))
    const missing = new Set(listed.filter(image => !loaded.has(image?.id)).map(image => image?.id))
    if (!missing.size || typeof composition.dsl !== 'string') return
    const { replaceMediaUrls } = await loadImageTools()
    composition.dsl = replaceMediaUrls(composition.dsl, url => url?.startsWith('image:') && missing.has(url.slice(6)) ? null : url)
}

/**
 * Upload an image file to the sharing service.
 * @param {Blob} blob - The image file (PNG, JPEG, GIF or WebP)
 * @returns {Promise<string>} The id the service gives it, named as `image:<id>`
 */
export async function uploadImage(blob) {
    const response = await fetch(`${SHARING_API_BASE}/api/images`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob
    })
    if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Image upload failed: ${response.status}`)
    }
    return (await response.json()).id
}

/**
 * Upload the images a program uses to the sharing service as files, and name
 * each one in the program by the id the service returns.
 *
 * Each file is the one this browser stores under the image's id, or else the
 * prepared image's bytes as a file.
 *
 * @param {string} dsl - The program, naming each image as `image:<id>`
 * @param {Array<{id: string, blob: Blob, mimeType?: string}>} images - From prepareImagesForShare
 * @param {object} [options]
 * @param {object} [options.tools] - The sharing image helpers
 * @param {(id: string) => Promise<Blob|null>} [options.storedImage] - Stored image file by id
 * @returns {Promise<string>} The program to share
 */
export async function uploadProgramImages(dsl, images = [], { tools, storedImage = storedProgramImage } = {}) {
    if (!images.length) return dsl
    tools = tools || await loadImageTools()
    const ids = new Map()
    for (const image of images) {
        // The id is the SHA-256 of the bytes, so a stored file is the same image.
        const stored = await storedImage(image.id).catch(() => null)
        const blob = stored && stored.type === image.mimeType ? stored : tools.imageToBlob(image)
        ids.set(image.id, await uploadImage(blob))
    }
    if ([...ids].every(([from, to]) => from === to)) return dsl
    return tools.replaceMediaUrls(dsl, url => url?.startsWith('image:') && ids.has(url.slice(6)) ? `image:${ids.get(url.slice(6))}` : url)
}

async function storedProgramImage(id) {
    const { getProgramImage } = await import('./programImages.js')
    return getProgramImage(id)
}

/**
 * Upload a share screenshot as a JPEG file. The screenshot is best-effort: if
 * it cannot be encoded or uploaded, the program is shared without one.
 * @param {HTMLCanvasElement|null} canvas - The screenshot
 * @returns {Promise<string|undefined>} The uploaded screenshot's id
 */
export async function uploadScreenshot(canvas) {
    try {
        const blob = canvas ? await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85)) : null
        return blob ? await uploadImage(blob) : undefined
    } catch (error) {
        console.warn('Share screenshot was not uploaded:', error)
        return undefined
    }
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
    const retained = loadedPortableEffects.get(effectId)
    // The bare-name lookup is owned by the shared contract: after registration
    // it resolves to a pre-existing built-in (restored) or to nothing at all
    // (portable effects belong to user.*), so the loader never touches it.
    try {
        // The shared contract validates completely before touching any
        // registry state, so a rejected definition leaves the prior effect
        // untouched.
        registered = await register()
    } catch (error) {
        const duplicate = error instanceof Error && error.message.includes('is already registered')
        if (!duplicate || !retained) throw error
        // Replacement of an effect this loader registered earlier (e.g.
        // re-importing an updated ZIP): drop only the user.* registration keys
        // and retry. The bare name is left alone — the shared contract
        // deliberately restores a pre-existing built-in lookup under it, and
        // dropping it here would remove that alias. If the retry still fails,
        // the prior runtime registration is already gone, so a retained entry
        // would re-share an effect that no longer resolves — invalidate it and
        // surface the error.
        for (const key of [`user.${func}`, `user/${func}`]) {
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
 * @param {object} [options]
 * @param {boolean} [options.loadImages] - Load the image files; false for
 *   previews, which render without images
 * @returns {Promise<{dsl: string, title: string, effects: object[]}>} Loaded composition
 */
export async function loadFromCode(code, { loadImages = true } = {}) {
    const composition = await fetchComposition(code, { loadImages })

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

/**
 * Shared compositions list their images as { id, url } files. Load each file
 * into the { id, blob, ... } images the renderer binds, checked against its
 * id. An image that an older response carried as a base64 { id, dataUrl } is
 * read into the same Blob record. An image that cannot be loaded is left out
 * and logged.
 */
export async function loadSharedImageFiles(images = []) {
    if (!images.some(image => image?.url || image?.dataUrl !== undefined)) return images
    const { prepareImageFile, imageToBlob } = await loadImageTools()
    const loaded = await Promise.all(images.map(async image => {
        if (image?.blob instanceof Blob) return image
        try {
            let blob
            if (image?.dataUrl !== undefined) blob = imageToBlob(image)
            else if (image?.url) {
                const response = await fetch(image.url)
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                blob = await response.blob()
            } else return image
            const prepared = await prepareImageFile(blob)
            if (prepared.id !== image.id) throw new Error('the image bytes do not match their id')
            return prepared
        } catch (error) {
            console.warn(`Shared image ${image.id} was not loaded:`, error)
            return null
        }
    }))
    return loaded.filter(Boolean)
}
