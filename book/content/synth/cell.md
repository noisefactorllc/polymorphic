A field of cells, like foam, cracked mud, or the scales on a lizard. It is
usually called cellular or Worley noise.

The idea is simple: scatter points across the picture, then colour every pixel
by how far it is from the nearest one. Pixels sitting right on a point come out
dark, pixels stranded between points come out bright, and the boundaries land
exactly halfway between neighbouring points. That halfway line is what gives you
the cell walls, and nothing ever has to work out where the walls are; they
appear on their own.

`shape` is the parameter that changes the character most, because it changes
what "distance" means. The default measures it as the crow flies and gives
rounded cells, but it can also measure to a diamond, triangle, square, hexagon,
or octagon, which makes the cells take those shapes instead. `cellSmooth` rounds
the joins between neighbouring cells so they melt into one another rather than
meeting at a crease, and `speed` lets the points drift so the whole surface
crawls.

Further reading:
- Worley noise | https://en.wikipedia.org/wiki/Worley_noise
- Voronoi diagram | https://en.wikipedia.org/wiki/Voronoi_diagram
