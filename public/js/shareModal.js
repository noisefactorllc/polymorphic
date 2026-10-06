// Share modal for Polymorphic
// Posts to sharing.noisedeck.app API

import { getLoadedPortableEffects, portableDefinition, uploadProgramImages, uploadScreenshot } from './sharingLoader.js'
let registerEscapeable = (el, cb) => {}, unregisterEscapeable = (el) => {}
try {
    const hf = await import('handfish')
    registerEscapeable = hf.registerEscapeable
    unregisterEscapeable = hf.unregisterEscapeable
} catch {
    // In Node test runners without import maps, fall back cleanly
}

/**
 * Build a portable effect ZIP as base64 from effect data
 * @param {object} effectData - Effect data with shaders
 * @returns {Promise<string>} Base64-encoded ZIP
 */
async function buildEffectZip(effectData) {
    // Load JSZip if needed
    if (!window.JSZip) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script')
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
            script.onload = resolve
            script.onerror = () => reject(new Error('Failed to load JSZip'))
            document.head.appendChild(script)
        })
    }

    const zip = new window.JSZip()

    // Create definition.json
    const definition = portableDefinition(effectData)
    zip.file('definition.json', JSON.stringify(definition, null, 2))

    // Add shaders
    const shaders = effectData.shaders || {}
    for (const [programName, shader] of Object.entries(shaders)) {
        if (shader.glsl) {
            zip.file(`glsl/${programName}.glsl`, shader.glsl)
        }
        if (shader.wgsl) {
            zip.file(`wgsl/${programName}.wgsl`, shader.wgsl)
        }
        // Handle vertex/fragment separately if present
        if (shader.vertex) {
            zip.file(`glsl/${programName}.vert`, shader.vertex)
        }
        if (shader.fragment) {
            zip.file(`glsl/${programName}.frag`, shader.fragment)
        }
    }

    // Generate as base64
    const blob = await zip.generateAsync({ type: 'blob' })
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

/**
 * Get portable effects that are used in the DSL
 * @param {string} dsl - DSL code
 * @returns {object[]} Array of effect data objects
 */
function getUsedPortableEffects(dsl) {
    const loadedEffects = getLoadedPortableEffects()
    if (loadedEffects.size === 0) return []

    const usedEffects = []
    for (const [effectId, effectData] of loadedEffects) {
        const effectFunc = effectData.func || effectData.name
        // Check if effect is referenced in DSL
        if (dsl.includes(effectFunc)) {
            usedEffects.push(effectData)
        }
    }
    return usedEffects
}

class ShareModal {
    constructor() {
        this.overlay = null;
        this.isOpen = false;
        this.isSharing = false;
    }

    open(options = {}) {
        if (this.isOpen) return;

        const { dsl = '', canvas = null } = options;

        this.isOpen = true;
        this.dsl = dsl;
        this.images = options.images || [];
        this.hasLiveMedia = options.hasLiveMedia;
        this.canvas = canvas;

        this.overlay = document.getElementById('share-modal');
        if (!this.overlay) return;

        // Capture screenshot
        if (canvas) {
            this._captureScreenshot(canvas);
        }

        // Set up event handlers
        this._setupEventHandlers();

        // Register with Handfish escape stack
        registerEscapeable(this.overlay, () => this.close());

        // Show modal
        this.overlay.style.display = 'flex';
    }

    close() {
        if (!this.isOpen) return;

        this.isOpen = false;
        this.isSharing = false;

        if (this.overlay) {
            unregisterEscapeable(this.overlay);
            this.overlay.style.display = 'none';
        }

        // Clean up
        this._cleanupEventHandlers();
    }

    _setupEventHandlers() {
        this.closeBtn = document.getElementById('share-close-btn');
        this.shareBtn = document.getElementById('share-submit-btn');
        this.copyBtn = document.getElementById('share-copy-btn');
        this.doneBtn = document.getElementById('share-done-btn');

        this.closeHandler = () => this.close();
        this.shareHandler = () => this._handleShare();
        this.copyHandler = () => this._copyUrl();

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', this.closeHandler);
        }

        if (this.shareBtn) {
            this.shareBtn.addEventListener('click', this.shareHandler);
        }

        if (this.copyBtn) {
            this.copyBtn.addEventListener('click', this.copyHandler);
        }

        if (this.doneBtn) {
            this.doneBtn.addEventListener('click', this.closeHandler);
        }

        // NoiseBLASTER! publish button
        this.blasterBtn = document.getElementById('share-blaster-btn');
        this.blasterHandler = () => this._publishToBlaster();
        if (this.blasterBtn) {
            this.blasterBtn.addEventListener('click', this.blasterHandler);
        }

