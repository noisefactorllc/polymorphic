The faceted look of a low-polygon 3D model, with the picture broken into flat
triangular patches of solid colour.

There are no polygons involved. Points are scattered over the picture on a
jittered grid, every pixel finds which point it is closest to, and the whole
region around a point takes a single colour read from that point's location.
Regions that form around scattered points like this are naturally straight-sided
and irregular, which is why the result looks like geometry.

The edges come free. The trick is to keep track of the distance to the nearest
two points, not just the nearest one. Those two distances are equal exactly on
the boundary between regions, so the gap between them tells you how near an edge
you are, with no separate pass to find them.

The points can drift in small circles over time, which makes the facets breathe.

Further reading:
- Low poly | https://en.wikipedia.org/wiki/Low_poly
- Voronoi diagram | https://en.wikipedia.org/wiki/Voronoi_diagram
