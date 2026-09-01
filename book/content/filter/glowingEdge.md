Finds the edges in a picture and makes them glow, as though they were made of
neon.

The edges are found the usual way, by measuring how quickly brightness changes.
What is different is what happens next: instead of drawing the edge as a line,
the edge strength is multiplied by the picture's own colour to make a light, and
that light is added over the original.

The combination is done with a screen blend, which can only ever lighten and
which approaches white smoothly rather than clipping, so bright areas near an
edge glow up toward white instead of blowing out into a flat patch.

Because the glow carries the underlying colour, each edge lights up in whatever
hue it runs through. `shape` changes the pattern of pixels the edge strength is
measured across, whether a circle, diamond, square or star, which alters the
character of the lines. `width` sets how far apart the compared pixels sit.

Further reading:
- Edge detection | https://en.wikipedia.org/wiki/Edge_detection
- Blend modes | https://en.wikipedia.org/wiki/Blend_modes
