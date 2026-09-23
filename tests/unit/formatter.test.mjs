import { test } from 'node:test'
import assert from 'node:assert'
import { formatDsl } from '../../public/js/ui/formatter.js'

test('formatDsl indents chain steps', () => {
    const input = 'noise(scaleX:80).palette(index:vaporwave).write(o0)'
    const expected = 'noise(scaleX: 80)\n  .palette(index: vaporwave)\n  .write(o0)'
    assert.strictEqual(formatDsl(input), expected)
})

test('formatDsl normalizes search line', () => {
    const input = 'search   synth ,filter\nnoise().write(o0)\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.startsWith('search synth, filter\n'))
})

test('formatDsl preserves blank-line block separators', () => {
    const input = 'search synth, render\n\nnoise().write(o0)\n\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('\n\n'), 'blank line preserved between blocks')
})

test('formatDsl is idempotent', () => {
    const input = 'search synth, render\n\nnoise(scaleX: 80)\n  .write(o0)\n\nrender(o0)'
    assert.strictEqual(formatDsl(formatDsl(input)), formatDsl(input))
})

test('formatDsl collapses multi-line argument blocks', () => {
    const input = 'noise()\n  .adjust(\n    mode: hsv,\n    rotation: 120\n  )\n  .write(o0)\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('  .adjust(mode: hsv, rotation: 120)'),
        'multi-line .adjust(...) collapses onto one indented line')
    assert.ok(!/^[a-z]/m.test(out.split('\n').filter(l => l.includes('mode:')).join('')),
        'argument-only lines never appear at column 0')
})

test('formatDsl idempotent across multi-line input', () => {
    const input = 'search synth, filter, render\n\nnoise()\n  .adjust(\n    mode: hsv,\n    rotation: 120\n  )\n  .write(o0)\n\nrender(o0)'
    const once = formatDsl(input)
    const twice = formatDsl(once)
    assert.strictEqual(twice, once)
})

// ---- string-literal safety (formatting must never corrupt quoted values) ----

test('formatDsl does not mangle a media() URL', () => {
    const input = 'media(url:"https://example.com/img.png").write(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('"https://example.com/img.png"'),
        `URL must survive verbatim, got: ${out}`)
})

test('formatDsl preserves a URL containing parentheses and a query string', () => {
    const input = 'media(url:"https://x.com/File_(1).png?t=1,2").write(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('"https://x.com/File_(1).png?t=1,2"'),
        `URL with parens/commas must survive, got: ${out}`)
})

test('formatDsl preserves colons inside text() strings', () => {
    const input = 'solid().text(text:"Time: 12:30 PM").out(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('"Time: 12:30 PM"'),
        `colon inside string must not gain spaces, got: ${out}`)
})

test('formatDsl preserves commas inside strings (no injected space)', () => {
    const input = 'solid().text(text:"a,b,c").out(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('"a,b,c"'),
        `comma inside string must not gain spaces, got: ${out}`)
})

test('formatDsl still normalizes code spacing around a protected string', () => {
    const input = 'solid().text(text:"x",size:0.2).out(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('.text(text: "x", size: 0.2)'),
        `code outside the string is still normalized, got: ${out}`)
})

test('formatDsl handles single-quoted strings', () => {
    const input = "media(url:'https://x.com/a:b').write(o0)"
    const out = formatDsl(input)
    assert.ok(out.includes("'https://x.com/a:b'"),
        `single-quoted value must survive, got: ${out}`)
})

test('formatDsl tolerates an unbalanced paren inside a string', () => {
    const input = 'solid().text(text:"smile :)").out(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('"smile :)"'), `string content preserved, got: ${out}`)
    assert.ok(out.includes('.out(o0)'), `chain still splits correctly, got: ${out}`)
})

test('formatDsl does not corrupt an unterminated string', () => {
    const input = 'solid().text(text:"oops).out(o0)'
    const out = formatDsl(input)   // must not throw
    assert.ok(out.includes('"oops).out(o0)'), `unterminated tail preserved, got: ${out}`)
})

test('formatDsl is idempotent on sketches with strings', () => {
    const input = 'media(url:"https://x.com/a.png")\n  .text(text:"Hi: there, ok")\n  .out(o0)'
    const once = formatDsl(input)
    assert.strictEqual(formatDsl(once), once)
})

test('formatDsl keeps a literal whole when it contains the other quote', () => {
    // Literals pair on the SAME quote: an apostrophe inside "..." is content,
    // not a string end — deliberately more robust than the engine's [^"'] rule,
    // which would split here and re-space the comma. Pin it so a refactor can't
    // silently regress to either-quote matching.
    const out = formatDsl(`solid().text(text:"O'Brien, hi").out(o0)`)
    assert.ok(out.includes(`"O'Brien, hi"`), `mixed-quote literal must stay whole, got: ${out}`)
})

test('formatDsl handles adjacent string literals', () => {
    const out = formatDsl('solid().text(text:"a","b").out(o0)')
    assert.ok(out.includes('"a", "b"'), `adjacent literals: code comma normalized, both intact, got: ${out}`)
})

