A triangle, square, pentagon, or any regular shape up to 64 sides, drawn as a
solid figure on a background. Useful on its own, and useful as a mask when you
want another effect to apply only inside a shape.

There is no outline and there are no corner points anywhere in the code. Instead
every pixel asks a single question: how far am I from the centre, compared with
how far the edge is in my direction? To answer it the effect takes the pixel's
angle around the centre and folds it into one wedge of the shape, so a hexagon
only ever has to solve the problem for one sixth of a turn and the other five
come free. Anything closer than the edge is inside, anything further is outside.

One correction stops the shapes changing size as you change `sides`, so a
triangle and a hexagon at the same `radius` look equally big. `smooth` controls
how crisp the boundary is, from a hard cut to a soft fade.

Further reading:
- Regular polygon | https://en.wikipedia.org/wiki/Regular_polygon
- Inigo Quilez, 2D distance functions | https://iquilezles.org/articles/distfunctions2d/
