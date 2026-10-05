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
let migration = null

// The image text of the DSL most recently stored by storeImageText, mapped to
// the id each image was committed under, so that compiling the same program
// again does not decode, hash and store its images again. Cleared whenever the
// connection closes, because the images may have gone with it.
let storedImageText = new Map()
let storedImageTextGeneration = 0

function forgetStoredImageText() {
    storedImageText = new Map()
    storedImageTextGeneration++
}

function openDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)
            request.onerror = () => reject(request.error)
            request.onblocked = () => reject(new Error('Image storage is blocked by another Polymorphic tab'))
            request.onsuccess = () => {
                const db = request.result
                // Let a newer version in another tab upgrade the database, and
                // reopen on next use rather than holding a closed connection.
                db.onversionchange = () => {
                    db.close()
                    dbPromise = null
                    forgetStoredImageText()
                }
                // Cleared site data closes the connection; open a new one next time.
                db.onclose = () => {
                    dbPromise = null
                    forgetStoredImageText()
                }
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
 * caller that awaits a write knows the bytes are on disk. Writes ask for
 * strict durability, because an entry drops its text copy of an image as soon
 * as the stored one commits.
 */
async function transact(mode, work) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = mode === 'readwrite'
            ? db.transaction(IMAGES_STORE, mode, { durability: 'strict' })
            : db.transaction(IMAGES_STORE, mode)
        const result = work(tx.objectStore(IMAGES_STORE))
        tx.oncomplete = () => resolve(result?.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error('Image storage transaction aborted'))
    })
}

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

/**
 * SHA-256 of `input` in lowercase hex, in plain JavaScript. imageId uses it
 * only when crypto.subtle is missing: a page served over plain HTTP, such as
 * a self-hosted copy opened by LAN address, is not a secure context.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @returns {string}
 */
export function sha256Hex(input) {
    const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input)
    // The message, a 1 bit, zeros, and the bit length as 64 bits, in 64-byte blocks.
    const padded = new Uint8Array((bytes.length + 72) & ~63)
    padded.set(bytes)
    padded[bytes.length] = 0x80
    const view = new DataView(padded.buffer)
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000))
    view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0)
    const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
    const w = new Uint32Array(64)
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15]
            const y = w[i - 2]
            const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
            const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
            w[i] = w[i - 16] + s0 + w[i - 7] + s1
        }
        let [a, b, c, d, e, f, g, h] = hash
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
            const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
            const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0
            h = g
            g = f
            f = e
            e = (d + t1) | 0
            d = c
            c = b
            b = a
            a = (t1 + t2) | 0
        }
        hash[0] += a
        hash[1] += b
        hash[2] += c
        hash[3] += d
        hash[4] += e
        hash[5] += f
        hash[6] += g
        hash[7] += h
    }
    return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('')
}

/**
 * SHA-256 of `bytes` in lowercase hex.
 * @param {ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
async function digestHex(bytes) {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return sha256Hex(bytes)
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes))
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The id of an image: the SHA-256 of its bytes, in lowercase hex.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function imageId(blob) {
    return digestHex(await blob.arrayBuffer())
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
    const decoded = await decodeText(dsl, images)
    return { dsl: decoded.dsl, images: decoded.images }
}

/**
 * decodeImageText, which also resolves with the id of each image text, and
 * names the image texts in `known` by the id given there without decoding
 * them again.
 *
 * @param {string} dsl
 * @param {Array<{id: string, dataUrl: string}>} images
 * @param {Map<string, string>} [known]
 */
async function decodeText(dsl, images, known = new Map()) {
    const decoded = new Map((await decodeImages(images)).map(image => [image.id, image]))
    const ids = new Map()
    for (const [text, , type, base64] of dsl.matchAll(IMAGE_TEXT)) {
        if (ids.has(text)) continue
        if (known.has(text)) {
            ids.set(text, known.get(text))
            continue
        }
        const blob = decodeBase64(type, base64)
        const id = await imageId(blob)
        ids.set(text, id)
        decoded.set(id, { id, blob })
    }
    return {
        dsl: ids.size ? dsl.replace(IMAGE_TEXT, (text, quote) => `${quote}image:${ids.get(text)}${quote}`) : dsl,
        images: [...decoded.values()],
        ids
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
 * Store a dropped or picked image file. The file is read once, and those bytes
 * are both hashed and stored: a picked File is read from disk on every use, so
 * storing the File itself would read it again, and fail or store other bytes
 * under this id once the file on disk changed or went away.
 * @param {Blob} file
 * @returns {Promise<string>} the reference a program names it by, `image:<sha256>`
 */
export async function storeImageFile(file) {
    const bytes = await file.arrayBuffer()
    const id = await digestHex(bytes)
    await storeProgramImages([{ id, blob: new Blob([bytes], { type: file.type }) }])
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
    const generation = storedImageTextGeneration
    const decoded = await decodeText(dsl, images, storedImageText)
    await storeProgramImages(decoded.images)
    if (generation === storedImageTextGeneration) storedImageText = decoded.ids
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
 * Runs once per page load; saves wait for it (see programImagesMigrated),
 * because until it finishes a full localStorage has no room for them.
 *
 * @param {Array<{moveEmbeddedImages: (store: typeof storeImageText) => Promise<number>}>} holders
 * @returns {Promise<void>}
 */
export function migrateProgramImages(holders) {
    if (typeof indexedDB === 'undefined') return Promise.resolve()
    migration = (async () => {
        for (const holder of holders) await holder.moveEmbeddedImages(storeImageText)
    })()
    return migration
}

/**
 * Settles when the startup migration has finished, failed, or run longer than
 * `timeoutMs`. Never rejects.
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function programImagesMigrated(timeoutMs = 15000) {
    if (!migration) return Promise.resolve()
    let timer
    const timeout = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs) })
    return Promise.race([migration.catch(() => {}), timeout]).finally(() => clearTimeout(timer))
}
