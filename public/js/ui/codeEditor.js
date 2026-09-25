/**
 * Code Editor Styling
 *
 * The <code-editor> custom element itself is registered by the handfish bundle
 * (imported in embed.js). This module only injects Polymorphic-specific CSS;
 * editor behavior such as line flashing and keyboard-triggered compile events
 * belongs to Handfish's public editor API.
 */

const CODE_EDITOR_STYLES_ID = 'code-editor-styles'
if (!document.getElementById(CODE_EDITOR_STYLES_ID)) {
    const styleEl = document.createElement('style')
    styleEl.id = CODE_EDITOR_STYLES_ID
    styleEl.textContent = `
        code-editor {
            display: block;
            position: relative;
            font-family: var(--code-editor-font, var(--hf-font-family-mono, 'Noto Sans Mono', 'Noto Sans Mono Block'));
            font-size: var(--code-editor-font-size, var(--hf-size-base, 0.875rem));
            line-height: var(--code-editor-line-height, var(--hf-leading-normal, 1.6));
            overflow: hidden;
        }

        /* Line numbers gutter */
        code-editor .code-editor-gutter {
            position: absolute;
            top: 0;
            left: 0;
            width: var(--code-editor-gutter-width, 3em);
            pointer-events: none;
            user-select: none;
            text-align: right;
            padding-right: var(--hf-space-2, 0.5em);
            box-sizing: border-box;
            color: var(--code-editor-line-number-color, var(--hf-text-dim));
            background: var(--code-editor-gutter-bg, color-mix(in srgb, var(--hf-bg-base) 50%, transparent));
            font: inherit;
            line-height: inherit;
            font-variant-numeric: tabular-nums;
            font-feature-settings: 'tnum' 1;
            white-space: nowrap;
            will-change: transform;
            z-index: 1;
            opacity: 0.5;
        }

        code-editor .code-editor-gutter .line-number {
            display: block;
            box-sizing: border-box;
            white-space: nowrap;
            overflow: hidden;
            font-variant-numeric: tabular-nums;
            font-feature-settings: 'tnum' 1;
            transition: color var(--hf-transition-fast, 120ms ease), opacity var(--hf-transition-fast, 120ms ease);
        }

        code-editor .code-editor-gutter .line-number.error-line {
            color: var(--hf-red);
            font-weight: var(--hf-weight-bold, 700);
            opacity: 1;
            font-variant-numeric: tabular-nums;
        }

        code-editor .code-editor-textarea {
            position: absolute;
            top: 0;
            bottom: 0;
            left: var(--code-editor-gutter-width, 3em);
            right: 0;
            margin: 0;
            padding: 0;
            background: transparent;
            border: none;
            outline: none;
            box-shadow: none;
            resize: none;
            font: inherit;
            line-height: inherit;
            letter-spacing: inherit;
            word-spacing: inherit;
            color: transparent;
            caret-color: var(--code-editor-caret-color, var(--hf-text-bright));
            white-space: pre-wrap;
            overflow-wrap: break-word;
            word-break: break-word;
            box-sizing: border-box;
            -webkit-appearance: none;
            appearance: none;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: none;
            -ms-overflow-style: none;
            z-index: 3;
        }

        code-editor .code-editor-textarea::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
        }

        /* Selection styling - more visible with contrasting colors */
        code-editor .code-editor-textarea::selection {
            background: var(--code-editor-selection-bg, var(--hf-accent));
            color: var(--code-editor-selection-fg, var(--hf-text-bright));
        }

        code-editor .code-editor-textarea::-moz-selection {
            background: var(--code-editor-selection-bg, var(--hf-accent));
            color: var(--code-editor-selection-fg, var(--hf-text-bright));
        }

        /* Display layer - positioned behind textarea for syntax highlighting */
        code-editor .code-editor-display {
            position: absolute;
            top: 0;
            left: var(--code-editor-gutter-width, 3em);
            right: 0;
            pointer-events: none;
            white-space: pre-wrap;
            overflow-wrap: break-word;
            word-break: break-word;
            font: inherit;
            line-height: inherit;
            letter-spacing: inherit;
            word-spacing: inherit;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            will-change: transform;
            z-index: 2;
        }

        code-editor .code-editor-display .code-line {
            display: block;
            box-sizing: border-box;
            background: var(--code-editor-bg, transparent);
            -webkit-box-decoration-break: clone;
            box-decoration-break: clone;
        }

        code-editor .code-editor-display .code-line.error-line {
            background: linear-gradient(
                90deg,
                color-mix(in srgb, var(--hf-red) 22%, transparent) 0%,
                transparent 100%
            );
            box-shadow: inset 3px 0 0 var(--hf-red);
            box-sizing: border-box;
        }

        code-editor .code-editor-display .code-segment {
            background: var(--text-bg-color, color-mix(in srgb, var(--hf-bg-base) 75%, transparent));
            color: var(--hf-text-normal);
            padding: 0.1em 0;
            border-radius: var(--hf-radius-sm, 2px);
        }

        /* Focus state - subtle outline for accessibility */
        code-editor:focus-within {
            outline: 1px solid var(--code-editor-focus-outline, transparent);
        }

        /* Syntax highlighting colors */
        code-editor .hl-comment {
            color: var(--hl-comment, var(--hf-text-muted));
            font-style: italic;
        }

        code-editor .hl-string {
            color: var(--hl-string, var(--hf-accent-hover));
        }

        code-editor .hl-number {
            color: var(--hl-number, var(--hf-accent));
        }

        code-editor .hl-color {
            color: var(--hl-color, var(--hf-yellow));
        }

        code-editor .hl-boolean {
            color: var(--hl-boolean, var(--hf-red));
        }

        code-editor .hl-null {
            color: var(--hl-null, var(--hf-red));
        }

        code-editor .hl-function {
            color: var(--hl-function, var(--hf-accent-4));
        }

        code-editor .hl-parameter {
            color: var(--hl-parameter, var(--hf-accent-hover));
        }

        code-editor .hl-output {
            color: var(--hl-output, var(--hf-green));
            font-weight: var(--hf-weight-semibold, 600);
        }

        code-editor .hl-punctuation {
            color: var(--hl-punctuation, var(--hf-text-dim));
        }

        code-editor .hl-operator {
            color: var(--hl-operator, var(--hf-red));
        }

        code-editor .hl-identifier {
            color: var(--hl-identifier, var(--hf-text-normal));
        }

        /* Selection highlight overlay */
        code-editor .code-editor-selection-highlight {
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 0;
            overflow: hidden;
        }

    `
    document.head.appendChild(styleEl)
}
