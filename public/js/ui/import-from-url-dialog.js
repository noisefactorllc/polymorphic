/**
 * Import from URL Dialog
 *
 * Dialog for importing compositions from sharing.noisedeck.app URLs.
 *
 * @module ui/import-from-url-dialog
 */

import { loadFromCode } from '../sharingLoader.js'
import { registerEscapeable, unregisterEscapeable } from 'handfish'

// Inject styles once
const STYLES_ID = 'import-from-url-dialog-styles'
if (!document.getElementById(STYLES_ID)) {
    const styleEl = document.createElement('style')
    styleEl.id = STYLES_ID
    styleEl.textContent = `
        .import-url-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding-top: 15vh;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.15s ease;
        }
        
        .import-url-overlay.visible {
            opacity: 1;
        }
        
        .import-url-dialog {
            background: color-mix(in srgb, var(--hf-bg-surface, var(--hf-color-2)) var(--hf-surface-opacity, 98%), transparent);
            border: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            border-radius: var(--hf-radius, 8px);
            width: 450px;
            max-width: 90vw;
            box-shadow: var(--hf-shadow-xl, 0 25px 50px -12px rgba(0, 0, 0, 0.5));
            overflow: hidden;
            color: var(--hf-text-normal, var(--hf-color-6));
        }
        
        .import-url-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            background: color-mix(in srgb, var(--hf-accent-bg, var(--hf-accent-1)) 40%, transparent);
        }
        
        .import-url-title {
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--hf-text-bright, var(--hf-color-7));
            text-transform: lowercase;
            letter-spacing: 0.05em;
        }
        
        .import-url-close {
            background: transparent;
            border: none;
            color: var(--hf-text-dim, var(--hf-color-5));
            cursor: pointer;
            font-size: 1rem;
            padding: 0.25em 0.5em;
            line-height: 1;
            opacity: 0.7;
            transition: opacity 0.15s ease, color 0.15s ease;
        }
        
        .import-url-close:hover {
            opacity: 1;
            color: var(--hf-text-bright, var(--hf-color-7));
        }
        
        .import-url-content {
            padding: 1rem;
        }
        
        .import-url-description {
            font-size: 0.75rem;
            color: var(--hf-text-dim, var(--hf-color-5));
            margin-bottom: 1rem;
            line-height: 1.5;
        }
        
        .import-url-input-group {
            margin-bottom: 1rem;
        }
        
        .import-url-label {
            display: block;
            font-size: 0.75rem;
            color: var(--hf-text-normal, var(--hf-color-6));
            margin-bottom: 0.5rem;
            text-transform: lowercase;
        }
        
        .import-url-input {
            width: 100%;
            padding: 0.625rem 0.75rem;
            font-size: 0.8125rem;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block';
            background: var(--hf-bg-elevated, var(--hf-color-3));
            border: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            border-radius: var(--hf-radius-sm, 4px);
            color: var(--hf-text-normal, var(--hf-color-6));
            outline: none;
            transition: border-color 0.15s ease;
            box-sizing: border-box;
        }
        
        .import-url-input:focus {
            border-color: var(--hf-border-focus, var(--hf-accent, var(--accent3)));
        }
        
        .import-url-input::placeholder {
            color: var(--hf-text-muted, var(--hf-color-4));
        }
        
        .import-url-info {
            font-size: 0.75rem;
            color: var(--hf-text-normal, var(--hf-color-6));
            padding: 0.75rem;
            background: color-mix(in srgb, var(--hf-accent, var(--accent3)) 12%, transparent);
            border: 1px solid color-mix(in srgb, var(--hf-accent, var(--accent3)) 25%, transparent);
            border-radius: var(--hf-radius-sm, 4px);
            margin-bottom: 1rem;
            display: none;
        }
        
        .import-url-info.visible {
            display: block;
        }
        
        .import-url-error {
            font-size: 0.75rem;
            color: var(--hf-red);
            padding: 0.75rem;
            background: color-mix(in srgb, var(--hf-red) 12%, transparent);
            border: 1px solid color-mix(in srgb, var(--hf-red) 30%, transparent);
            border-radius: var(--hf-radius-sm, 4px);
            margin-bottom: 1rem;
            display: none;
        }
        
        .import-url-error.visible {
            display: block;
        }
        
        .import-url-actions {
            display: flex;
            gap: 0.5rem;
            justify-content: flex-end;
        }
        
        .import-url-btn {
            padding: 0.5rem 1rem;
            font-size: 0.8125rem;
            font-weight: 500;
            border: none;
            border-radius: var(--hf-radius-sm, 4px);
            cursor: pointer;
            transition: all 0.15s ease;
        }
        
        .import-url-btn-primary {
            background: var(--hf-accent, var(--accent3));
            color: var(--hf-bg-base, var(--hf-color-1));
        }
        
        .import-url-btn-primary:hover:not(:disabled) {
            background: var(--hf-accent-hover, var(--accent4));
        }
        
        .import-url-btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .import-url-btn-secondary {
            background: transparent;
            border: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            color: var(--hf-text-dim, var(--hf-color-5));
        }
        
        .import-url-btn-secondary:hover {
            border-color: var(--hf-accent, var(--accent3));
            color: var(--hf-text-bright, var(--hf-color-7));
        }
    `
    document.head.appendChild(styleEl)
}

