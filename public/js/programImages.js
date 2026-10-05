/**
 * Program images - the image files that saved programs use.
 *
 * A program's DSL names each image it uses as `image:<sha256>`. Programs,
 * scenes and snapshot history live in localStorage and hold only that DSL;
 * the image is stored here, in IndexedDB, as the original file's bytes in a
 * Blob. There is one record per image however many programs use it.
 *
 * localStorage is a few megabytes per origin, so images saved inside programs
 * as base64 text filled it and every later save failed. IndexedDB is a share
 * of the disk. Stored images are never deleted.
 */

const DB_NAME = 'polymorphic-program-images'
const DB_VERSION = 1
const IMAGES_STORE = 'images'
const IMAGE_ID = /^[a-f0-9]{64}$/
const IMAGE_REF = /image:([a-f0-9]{64})/g
// A quoted base64 image data URL, which is how older versions wrote a dropped
// or picked image into a media() call.
const IMAGE_TEXT = /(["'])data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})\1/g
const IMAGE_DATA_URL = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/

let dbPromise = null

function openDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
                const db = request.result
                // Cleared site data closes the connection; open a new one next time.
                db.onclose = () => { dbPromise = null }
                resolve(db)
            }
            request.onupgradeneeded = (event) => {
                const db = event.target.result
                if (!db.objectStoreNames.contains(IMAGES_STORE)) {
                    db.createObjectStore(IMAGES_STORE, { keyPath: 'id' })
                }
            }
        }).catch(error => {
            dbPromise = null
            throw error
        })
    }
    return dbPromise
}

/**
 * Run `work` in one transaction and settle when the transaction commits, so a
 * caller that awaits a write knows the bytes are on disk.
 */
async function transact(mode, work) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IMAGES_STORE, mode)
        const result = work(tx.objectStore(IMAGES_STORE))
        tx.oncomplete = () => resolve(result?.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error('Image storage transaction aborted'))
    })
}

/**
 * The id of an image: the SHA-256 of its bytes, in lowercase hex.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function imageId(blob) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Image ids a DSL references, each once.
 * @param {string} dsl
 * @returns {string[]}
 */
export function referencedImageIds(dsl) {
    return typeof dsl === 'string' ? [...new Set(Array.from(dsl.matchAll(IMAGE_REF), match => match[1]))] : []
}

/**
 * Whether a DSL carries an image as base64 text.
 * @param {string} dsl
 * @returns {boolean}
 */
export function hasImageText(dsl) {
    return typeof dsl === 'string' && dsl.search(IMAGE_TEXT) !== -1
}

function decodeBase64(type, base64) {
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return new Blob([bytes], { type })
}

/**
 * Decode `{id, dataUrl}` images and check each against its id.
 * @param {Array<{id: string, dataUrl: string}>} images
 * @returns {Promise<Array<{id: string, blob: Blob}>>}
 */
async function decodeImages(images) {
    const decoded = []
    for (const image of images) {
        const match = typeof image?.dataUrl === 'string' && IMAGE_DATA_URL.exec(image.dataUrl)
        if (!match || !IMAGE_ID.test(image.id)) throw new Error('Invalid program image')
        const blob = decodeBase64(match[1], match[2])
        if (await imageId(blob) !== image.id) throw new Error(`Image bytes do not match their id: ${image.id}`)
        decoded.push({ id: image.id, blob })
    }
    return decoded
}

/**
 * Decode the images that a DSL, and the `images` list older saves kept beside
 * it, carry as base64 text. Stores nothing.
 *
 * @param {string} dsl
 * @param {Array<{id: string, dataUrl: string}>} [images]
 * @returns {Promise<{dsl: string, images: Array<{id: string, blob: Blob}>}>}
 *   the DSL with every image it carried as text named by reference, and the
 *   decoded images
 */
