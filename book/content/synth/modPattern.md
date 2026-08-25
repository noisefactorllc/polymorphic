Interference patterns, of the sort you get when two fine grids overlap slightly
out of step: moire.

It comes from folding. Take a coordinate, wrap it so it counts up and then back
down again over and over, and you have a value that ramps and reverses with a
crease at every turn. Do that, then pick out a shape with a single comparison of
the two folded coordinates: the larger of the two draws a plus, the smaller
draws a square, the difference draws a diamond.

The reason the output gets so intricate is that each of the three layers folds
the layer before it rather than the original picture. You are not stacking three
patterns on top of one another, you are folding an already folded thing, and
small differences in the scales multiply out into large visible ones. The three
results are then added and wrapped, which turns every smooth ramp into hard
banding. `smoothing` softens the point where the wrap jumps, and the blend modes
change how the three layers meet.

Further reading:
- Moire pattern | https://en.wikipedia.org/wiki/Moir%C3%A9_pattern
- Modular arithmetic | https://en.wikipedia.org/wiki/Modular_arithmetic
