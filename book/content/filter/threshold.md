Everything brighter than a line goes white, everything darker goes black. The
most direct way to turn a photograph into a stark two-tone image.

`level` is where the line sits. `sharpness` decides how abrupt the change is: at
zero it is a hard cut, and turning it up widens the crossing into a grey ramp,
which is gentler on edges that would otherwise come out jagged.

Colour has to be reduced to a single brightness before it can be compared
against anything, and how you do that is a real choice rather than an obvious
one. Green looks much brighter to the eye than blue does at the same numerical
value, so a fair conversion weights the channels unequally. This effect uses the
weighting from analogue television, which is why a saturated red and a saturated
blue can end up on opposite sides of the same threshold even though their
numbers look similar.

Further reading:
- Thresholding (image processing) | https://en.wikipedia.org/wiki/Thresholding_(image_processing)
- Otsu's method | https://en.wikipedia.org/wiki/Otsu%27s_method