export async function decodeImageText(dsl, images = []) {
    const decoded = new Map((await decodeImages(images)).map(image => [image.id, image]))
    const ids = new Map()
    for (const [text, , type, base64] of dsl.matchAll(IMAGE_TEXT)) {
        if (ids.has(text)) continue
        const blob = decodeBase64(type, base64)
        const id = await imageId(blob)
        ids.set(text, id)
        decoded.set(id, { id, blob })
    }
    return {
        dsl: ids.size ? dsl.replace(IMAGE_TEXT, (text, quote) => `${quote}image:${ids.get(text)}${quote}`) : dsl,
        images: [...decoded.values()]
    }
}

/**
 * Store images. Resolves once every image is committed; rejects if any is
 * not, and the caller must then not save anything that names them.
 *
 * @param {Array<{id: string, blob: Blob}>} images
 */
export async function storeProgramImages(images = []) {
    if (!images.length) return
    for (const { id, blob } of images) {
        if (!IMAGE_ID.test(id) || !(blob instanceof Blob)) throw new Error('Invalid program image')
    }
    const storedAt = Date.now()
    await transact('readwrite', store => {
        for (const { id, blob } of images) store.put({ id, blob, storedAt })
    })
}

/**
 * Store a dropped or picked image file.
 * @param {Blob} file
 * @returns {Promise<string>} the reference a program names it by, `image:<sha256>`
 */
export async function storeImageFile(file) {
    const id = await imageId(file)
    await storeProgramImages([{ id, blob: file }])
    return `image:${id}`
}

/**
 * The stored image file for `id`, or null when it is not stored or storage is
 * unavailable.
 * @param {string} id
 * @returns {Promise<Blob|null>}
 */
export async function getProgramImage(id) {
    if (typeof indexedDB === 'undefined' || !IMAGE_ID.test(id)) return null
    try {
        const record = await transact('readonly', store => store.get(id))
        return record?.blob || null
    } catch (error) {
        console.error('Error reading program image:', error)
        return null
    }
}

/**
 * Store the images that `dsl`, and an `images` list beside it, carry as base64
 * text. Resolves with `dsl` naming each of them by reference once all are
 * committed; rejects if any cannot be decoded or stored.
 *
 * @param {string} dsl
 * @param {Array<{id: string, dataUrl: string}>} [images]
 * @returns {Promise<string>}
 */
export async function storeImageText(dsl, images = []) {
    const decoded = await decodeImageText(dsl, images)
    await storeProgramImages(decoded.images)
    return decoded.dsl
}

/**
 * Store every image a program uses before the program is saved: the images it
 * carries as text, and the referenced images that only a shared composition
 * or online session brought, which arrive in `available`. Resolves with the
 * DSL to save, which names every image by reference; rejects if a referenced
 * image is neither stored nor available.
 *
 * @param {string} dsl
 * @param {Array<{id: string, dataUrl: string}>} [available]
 * @returns {Promise<string>}
 */
export async function storeDslImages(dsl, available = []) {
    const decoded = await decodeImageText(dsl)
    const ids = referencedImageIds(decoded.dsl).filter(id => !decoded.images.some(image => image.id === id))
    if (ids.length) {
        const stored = new Set(await transact('readonly', store => store.getAllKeys()))
        const missing = ids.filter(id => !stored.has(id)).map(id => available.find(image => image.id === id))
        if (missing.some(image => !image)) throw new Error('Image bytes are not available yet; wait for images to load and try again')
        decoded.images.push(...await decodeImages(missing))
    }
    await storeProgramImages(decoded.images)
    return decoded.dsl
}

/**
 * Move the images that programs, scenes and snapshot history saved before
 * images had their own storage keep as base64 text in localStorage out to
 * IndexedDB. Each holder rewrites only entries whose images are committed.
 * Runs once per page load.
 *
 * @param {Array<{moveEmbeddedImages: (store: typeof storeImageText) => Promise<number>}>} holders
 */
export async function migrateProgramImages(holders) {
    if (typeof indexedDB === 'undefined') return
    for (const holder of holders) await holder.moveEmbeddedImages(storeImageText)
}
