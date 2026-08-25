Pushes the middle of the picture out toward you, like a fisheye lens or a
reflection in a spoon.

Each pixel works out how far it is from the centre, and that distance is put
through a power. The consequence is that distance is not scaled evenly: near the
middle it stretches, near the edge it compresses. Everything the picture contains
therefore gets pulled outward from the centre, with the middle magnified most.

`strength` sets how pronounced it is. `aspectLens` decides whether the bulge is
a circle or follows the shape of the frame, which matters on a widescreen canvas:
with it off the bulge becomes an oval and matches the picture's proportions.

`pinch` is the same effect with the sign reversed. `rotation` only does anything
visible when the bulge is not circular, since there is nothing to see turning
otherwise.

Further reading:
- Fisheye lens | https://en.wikipedia.org/wiki/Fisheye_lens
- Distortion (optics) | https://en.wikipedia.org/wiki/Distortion_(optics)
