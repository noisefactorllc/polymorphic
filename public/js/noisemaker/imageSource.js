import { lex, parse } from './bundle.js'
import { findCalls } from './dslQuery.js'
import { replaceRange } from '../ui/editorActions.js'

/** Update the image source, or insert its chain before the final render. */
export function insertImageSource(editor, dataUrl, mediaGlobals) {
    let source = editor?.value ?? ''
    const originalLength = source.length
    const empty = !source.trim()
    let tokens = lex(empty ? 'search synth' : source)
    // Parse before modifying the editor. Comments and strings containing
    // render() must not be mistaken for the final render directive.
    const program = parse(tokens)
    const tokenOffset = (token) => source.split('\n').slice(0, token.line - 1)
        .reduce((sum, line) => sum + line.length + 1, 0) + token.col - 1
    if (!empty && !program.namespace.searchOrder.includes('synth')) {
        let i = tokens.findIndex(t => t.type === 'SEARCH') + 1
        while (tokens[i + 1]?.type === 'COMMA') i += 2
        const end = tokenOffset(tokens[i]) + tokens[i].lexeme.length
        source = source.slice(0, end) + ', synth' + source.slice(end)
        tokens = lex(source)
    }
    // Polymorphic owns one image texture. Reuse its first media call instead
    // of adding another call that would have no texture bound to it.
    const mediaIndex = tokens.findIndex((t, i) => t.type === 'IDENT' && t.lexeme === 'media' && tokens[i + 1]?.type === 'LPAREN')
    if (mediaIndex !== -1) {
        const positional = findCalls(program, 'media')[0]?.args?.length > 0
        const parameterNames = Object.keys(mediaGlobals ?? {})
        const positionalArgs = []
        const argsStart = tokenOffset(tokens[mediaIndex + 1]) + 1
        let argStart = argsStart
        let depth = 1
        let urlStart = null
        for (let i = mediaIndex + 2; i < tokens.length; i++) {
            const token = tokens[i]
            if (positional && depth === 1 && ['COMMA', 'RPAREN'].includes(token.type)) {
                const end = tokenOffset(token)
                const value = source.slice(argStart, end).trim()
                if (value) {
                    const name = parameterNames[positionalArgs.length]
                    if (!name) throw new Error('Unknown media parameter')
                    positionalArgs.push(`${name}: ${value}`)
                }
                argStart = end + 1
                if (token.type === 'RPAREN') {
                    source = source.slice(0, argsStart) + `url: ${JSON.stringify(dataUrl)}, ` + positionalArgs.join(', ') + source.slice(end)
                    break
                }
                continue
            }
            if (depth === 1 && urlStart === null && token.lexeme === 'url' && tokens[i + 1]?.type === 'COLON') {
                urlStart = tokenOffset(token)
            }
            if (depth === 1 && (token.type === 'RPAREN' || token.type === 'COMMA' && urlStart !== null)) {
                const end = tokenOffset(token)
                if (urlStart !== null) {
                    source = source.slice(0, urlStart) + `url: ${JSON.stringify(dataUrl)}` + source.slice(end)
                    break
                }
                const start = tokenOffset(tokens[mediaIndex + 1]) + 1
                const separator = i > mediaIndex + 2 ? ', ' : ''
                source = source.slice(0, start) + `url: ${JSON.stringify(dataUrl)}${separator}` + source.slice(start)
                break
            }
            if (['LPAREN', 'LBRACE', 'LBRACKET'].includes(token.type)) depth++
            if (['RPAREN', 'RBRACE', 'RBRACKET'].includes(token.type)) depth--
        }
        if (!program.render) {
            const target = program.plans.find(plan => findCalls(plan, 'media').length)?.write?.name
            const output = /^o[0-7]$/.test(target) ? target : 'o0'
            source += `\n\nrender(${output})\n`
        }
        replaceRange(editor, 0, originalLength, source)
        return
    }
    const output = program.render?.name ?? 'o0'
    let offset = source.length
    if (program.render) {
        const token = tokens.findLast((t, i) => t.type === 'RENDER' && tokens[i + 1]?.type === 'LPAREN')
        offset = tokenOffset(token)
    }
    const prefix = empty ? 'search synth\n\n' : '\n\n'
    const chain = `media(url: ${JSON.stringify(dataUrl)}).write(${output})`
    const suffix = program.render ? '\n\n' : `\n\nrender(${output})\n`
    replaceRange(editor, 0, originalLength, source.slice(0, offset) + prefix + chain + suffix + source.slice(offset))
}
