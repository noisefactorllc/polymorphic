A landscape built out of blocks. It takes two flat pictures and fills a volume
from them: one says how tall each column stands, the other what colour it is.

Seen from above, the volume is a grid of columns, and each column reads
`heightTex` once at its own position. The brightness is multiplied by
`heightScale`, raised by `baseHeight` so that even black can stand on a plinth,
and rounded to a whole number of blocks. Everything below that level is filled
and everything above it stays empty. A column has only that one number to go on,
which is the nature of a heightfield: it can make mountains but never an overhang
or a cave.

`tex` is only paint. It is read once per column and stored in every block of it,
and its brightness never changes the shape.

A volume shows nothing until a renderer flattens it, and `renderLandscape3d()` is
the one built for this. `volumeSize` sets how many blocks fit along each side. A
small volume looks like a model made of bricks; a large one starts to read as
terrain. The top of each picture lies along the far edge, so a view from straight
above shows both the way they were drawn.

Further reading:
- Heightmap | https://en.wikipedia.org/wiki/Heightmap
- Voxel | https://en.wikipedia.org/wiki/Voxel
