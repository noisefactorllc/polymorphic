The twelve tiling patterns from `pattern`, used as a stencil between two
pictures instead of being drawn as a picture in their own right. Checkerboard,
dots, hexagons, stripes, rings, spirals, triangles, hearts, waves and zigzags
all work.

Each pattern produces a value from black to white at every point, and that value
chooses which picture shows through.

The same `smoothness` control that softens the edges of a drawn pattern here
softens the handover between the two pictures. At zero they meet along a hard
geometric line. Turned up, they cross-fade through the pattern's edges, which
turns a checkerboard into something closer to a soft dappling.

Rotation and scale act on the stencil before it is used, so you can retune the
pattern without touching either source.

Further reading:
- Tessellation | https://en.wikipedia.org/wiki/Tessellation
- Wipe (transition) | https://en.wikipedia.org/wiki/Wipe_(transition)
