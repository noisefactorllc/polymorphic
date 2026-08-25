Turns the picture. `rotation` is in degrees.

The one subtlety is aspect ratio. On a widescreen canvas, one step sideways and
one step up are not the same physical distance, so rotating without accounting
for that turns a square into a leaning parallelogram. The effect squares the
coordinates up before turning them and puts them back afterwards, which is why
things stay the shape they were.

`speed` spins it continuously rather than rocking back and forth, and a whole
number gives a whole number of turns per loop, so it comes back exactly to where
it started.

`wrap` decides what fills the corners that turning exposes. `mirror` is the safe
default because the reflected content meets the original edge to edge with no
visible join; `repeat` tiles, and `clamp` smears the edge pixels outward.

Further reading:
- Rotation matrix | https://en.wikipedia.org/wiki/Rotation_matrix
- Transformation matrix | https://en.wikipedia.org/wiki/Transformation_matrix
