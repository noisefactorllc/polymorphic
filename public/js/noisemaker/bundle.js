/**
 * ESM bundle loader for Noisemaker Shaders Core
 *
 * Dynamically imports from the appropriate ESM bundle:
 * - Non-minified for local development (localhost, 127.0.0.1, file://)
 * - Minified for production
 */

const SHADER_CDN = 'https://shaders.noisedeck.app/1'

// Detect if we're in local development
const isLocalDev = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
)

// Choose bundle based on environment
const bundlePath = isLocalDev
    ? `${SHADER_CDN}/noisemaker-shaders-core.esm.js`
    : `${SHADER_CDN}/noisemaker-shaders-core.esm.min.js`

// Dynamic import and re-export
const bundle = await import(bundlePath)

// Re-export everything we need
export const CanvasRenderer = bundle.CanvasRenderer
export const Effect = bundle.Effect
export const registerEffect = bundle.registerEffect
export const getEffect = bundle.getEffect
export const getAllEffects = bundle.getAllEffects
export const registerOp = bundle.registerOp
export const registerStarterOps = bundle.registerStarterOps
export const mergeIntoEnums = bundle.mergeIntoEnums
export const stdEnums = bundle.stdEnums
export const compile = bundle.compile
export const lex = bundle.lex
export const parse = bundle.parse
export const unparse = bundle.unparse
export const extractEffectNamesFromDsl = bundle.extractEffectNamesFromDsl
export const extractEffectsFromDsl = bundle.extractEffectsFromDsl

// Engine subsystems (audio/MIDI/external inputs, UI controller, program state)
export const AudioInputManager = bundle.AudioInputManager
export const MidiInputManager = bundle.MidiInputManager
export const ExternalInputManager = bundle.ExternalInputManager
export const UIController = bundle.UIController
export const ProgramState = bundle.ProgramState
export const setToastProvider = bundle.setToastProvider
export const formatValue = bundle.formatValue
export const formatDslError = bundle.formatDslError
export const isStarterEffect = bundle.isStarterEffect
export const isIOFunction = bundle.isIOFunction
export const VERSION = bundle.VERSION

// Debug: expose bundle for verification
export const _bundle = bundle
