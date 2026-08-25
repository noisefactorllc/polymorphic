Two pictures cut into interlocking irregular patches, like a cracked mosaic
where half the tiles come from each.

Points are scattered across the frame, and every pixel belongs to whichever
point is nearest. That gives you a field of irregular straight-sided cells. Each
cell then rolls a die to decide which of the two pictures it shows.

Because the decision is made once per cell rather than once per pixel, each
patch is internally consistent: the whole cell comes from one picture, and the
seam between the two always lands exactly on a cell boundary. You never get
speckle.

The points can wobble slowly on small circular paths, which makes the patches
drift and trade places without dissolving into noise.

Further reading:
- Voronoi diagram | https://en.wikipedia.org/wiki/Voronoi_diagram
- Worley noise | https://en.wikipedia.org/wiki/Worley_noise
