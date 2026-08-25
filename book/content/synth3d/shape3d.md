Polyhedra written into a volume: the three-dimensional counterpart of `shape`
from the first chapter, and it works the same way. Two travelling wavefronts,
each with its own geometry, staggered in time by position and folded where they
meet.

What it adds is knowing which way its own surface faces. After working out the
value at a cell, it evaluates the field three more times, one small step along
each axis, and compares. How much the field changed in each direction tells you
which way it slopes, and that is the surface direction.

The direction is flipped before use, because the field gets stronger as you go
inward, while a surface normal by definition points out.

Further reading:
- Signed distance function | https://en.wikipedia.org/wiki/Signed_distance_function
- Inigo Quilez, Distance functions | https://iquilezles.org/articles/distfunctions/
