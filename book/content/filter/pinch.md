The opposite of `bulge()`. The middle of the picture is sucked inward, as though
the image were being pulled down a drain.

It is the same operation with the sign flipped: each pixel's distance from the
centre goes through a power, but this time distance stretches at the edges and
compresses in the middle, so everything is drawn toward the centre point.

One thing to notice is that a pinch is strongest at middle distances and does
nothing at all at the exact centre or at the very edge. That is what produces a
funnel shape rather than a uniform shrink, and it is why the effect looks like
something being drawn into a hole rather than the picture simply getting
smaller.

`strength` sets how deep the funnel is, `aspectLens` whether it is circular or
follows the frame, and `wrap` decides what fills the border that the inward pull
leaves empty.

Further reading:
- Distortion (optics) | https://en.wikipedia.org/wiki/Distortion_(optics)
- Image warping | https://en.wikipedia.org/wiki/Image_warping
