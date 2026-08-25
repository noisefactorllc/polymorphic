Chooses between two pictures by comparing a map against a cutoff. Above the
line, you see one; below it, the other. Either input can be the map.

The comparison can run on brightness, or on each colour channel separately.

Per-channel is the more interesting mode. With its own cutoff for red, green and
blue, the choice gets made three times over, and a single pixel can end up
taking its red from one picture and its blue from the other. What you get is
colour separation rather than a clean cut, with fringes of pure colour where the
three decisions disagree.

`range` is the width of the fade either side of the cutoff, so at zero it is a
hard-edged stencil. Stepping the map into discrete levels first turns smooth
gradients into banded regions before any of this happens.

Further reading:
- Thresholding (image processing) | https://en.wikipedia.org/wiki/Thresholding_(image_processing)
- Channel (digital image) | https://en.wikipedia.org/wiki/Channel_(digital_image)
