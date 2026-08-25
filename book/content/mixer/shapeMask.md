One picture inside a shape, the other outside it.

The shape is described by a formula that, for any point, returns how far you are
from its outline and whether you are inside or out. That is a more useful thing
to have than a plain yes or no, because the soft edge comes free: fade across
the zero crossing and the boundary feathers by however much you want, with no
extra work.

The coordinates are corrected for the shape of the canvas first, so a circle
stays a circle on a wide frame instead of stretching into an oval, and rotation
turns the shape rather than the picture inside it.

Position offsets move the shape without moving either picture, and the speed
control pulses its size, returning exactly to where it started at the end of the
loop.

Further reading:
- Signed distance function | https://en.wikipedia.org/wiki/Signed_distance_function
- Inigo Quilez, 2D distance functions | https://iquilezles.org/articles/distfunctions2d/
