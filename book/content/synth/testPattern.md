Test cards, for when you want to know whether the pipeline is doing what you
think it is.

Colour bars are the standard broadcast eight. The ramp is a plain sweep from
black to white, so any banding or clipping in the chain shows up as a visible
step. The UV map writes horizontal position into red and vertical into green,
which sounds abstract but is the most useful of the lot: put an effect after it
and the colours tell you at a glance whether coordinates were flipped, wrapped,
squashed, or rotated, because you can read the position straight off the screen.

The numbered checkerboard prints each cell's own index in the opposite colour to
its square, so you can tell exactly which cell moved where after a transform.
The digits are drawn from a tiny bitmap font stored as ten numbers, one per
digit, unpacked a pixel at a time. `gridSize` sets how many cells, and the dot
grid and colour grid give you regularly spaced reference points.

Further reading:
- Test card | https://en.wikipedia.org/wiki/Test_card
- SMPTE color bars | https://en.wikipedia.org/wiki/SMPTE_color_bars
