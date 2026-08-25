Reduces the picture to a small number of flat colour steps, like a screen print
or a weather map. `levels` sets how many.

The obvious way to do it, rounding every value to the nearest step, produces a
result that looks wrong: the bands bunch up in the shadows and spread out in the
highlights. That is because the numbers stored in an image are not proportional
to how bright things actually are. They are deliberately bent so that dark tones
get more of the available range, which is where our eyes need the precision.

So this effect straightens the numbers out first, does the rounding on values
that are proportional to real light, and bends them back afterwards. The bands
land evenly. `gamma` then lets you deliberately push them toward the shadows or
the highlights, and `antialias` softens each band edge by a single pixel so
gradients do not come out with jagged contours.

Further reading:
- Posterization | https://en.wikipedia.org/wiki/Posterization
- Color quantization | https://en.wikipedia.org/wiki/Color_quantization
