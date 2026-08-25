Like `warp`, but applied several times over at increasingly fine scales, which
gives the folded, marbled look of stirred paint or oil on water.

The difference from simply layering several warps is that each pass distorts a
picture that has already been distorted. The coarse pass moves things a long way,
then the next pass, working at half the size and half the strength, pushes the
already-moved result around again, and so on. Detail therefore follows the shape
the larger swirls imposed rather than sitting on top of it, and that compounding
is what produces the characteristic folds.

`octaves` sets how many passes. Two or three is usually plenty; more quickly
turns everything to mush. `displacement` sets the strength of the first pass, and
each pass after it moves half as far, so the contribution stays roughly the same
size on screen at every scale. `frequency` sets how large the coarsest swirls
are.

Further reading:
- Inigo Quilez, Domain warping | https://iquilezles.org/articles/warp/
- Fractional Brownian motion | https://en.wikipedia.org/wiki/Fractional_Brownian_motion
