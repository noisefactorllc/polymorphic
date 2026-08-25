Smears the picture in a straight line, the way a photograph blurs when the
camera is panned during the exposure. `angle` sets the direction, `blurDistance`
how far.

The method is simple: take 32 samples spread along that line and average them.
Thirty-two is not many for a long smear, and on its own it looks wrong, because
you see the individual samples as repeated ghost copies of the picture rather
than a continuous streak.

The fix is worth knowing because it appears throughout computer graphics. Each
pixel shifts its whole set of samples by a small random amount, different for
every pixel. The ghosting is still there but it now falls in a different place
for every pixel, so instead of coherent repeated copies you get fine noise. Your
eye reads noise as grain and ignores it, where it reads repeated copies as an
error.

Further reading:
- Motion blur | https://en.wikipedia.org/wiki/Motion_blur
- Panning (camera) | https://en.wikipedia.org/wiki/Panning_(camera)
