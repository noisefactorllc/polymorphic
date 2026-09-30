import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Programs } from '../../public/js/programs.js'

test('saved programs preserve the original image payload through storage reload', () => {
    const values = new Map()
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
    const image = { id: 'a', dataUrl: 'original bytes' }
    new Programs(storage).saveProgram('Image', 'media(url:"image:a")', [image])
    const program = new Programs(storage).get('Image')
    assert.deepEqual(program.images, [image])
    assert.equal(program.dsl, 'media(url:"image:a")')
})
