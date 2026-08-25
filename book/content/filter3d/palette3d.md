The `palette` effect applied to a volume, colouring each cell rather than each
pixel. The same 55 palettes, the same colour space options.

The property that matters is that it changes the colour and nothing else. A
volume carries two things: a value that says how solid each point is, which the
renderer uses to find the surface, and a colour. This rewrites the colour and
leaves the solidity completely alone, so the shape that comes out of the
renderer is exactly the shape that went in. That is what makes it safe to drop
between a generator and a renderer without having to worry.

Colouring the volume rather than the finished picture also means the palette
follows the surface into shadow and around curves, sitting on the object,
instead of being pasted flat across the frame like a filter.

Further reading:
- Inigo Quilez, Palettes | https://iquilezles.org/articles/palettes/
- Volume rendering | https://en.wikipedia.org/wiki/Volume_rendering