test('formatDsl handles an empty string literal', () => {
    const out = formatDsl('solid().text(text:"",size:0.1).out(o0)')
    assert.ok(out.includes('text: "", size: 0.1'), `empty literal + surrounding code, got: ${out}`)
})

// ---- comment preservation and multi-line triple quotes ----

test('formatDsl preserves comments between chain steps without commenting out code', () => {
    const input = 'noise(scaleX: 80)\n  // apply palette\n  .palette(index: vaporwave)\n  // send to buffer\n  .write(o0)'
    const expected = 'noise(scaleX: 80)\n  // apply palette\n  .palette(index: vaporwave)\n  // send to buffer\n  .write(o0)'
    const out = formatDsl(input)
    assert.strictEqual(out, expected)
    assert.strictEqual(formatDsl(out), out, 'idempotent across chain comments')
})

test('formatDsl preserves trailing comments with URLs and colons intact', () => {
    const input = 'noise(scaleX: 80) // generator base\n  .palette(index: vaporwave) // color: https://example.com/item_(1)?a=1:2\n  .write(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('// generator base'))
    assert.ok(out.includes('// color: https://example.com/item_(1)?a=1:2'))
    assert.ok(out.includes('  .write(o0)'))
    assert.strictEqual(formatDsl(out), out, 'idempotent across trailing comments')
})

test('formatDsl does not collapse multi-line argument blocks containing comments', () => {
    const input = 'noise(\n  // horizontal scale\n  scaleX: 80,\n  // vertical scale\n  scaleY: 40\n).write(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('// horizontal scale'))
    assert.ok(out.includes('scaleX: 80'))
    assert.ok(out.includes('// vertical scale'))
    assert.ok(out.includes('scaleY: 40'))
    assert.ok(out.includes('.write(o0)'))
    // Code lines must not be appended after comments on the same line
    for (const line of out.split('\n')) {
        const commentIdx = line.indexOf('//')
        if (commentIdx !== -1) {
            const comment = line.slice(commentIdx)
            assert.ok(!comment.includes('scaleX: 80'))
            assert.ok(!comment.includes('scaleY: 40'))
            assert.ok(!comment.includes('.write'))
        }
    }
})

test('formatDsl preserves multi-line triple-quoted strings verbatim', () => {
    const input = `solid(alpha: 0)\n  .text(\n    text: """genart\n.social""",\n    font: "Monaspace",\n    size: 0.33\n  )\n  .write(o0)`
    const out = formatDsl(input)
    assert.ok(out.includes('"""genart\n.social"""'), 'triple-quoted newline preserved')
    assert.ok(out.includes('.write(o0)'), 'chain continuation preserved')
    assert.strictEqual(formatDsl(out), out, 'idempotent with multi-line triple-quoted string')
})

test('formatDsl preserves single-quoted triple quotes with internal quotes and colons', () => {
    const input = `solid().text(text: '''Line "1": start\nLine '2': end''').write(o0)`
    const out = formatDsl(input)
    assert.ok(out.includes(`'''Line "1": start\nLine '2': end'''`), 'single triple quotes preserved verbatim')
    assert.ok(out.includes('.write(o0)'), 'chain split preserved')
})

test('formatDsl preserves subchain blocks with curly braces', () => {
    const input = 'solid(alpha: 0)\n  .subchain(name: "grp", id: "abc") {\n    .text(text: "in sub :) ok", font: "Inter")\n  }\n  .write(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('.subchain(name: "grp", id: "abc") {'))
    assert.ok(out.includes('.text(text: "in sub :) ok", font: "Inter")'))
    assert.ok(out.includes('  .write(o0)'))
    assert.strictEqual(formatDsl(out), out, 'idempotent across subchains')
})

test('formatDsl preserves escaped quotes inside string literals', () => {
    const input = 'solid().text(text: "Hello \\"World\\": 1, 2").write(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('"Hello \\"World\\": 1, 2"'), `escaped quotes preserved, got: ${out}`)
    assert.ok(out.includes('.write(o0)'), `chain split preserved, got: ${out}`)
    assert.strictEqual(formatDsl(out), out, 'idempotent with escaped quotes')
})

test('formatDsl preserves dollar signs and replace tokens in multi-line strings', () => {
    const input = 'solid().text(text: """Price: $$10\nItem: $& sale\nCode: $` and $\' and $1""").write(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('Price: $$10\nItem: $& sale\nCode: $` and $\' and $1'), `replace tokens preserved, got: ${out}`)
    assert.ok(out.includes('.write(o0)'), 'chain continuation preserved')
    assert.strictEqual(formatDsl(out), out, 'idempotent across dollar tokens')
})

test('formatDsl preserves search line trailing comments with commas', () => {
    const input = 'search synth, filter // tags: audio, sound, fx'
    const out = formatDsl(input)
    assert.strictEqual(out, 'search synth, filter // tags: audio, sound, fx')
})

test('formatDsl splits chains even when preceded by closing delimiter on same line', () => {
    const input = ').write(o0).palette(index: 2)'
    const out = formatDsl(input)
    assert.ok(out.includes('.write(o0)\n  .palette(index: 2)'), `split after closing delimiter, got: ${out}`)
})


