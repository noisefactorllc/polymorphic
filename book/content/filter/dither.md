Reducing a picture to very few colours without it falling apart into flat bands.
The trick is to vary the rounding threshold from pixel to pixel, so that where
the true colour sits between two available ones, some pixels round up and some
round down, and your eye mixes them back into the shade that is missing.

Eight patterns are on offer. Three are Bayer matrices, the ordered grids that
gave early computers their look, built so that neighbouring thresholds are as
different as possible and the dots never clump. Then there are dots, lines,
crosshatch, and animated noise.

Floyd-Steinberg is the odd one out. It works by handing each pixel's rounding
error to its neighbours, which means pixels must be done in order, and a shader
does them all at once. It is worked around by starting the calculation a little
way before each visible block and letting it catch up, which arrives at the same
answer.

Further reading:
- Dither | https://en.wikipedia.org/wiki/Dither
- Ordered dithering | https://en.wikipedia.org/wiki/Ordered_dithering
- Floyd-Steinberg dithering | https://en.wikipedia.org/wiki/Floyd%E2%80%93Steinberg_dithering
