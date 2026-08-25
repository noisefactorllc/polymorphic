Foam. Points are scattered through the volume, and every cell in the grid
records how far it is from the nearest one. Cut that at a threshold and you get
a mass of packed bubbles.

This is the same construction as the flat cell noise, but it is a far better
subject in three dimensions. In two, you get a pattern to look at. In three, the
surface at a given distance is a genuine closed surface with real curvature,
which is why raymarching it gives you something that reads as foam rather than
as a diagram of foam.

Finding the nearest point costs more here. In two dimensions you check the nine
cells around you; in three you check twenty-seven, so the same idea is three
times the work.

Further reading:
- Worley noise | https://en.wikipedia.org/wiki/Worley_noise
- Voronoi diagram | https://en.wikipedia.org/wiki/Voronoi_diagram
- Foam | https://en.wikipedia.org/wiki/Foam
