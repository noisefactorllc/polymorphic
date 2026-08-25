The soft, drifting, cloudlike texture most programs in this book start from.

It is made by scattering random values on a grid and filling in the space
between them, so neighbouring places end up similar and you get rolling shapes
rather than television static. Everything else is a variation on how that filling
in is done.

`type` picks the method, and it changes the character completely. `constant`
does no filling at all and leaves hard square cells. The others smooth it out to
varying degrees, from a plain straight line between neighbours to curves that
consult several grid points at once for a rounder result.

`octaves` lays the same pattern down again at twice the frequency and half the
strength, which puts fine detail on top of large shapes. `ridges` folds the values at their midpoint so mid grey
becomes the brightest value, turning soft hills into sharp creases. `wrap` makes
the pattern tile, so its left edge carries on into its right, and `speed` sets it
drifting.

Further reading:
- Value noise | https://en.wikipedia.org/wiki/Value_noise
- Simplex noise | https://en.wikipedia.org/wiki/Simplex_noise