/**
 * Extract the short code from a sharing URL
 * @param {string} url - The sharing URL
 * @returns {string|null} The short code or null if invalid
 */
function extractShortCode(url) {
    if (!url) return null
    
    // Direct code (just alphanumeric)
    if (/^[a-zA-Z0-9_-]{4,10}$/.test(url.trim())) {
        return url.trim()
    }
    
    try {
        const parsed = new URL(url)
        if (!parsed.hostname.includes('sharing.noisedeck.app')) {
            return null
        }
        const match = parsed.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)$/)
        return match ? match[1] : null
    } catch {
        return null
    }
}

/**
 * Import from URL Dialog Class
 */
export class ImportFromUrlDialog {
    constructor() {
        this._overlay = null
        this._input = null
        this._info = null
        this._error = null
        this._loadBtn = null
        this._onLoad = null
    }

    /**
     * Open the dialog
     * @param {object} options
     * @param {function} options.onLoad - Callback with { dsl, title, effects, rawEffects }
     */
    open(options = {}) {
        this._onLoad = options.onLoad || null
        
        if (this._overlay) {
            this._overlay.remove()
        }
        
        this._overlay = document.createElement('div')
        this._overlay.className = 'import-url-overlay'
        this._overlay.innerHTML = `
            <div class="import-url-dialog">
                <div class="import-url-header">
                    <span class="import-url-title">import from url</span>
                    <button class="import-url-close" aria-label="Close">×</button>
                </div>
                <div class="import-url-content">
                    <p class="import-url-description">
                        Load a composition from a sharing.noisedeck.app URL.
                        You can paste the full URL or just the short code.
                    </p>
                    <div class="import-url-input-group">
                        <label class="import-url-label">sharing url or code</label>
                        <input type="text" class="import-url-input" placeholder="https://sharing.noisedeck.app/s/..." autocomplete="off">
                    </div>
                    <div class="import-url-info"></div>
                    <div class="import-url-error"></div>
                    <div class="import-url-actions">
                        <button class="import-url-btn import-url-btn-secondary">cancel</button>
                        <button class="import-url-btn import-url-btn-primary" disabled>load</button>
                    </div>
                </div>
            </div>
        `
        
        document.body.appendChild(this._overlay)
        
        this._input = this._overlay.querySelector('.import-url-input')
        this._info = this._overlay.querySelector('.import-url-info')
        this._error = this._overlay.querySelector('.import-url-error')
        this._loadBtn = this._overlay.querySelector('.import-url-btn-primary')
        const cancelBtn = this._overlay.querySelector('.import-url-btn-secondary')
        const closeBtn = this._overlay.querySelector('.import-url-close')
        
        // Event handlers
        this._input.addEventListener('input', () => this._validateInput())
        this._loadBtn.addEventListener('click', () => this._handleLoad())
        cancelBtn.addEventListener('click', () => this.close())
        closeBtn.addEventListener('click', () => this.close())
        
        // Close on overlay click
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close()
        })
        
        // Close on escape
        registerEscapeable(this._overlay, () => this.close())
        
        // Animate in
        requestAnimationFrame(() => {
            this._overlay.classList.add('visible')
            this._input.focus()
        })
    }

    /**
     * Validate input and enable/disable load button
     */
    _validateInput() {
        const value = this._input.value.trim()
        this._error.classList.remove('visible')
        this._info.classList.remove('visible')
        
        if (!value) {
            this._loadBtn.disabled = true
            return
        }
        
        const code = extractShortCode(value)
        if (code) {
            this._loadBtn.disabled = false
        } else {
            this._loadBtn.disabled = true
            this._error.textContent = 'Invalid URL. Expected format: https://sharing.noisedeck.app/s/CODE'
            this._error.classList.add('visible')
        }
    }

    /**
     * Handle load button click
     */
    async _handleLoad() {
        const value = this._input.value.trim()
        const code = extractShortCode(value)
        
        if (!code) return
        
        this._loadBtn.disabled = true
        this._loadBtn.textContent = 'loading...'
        this._error.classList.remove('visible')
        
        try {
            const result = await loadFromCode(code)
            
            // Show info
            let info = `<b>${result.title || 'Untitled'}</b>`
            if (result.effects.length > 0) {
                info += `<br>${result.effects.length} custom effect${result.effects.length > 1 ? 's' : ''} loaded`
            }
            this._info.innerHTML = info
            this._info.classList.add('visible')
            
            // Call callback
            if (this._onLoad) {
                this._onLoad(result)
            }
            
            // Close dialog after short delay
            setTimeout(() => this.close(), 500)
            
        } catch (err) {
            console.error('Failed to load from URL:', err)
            this._error.textContent = err.message || 'Failed to load composition'
            this._error.classList.add('visible')
            this._loadBtn.disabled = false
            this._loadBtn.textContent = 'load'
        }
    }

    /**
     * Close the dialog
     */
    close() {
        if (this._overlay) {
            unregisterEscapeable(this._overlay)
            this._overlay.classList.remove('visible')
            const ov = this._overlay
            setTimeout(() => {
                ov?.remove()
            }, 150)
            this._overlay = null
        }
    }
}

// Singleton instance
export const importFromUrlDialog = new ImportFromUrlDialog()
