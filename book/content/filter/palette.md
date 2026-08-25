Recolours the picture by mapping brightness to a colour ramp. Dark tones take
one end of the ramp, bright tones the other. It is the quickest way to make a
greyscale generator look like something.

The palettes are not stored as lists of colours. Each one is four numbers per
channel fed to a cosine wave, an idea of Inigo Quilez's, and the whole gradient
falls out of that. It means a rich smooth ramp costs twelve numbers rather than a
lookup table, and that every palette is smooth by construction.

Not all of them are computed in ordinary colour, either. Some run the same waves
through a perceptual colour space instead, so their ramps move evenly to the eye
rather than lurching between the corners of the colour cube.

`repeat` runs the ramp through several times over the tonal range for banding,
and `rotation` cycles it.

Further reading:
- Inigo Quilez, Palettes | https://iquilezles.org/articles/palettes/
- False color | https://en.wikipedia.org/wiki/False_color
