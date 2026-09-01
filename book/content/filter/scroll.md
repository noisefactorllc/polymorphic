Pans the picture continuously. `speedX` and `speedY` set the rate, `x` and `y`
add a fixed offset, so the same effect covers both nudging something into place
and scrolling it forever.

The reason this exists separately from `translate()` is aspect correction. On a
widescreen canvas a step sideways is a different physical distance from a step
upward, so scrolling diagonally at equal speeds would drift at the wrong angle
and slowly wander off the diagonal you asked for. This effect squares the
coordinates up first, so equal speeds really do move at equal rates.

`wrap` decides what follows the picture off the edge: `repeat` for endless
tiling, `mirror` for a seamless reflected join, `clamp` to smear the last row of
pixels across the gap.

Further reading:
- Panning (camera) | https://en.wikipedia.org/wiki/Panning_(camera)
- Texture mapping | https://en.wikipedia.org/wiki/Texture_mapping
