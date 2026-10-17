const MAX_UINT32 = 0xffffffff

function validFrame(frame, descriptor) {
    if (!descriptor || !frame || frame.width !== descriptor.width || frame.height !== descriptor.height ||
        !Number.isSafeInteger(frame.rowStride) || frame.rowStride < frame.width * 4 || frame.rowStride > MAX_UINT32 ||
        !(frame.data instanceof Uint8Array)) return false
    const bytes = frame.rowStride * frame.height
    return Number.isSafeInteger(bytes) && bytes <= MAX_UINT32 && frame.data.byteLength === bytes
}

// GPU slots can finish out of submission order. Only a valid first completion
// from an admitted current-generation readback may be discarded as stale.
export class SyncExportQueue {
    constructor(queue) {
        this.queue = queue
        this.staleCompletionsDropped = 0
        this._generation = 0
        this._lastCompleted = 0
        this._descriptor = null
        this._closed = false
    }
    get available() { return this.queue.available }
    get stats() { return this.queue.stats }
    configure(descriptor) {
        this._generation++
        this._lastCompleted = 0
        this._descriptor = null
        const result = this.queue.configure(descriptor)
        if (!this._closed) this._descriptor = { ...descriptor }
        return result
    }
    enqueue(texture, timestamp, callback, context) {
        const generation = this._generation
        let admitted = false, returned = false, consumed = false
        const completed = (frame, completedAt, sequence) => {
            const first = !consumed
            consumed = true
            const current = !this._closed && generation === this._generation
            const owned = first && current && returned && admitted && sequence === context &&
                Number.isSafeInteger(sequence) && sequence > 0
            if (owned && sequence <= this._lastCompleted && completedAt === timestamp &&
                Number.isFinite(completedAt) && completedAt >= 0 && validFrame(frame, this._descriptor)) {
                this.staleCompletionsDropped++
                return
            }
            if (first && current && sequence === context && Number.isSafeInteger(sequence) && sequence > 0) {
                this._lastCompleted = Math.max(this._lastCompleted, sequence)
            }
            callback(frame, completedAt, sequence)
        }
        const result = this.queue.enqueue(texture, timestamp, completed, context)
        admitted = result === true
        returned = true
        return result
    }
    poll() { return this.queue.poll() }
    close(options) {
        this._closed = true
        this._generation++
        this._descriptor = null
        return this.queue.close(options)
    }
}
