Depth of field. Part of the picture is sharp and the rest falls out of focus,
with a second picture deciding what is near and what is far.

The brightness of the map says how far each part of the subject sits from the
focal plane, and the amount of blur follows from that. Things at the focus depth
stay crisp; everything else softens in proportion to how far off it is.

This is the same idea a 3D renderer uses for its depth of field pass, except
that you supply the depth rather than the renderer working it out from geometry.

Feed it a top-to-bottom gradient and you get the tilt-shift look, where a real
scene reads as a model. Feed it a soft circle and you get a subject in focus
against a blurred surround. Feed it any picture at all and you get a focus field
that is arbitrary but entirely plausible.

Further reading:
- Depth of field | https://en.wikipedia.org/wiki/Depth_of_field
- Tilt-shift photography | https://en.wikipedia.org/wiki/Tilt%E2%80%93shift_photography
