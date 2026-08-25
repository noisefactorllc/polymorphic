Shows one colour channel on its own, as a greyscale picture. Useful for seeing
what is actually in an alpha channel, or which channel a generator put its detail
in.

`channel` picks red, green, blue or alpha.

The two extra controls turn it into something more than a viewer. Before the
value is displayed it gets multiplied by `scale` and shifted by `offset`, and
then anything above 1 wraps back around to 0. Wrapping is the interesting part:
a smooth gradient scaled up wraps several times over, and each wrap is a hard
jump from white back to black. A gentle ramp becomes a set of sharp contour
lines, and `offset` slides where those lines fall. Left at the defaults nothing
wraps and the channel comes through untouched.

Further reading:
- Channel (digital image) | https://en.wikipedia.org/wiki/Channel_(digital_image)
- Alpha compositing | https://en.wikipedia.org/wiki/Alpha_compositing
