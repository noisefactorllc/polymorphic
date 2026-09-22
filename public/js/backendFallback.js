// SPDX-License-Identifier: MIT

export const WEBGPU_FALLBACK_MESSAGE = 'WebGPU is not supported by this browser; falling back to WebGL2'

/**
 * Determine whether WebGPU is preferred from query parameters and stored preference.
 * The ?backend= URL parameter takes precedence over localStorage.
 *
 * @param {string|URLSearchParams} [searchOrParams] - URL query string or URLSearchParams instance
 * @param {string|null} [storedBackend] - Value from localStorage ('polymorphic-backend')
 * @returns {{ urlBackend: string|null, storedBackend: string|null, preferWebGPU: boolean }}
 */
export function resolveBackendPreference(searchOrParams, storedBackend = null) {
    const params = typeof searchOrParams === 'string'
        ? new URLSearchParams(searchOrParams)
        : (searchOrParams || new URLSearchParams())
    const rawUrlBackend = params.get('backend')
    const urlBackend = rawUrlBackend ? rawUrlBackend.toLowerCase() : null
    const normalizedStored = storedBackend ? storedBackend.toLowerCase() : null
    const preferWebGPU = (urlBackend === 'webgpu') || (!urlBackend && normalizedStored === 'webgpu')
    return { urlBackend, storedBackend, preferWebGPU }
}

/**
 * Check if the active renderer backed out of a requested WebGPU configuration.
 *
 * @param {object} options
 * @param {boolean} options.preferWebGPU - Whether WebGPU was requested
 * @param {string} options.actualBackend - Active backend reported by renderer ('webgpu'|'webgl2')
 * @returns {boolean} True if WebGPU was requested but could not be initialized
 */
export function isWebGPUFallback({ preferWebGPU, actualBackend }) {
    return Boolean(preferWebGPU && actualBackend !== 'webgpu')
}
