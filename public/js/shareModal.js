// Share modal for Polymorphic
// Posts to sharing.noisedeck.app API

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
        this.canvas = canvas;

        this.overlay = document.getElementById('share-modal');
        if (!this.overlay) return;

        // Capture screenshot
        if (canvas) {
            this._captureScreenshot(canvas);
        }

        // Set up event handlers
        this._setupEventHandlers();

        // Show modal
        this.overlay.style.display = 'flex';
    }

    close() {
        if (!this.isOpen) return;

        this.isOpen = false;
        this.isSharing = false;

        if (this.overlay) {
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

        // Close on overlay click
        this.overlayClickHandler = (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        };
        this.overlay.addEventListener('click', this.overlayClickHandler);

        // Close on Escape key
        this.escapeHandler = (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        };
        document.addEventListener('keydown', this.escapeHandler);
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

        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
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

        // Store screenshot as base64 JPEG at 85% quality
        this.screenshot = previewCanvas.toDataURL('image/jpeg', 0.85);
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
            const payload = {
                dsl: this.dsl,
                title: title || 'Untitled',
                description: description || '',
                screenshot: this.screenshot || '',
                effects: [] // No workspace files in Polymorphic
            };

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

    _copyUrl() {
        if (!this.sharedUrl) return;

        navigator.clipboard.writeText(this.sharedUrl).then(() => {
            // Visual feedback
            if (this.copyBtn) {
                const originalHTML = this.copyBtn.innerHTML;
                this.copyBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
