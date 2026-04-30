/**
 * Keyboard Shortcuts Dialog
 *
 * Modal that lists every Polymorphic shortcut. Triggered by `?` key
 * (when no input is focused) or via the command palette.
 *
 * The shortcuts list is the source of truth — actually-bound handlers
 * elsewhere should match. If a binding changes there, change it here too.
 */

const STYLES_ID = 'shortcuts-dialog-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .shortcuts-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.55);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            z-index: 5200;
            display: none;
            opacity: 0;
            transition: opacity 0.12s;
        }
        .shortcuts-overlay.visible {
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding-top: 8vh;
            opacity: 1;
        }
        .shortcuts-modal {
            background: rgba(10, 12, 17, 0.96);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            box-shadow: 0 18px 48px -10px rgba(0,0,0,0.6);
            width: min(640px, calc(100vw - 2rem));
            max-height: calc(100vh - 12vh);
            color: #e3e3e3;
            font-family: 'Nunito', 'Nunito Block', sans-serif;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .shortcuts-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.7rem 1rem;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .shortcuts-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: #fff;
            font-family: 'Comfortaa', 'Comfortaa Block', sans-serif;
        }
        .shortcuts-close {
            background: transparent; border: none; color: #888; cursor: pointer;
            padding: 0.2em 0.5em; font-size: 1.1rem;
        }
        .shortcuts-close:hover { color: #fff; }
        .shortcuts-body {
            padding: 1rem 1.1rem 1.1rem;
            overflow-y: auto;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.1rem 1.4rem;
        }
        @media (max-width: 540px) {
            .shortcuts-body { grid-template-columns: 1fr; }
        }
        .shortcuts-section {
            display: flex;
            flex-direction: column;
            gap: 0.3rem;
        }
        .shortcuts-section-title {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #aaa;
            font-weight: 700;
        }
        .shortcut-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.7rem;
            font-size: 0.8125rem;
        }
        .shortcut-desc { color: #d9deeb; }
        .shortcut-keys {
            display: inline-flex;
            gap: 0.2rem;
        }
        .shortcut-keys kbd {
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.1);
            color: #fff;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.6875rem;
            padding: 0.12rem 0.45rem;
            border-radius: 4px;
            white-space: nowrap;
        }
    `
    document.head.appendChild(style)
}

const SECTIONS = [
    {
        title: 'Live coding',
        rows: [
            ['Recompile whole program',     ['⌘/Ctrl', '↵']],
            ['Evaluate current block',      ['⌘/Ctrl', '⇧', '↵']],
            ['Evaluate current block (alt)',['Alt', '↵']],
            ['Step back through history',   ['⌘/Ctrl', 'Alt', '←']],
            ['Step forward through history',['⌘/Ctrl', 'Alt', '→']],
        ]
    },
    {
        title: 'Editor',
        rows: [
            ['Scrub a number live',         ['Alt', 'drag']],
            ['Fine scrub (×0.1)',           ['Alt', '⇧', 'drag']],
            ['Coarse scrub (×10)',          ['Alt', '⌘/Ctrl', 'drag']],
            ['Reset scrub',                 ['Esc']]
        ]
    },
    {
        title: 'Panels & dialogs',
        rows: [
            ['Command palette',             ['⌘/Ctrl', 'K']],
            ['Live inputs panel',           ['click ⚙ button']],
            ['Performance overlay',         ['click ⚡ button']],
            ['Inspiration gallery',         ['click ◫ button']],
            ['Toggle status row',           ['⌘/Ctrl', ';']],
            ['Show this dialog',            ['?']],
            ['Close any dialog',            ['Esc']]
        ]
    },
    {
        title: 'Performance',
        rows: [
            ['Tap tempo',                   ['T']],
            ['BPM ± 1',                     ['scroll on bpm']],
            ['BPM ± 5',                     ['⇧', 'scroll']],
            ['Drag bpm value',              ['drag']],
            ['Toggle fullscreen',           ['click ⛶']],
            ['Toggle performance mode',     ['⌘/Ctrl', '⇧', 'H']],
            ['Exit performance mode',       ['Esc']]
        ]
    },
    {
        title: 'Capture',
        rows: [
            ['Record video (toggle)',       ['click ◉']],
            ['Save canvas as PNG',          ['file menu']],
            ['Save canvas as JPG',          ['file menu']],
            ['Share publicly',              ['program menu']]
        ]
    },
    {
        title: 'Live inputs',
        rows: [
            ['Enable microphone',           ['palette → mic']],
            ['Connect MIDI device',         ['palette → midi']],
            ['Use webcam as source',        ['inputs panel']],
            ['Capture screen as source',    ['inputs panel']]
        ]
    }
]

class ShortcutsDialog {
    constructor() {
        this._overlay = null
        this._open = false
        this._escHandler = null
    }

    init() {
        // Bind global ? key handler
        document.addEventListener('keydown', (e) => {
            if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const tag = (e.target?.tagName || '').toUpperCase()
                if (tag === 'TEXTAREA' || tag === 'INPUT') return
                e.preventDefault()
                this.toggle()
            }
        })
    }

    open() {
        if (this._open) return
        this._open = true
        this._build()
        this._overlay.classList.add('visible')
    }

    close() {
        if (!this._open) return
        this._open = false
        this._overlay?.classList.remove('visible')
        const ov = this._overlay
        setTimeout(() => ov?.remove(), 200)
        this._overlay = null
        // Drop the global Esc listener regardless of how the dialog was closed
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler)
            this._escHandler = null
        }
    }

    toggle() { this._open ? this.close() : this.open() }

    _build() {
        if (this._overlay) this._overlay.remove()
        this._overlay = document.createElement('div')
        this._overlay.className = 'shortcuts-overlay'
        const sectionsHtml = SECTIONS.map(sec => `
            <div class="shortcuts-section">
                <span class="shortcuts-section-title">${sec.title}</span>
                ${sec.rows.map(([desc, keys]) => `
                    <div class="shortcut-row">
                        <span class="shortcut-desc">${desc}</span>
                        <span class="shortcut-keys">${keys.map(k => `<kbd>${k}</kbd>`).join('')}</span>
                    </div>
                `).join('')}
            </div>
        `).join('')
        this._overlay.innerHTML = `
            <div class="shortcuts-modal" role="dialog" aria-label="Keyboard shortcuts">
                <div class="shortcuts-header">
                    <span class="shortcuts-title">Keyboard shortcuts</span>
                    <button class="shortcuts-close" aria-label="Close">×</button>
                </div>
                <div class="shortcuts-body">${sectionsHtml}</div>
            </div>
        `
        document.body.appendChild(this._overlay)
        this._overlay.querySelector('.shortcuts-close').addEventListener('click', () => this.close())
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close()
        })
        this._escHandler = (e) => {
            if (e.key === 'Escape') this.close()
        }
        document.addEventListener('keydown', this._escHandler)
    }
}

export const shortcutsDialog = new ShortcutsDialog()
