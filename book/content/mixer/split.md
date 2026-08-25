A wipe between two pictures along a straight line, at any angle, with a soft or
hard edge.

The animation is the part with something to say. To scroll the line all the way
across the frame and come back without a visible jump, the shader has to know
exactly how far the line needs to travel, and that depends on both the angle and
the shape of the canvas: a diagonal line across a wide frame has much further to
go than a vertical one across a square.

So the reach is worked out from the angle and the aspect ratio rather than
guessed, and the sweep runs across exactly that distance and no further. The
direction then reverses each cycle, so the line arrives back where it started
instead of teleporting. Running it one way only would wrap visibly the moment
it reset.

Further reading:
- Wipe (transition) | https://en.wikipedia.org/wiki/Wipe_(transition)
- Rotation matrix | https://en.wikipedia.org/wiki/Rotation_matrix
