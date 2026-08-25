Contour maps, made by two waves crossing.

The idea is unusual and worth following. Pick a geometric figure: concentric
circles, a polygon, a diamond, a straight ramp. It never gets drawn. Instead the
figure is used to decide *when* each pixel gets its turn. Pixels near the centre
of a circle figure run slightly ahead, pixels further out lag behind, and the
result is a wave that travels outward through that shape.

Two of those waves run at once, each with its own figure and its own speed, and
their values are added together. The sum is then folded at its midpoint, so
values above the middle come back down again. That fold is the whole reason the
picture has crisp contour lines rather than a soft blur: where the two waves add
up to exactly the midpoint, the fold produces an abrupt edge, and those edges
trace out where the two figures interfere with each other.

`loopAOffset` and `loopBOffset` pick the two figures.

Further reading:
- Signed distance function | https://en.wikipedia.org/wiki/Signed_distance_function
- Inigo Quilez, 2D distance functions | https://iquilezles.org/articles/distfunctions2d/
