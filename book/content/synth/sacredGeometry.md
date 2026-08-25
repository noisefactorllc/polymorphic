Eight classical figures: the Flower of Life, Seed of Life, Fruit of Life,
Metatron's Cube, the Vesica Piscis, Borromean rings, a triquetra, and star
polygons.

They are all built from circles and straight lines, drawn as outlines rather
than filled shapes. How an outline appears here is worth knowing, because the
trick recurs throughout the book. Every pixel is told how far it is from the
edge of a circle. Ignore whether it is inside or outside and keep only the
distance, and pixels near the edge have small values while everything else has
large ones. Keep the small ones and you have drawn a ring, without ever tracing
a path.

The figures differ only in where the circles go. The triquetra is the neat one:
its three pointed arcs come from asking, for each pair of circles, for the
larger of the two distances. That is the overlap of the two circles expressed as
a single number, so the familiar interlocking shape falls out without anything
having to compute an intersection.

Further reading:
- Sacred geometry | https://en.wikipedia.org/wiki/Sacred_geometry
- Overlapping circles grid | https://en.wikipedia.org/wiki/Overlapping_circles_grid
- Vesica piscis | https://en.wikipedia.org/wiki/Vesica_piscis
