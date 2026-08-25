Noise filling a solid volume rather than a flat picture, and the starting point
for most programs in these two chapters. The demonstration is two effects:
`noise3d` fills the volume, and `render3d` turns it into an image.

Volumes have to be stored as flat pictures, because that is all a fragment shader
can write to. A volume of side N is laid out as a tall strip, N wide and N
squared tall, with each horizontal slice stacked below the last. Every shader
here unpacks its position from that strip the same way.

Simplex noise is used rather than the simpler value noise, and it matters more
here than in two dimensions. Value noise is built on a cubic grid, and a cubic
grid leaves faint traces along its own axes that you can see once you start
raymarching. Simplex uses a tetrahedral arrangement that has no preferred
direction, and needs fewer corners per cell into the bargain.

Further reading:
- Simplex noise | https://en.wikipedia.org/wiki/Simplex_noise
- Voxel | https://en.wikipedia.org/wiki/Voxel