        // Close on overlay click
        this.overlayClickHandler = (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        };
        this.overlay.addEventListener('click', this.overlayClickHandler);
    }

    _cleanupEventHandlers() {
        if (this.closeBtn && this.closeHandler) {
            this.closeBtn.removeEventListener('click', this.closeHandler);
        }

        if (this.shareBtn && this.shareHandler) {
            this.shareBtn.removeEventListener('click', this.shareHandler);
        }

        if (this.copyBtn && this.copyHandler) {
            this.copyBtn.removeEventListener('click', this.copyHandler);
        }

        if (this.doneBtn && this.closeHandler) {
            this.doneBtn.removeEventListener('click', this.closeHandler);
        }

        if (this.overlay && this.overlayClickHandler) {
            this.overlay.removeEventListener('click', this.overlayClickHandler);
        }

        if (this.blasterBtn && this.blasterHandler) {
            this.blasterBtn.removeEventListener('click', this.blasterHandler);
        }
    }

    _captureScreenshot(canvas) {
        const previewCanvas = document.getElementById('share-preview-canvas');
        if (!previewCanvas) return;

        // Calculate 16:9 crop from center
        const targetAspect = 16 / 9;
        const sourceAspect = canvas.width / canvas.height;

        let sx, sy, sw, sh;

        if (sourceAspect > targetAspect) {
            // Source is wider, crop width
            sh = canvas.height;
            sw = sh * targetAspect;
            sx = (canvas.width - sw) / 2;
            sy = 0;
        } else {
            // Source is taller, crop height
            sw = canvas.width;
            sh = sw / targetAspect;
            sx = 0;
            sy = (canvas.height - sh) / 2;
        }

        // Set preview canvas to 16:9 with max width of 468px (to fit in modal)
        const previewWidth = 468;
        const previewHeight = Math.round(previewWidth / targetAspect);

        previewCanvas.width = previewWidth;
        previewCanvas.height = previewHeight;

        const ctx = previewCanvas.getContext('2d');
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, previewWidth, previewHeight);

        // Sharing uploads the screenshot as a JPEG file
        this.screenshotCanvas = previewCanvas;
    }

    async _handleShare() {
        if (this.isSharing) return;

        const titleInput = document.getElementById('share-title');
        const descriptionInput = document.getElementById('share-description');

        const title = titleInput?.value.trim() || '';
        const description = descriptionInput?.value.trim() || '';

        // Validate
        if (!this.dsl) {
            alert('No program to share');
            return;
        }

        this.isSharing = true;

        if (this.shareBtn) {
            this.shareBtn.disabled = true;
            this.shareBtn.textContent = 'Sharing...';
        }

        try {
            // Build effect ZIPs for any portable effects used in the DSL
            const usedEffects = getUsedPortableEffects(this.dsl)
            const effectZips = []
            for (const effectData of usedEffects) {
                try {
                    const zip = await buildEffectZip(effectData)
                    effectZips.push(zip)
                    console.log(`[ShareModal] Packaged effect: ${effectData.func || effectData.name}`)
                } catch (err) {
                    console.error(`[ShareModal] Failed to package effect ${effectData.name}:`, err)
                }
            }

            const payload = {
                dsl: this.dsl,
                title: title || 'Untitled',
                description: description || '',
                screenshot: '',
                effects: effectZips
            };

            if (this.hasLiveMedia) throw new Error('Only image sources can be shared; stop the camera or video first');
            if (/\burl\b/.test(payload.dsl)) {
                const tools = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929');
                const prepared = await tools.prepareImagesForShare(payload.dsl, tools.getReferencedImages(payload.dsl, this.images));
                // Images go to the sharing service as files, named by the ids it returns.
                payload.dsl = await uploadProgramImages(prepared.dsl, prepared.images, { tools });
            }
            payload.screenshot = await uploadScreenshot(this.screenshotCanvas) || '';

            const response = await fetch('https://sharing.noisedeck.app/api/embed/shorten', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Share failed: ${response.status}`);
            }

            const result = await response.json();

            if (!result.shortUrl) {
                throw new Error('No URL returned from share API');
            }

            // Show result
            this._showResult(result.shortUrl, result.expiresAt);

        } catch (error) {
            console.error('Share error:', error);
            alert('Failed to share program. Please try again.');

            if (this.shareBtn) {
                this.shareBtn.disabled = false;
                this.shareBtn.textContent = 'Share';
            }

            this.isSharing = false;
        }
    }

    _showResult(url, expiresAt) {
        const formSection = document.getElementById('share-form');
        const resultSection = document.getElementById('share-result');
        const urlInput = document.getElementById('share-url');
        const expiresSpan = document.getElementById('share-expires');

        if (formSection) formSection.style.display = 'none';
        if (resultSection) resultSection.style.display = 'block';

        if (urlInput) {
            urlInput.value = url;
        }

        if (expiresAt && expiresSpan) {
            const date = new Date(expiresAt);
            const dateStr = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            expiresSpan.textContent = `Expires: ${dateStr}`;
        }

        this.sharedUrl = url;
        this.isSharing = false;
    }

    _publishToBlaster() {
        if (!this.sharedUrl) return;

        // Extract code from URL (e.g., https://sharing.noisedeck.app/s/ABC123)
        const match = this.sharedUrl.match(/\/s\/([a-zA-Z0-9_-]+)$/);
        if (!match) {
            console.error('Could not extract share code from URL:', this.sharedUrl);
            return;
        }

        const code = match[1];
        const intakeUrl = `https://blaster.noisedeck.app/intake?code=${encodeURIComponent(code)}&app=polymorphic`;
        window.open(intakeUrl, '_blank');
    }

    _copyUrl() {
        if (!this.sharedUrl) return;

        navigator.clipboard.writeText(this.sharedUrl).then(() => {
            // Visual feedback
            if (this.copyBtn) {
                const originalHTML = this.copyBtn.innerHTML;
                this.copyBtn.innerHTML = `
                    <svg class="share-copy-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                `;

                setTimeout(() => {
                    this.copyBtn.innerHTML = originalHTML;
                }, 2000);
            }
        }).catch((err) => {
            console.error('Copy failed:', err);
            alert('Failed to copy URL to clipboard');
        });
    }
}

export const shareModal = new ShareModal();
