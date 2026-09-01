The flat, inked look of cel animation: areas of solid colour with a hard line
around them and no gradients inside.

Two things happen. The colours are reduced to a small number of flat steps, and
the edges are found and drawn over the top. That is the whole recipe, and it is
what animators did by necessity when every frame was painted by hand on acetate.

The colour reduction is more careful than a plain posterise. It converts to
linear light first so the bands land evenly rather than crowding into the
shadows, applies a diffuse shading term from `lightDirection` so the flat areas
still describe form, and softens each band boundary by a single pixel so the
regions have clean edges without stair-stepping.

`levels` sets how many steps, `edgeColor` the ink, and `mix` how much of
the original shows through.

Further reading:
- Cel shading | https://en.wikipedia.org/wiki/Cel_shading
- Posterization | https://en.wikipedia.org/wiki/Posterization
