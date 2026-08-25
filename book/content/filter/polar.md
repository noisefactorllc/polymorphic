Two ways of turning the picture inside out.

Polar mode swaps rectangular coordinates for circular ones. Instead of
horizontal and vertical, each pixel is described by its angle around the centre
and its distance from it, and the picture is read using those. The practical
result is that the top edge of the source wraps into a ring around the middle
and the vertical axis runs outward, so straight lines become circles and rays.
It is the same transformation that turns a panorama into a little planet.

Vortex mode does something stranger, called a circle inversion: it divides each
coordinate by its own distance from the centre, which swaps near for far. Things
close to the middle are flung out to the edges and distant things collapse
inward. The picture is turned inside out through a point.

`antialias` is worth leaving on. Near the centre these transforms stretch a
single pixel across a large area, which aliases badly otherwise.

Further reading:
- Polar coordinate system | https://en.wikipedia.org/wiki/Polar_coordinate_system
- Log-polar coordinates | https://en.wikipedia.org/wiki/Log-polar_coordinates
