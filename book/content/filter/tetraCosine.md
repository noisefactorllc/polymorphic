The same cosine gradient formula that `palette` uses, but with its four controls
exposed instead of hidden behind a list of presets. Brightness picks a position
along the ramp; the four controls decide what the ramp looks like.

Each one does something you can predict. `offset` is the middle of the ramp,
roughly its average colour. `amp` is how far it swings either side of that.
`freq` is how many times it oscillates across the range of tones. `phase` slides
each channel along independently.

The interesting behaviour comes from setting the three channels' frequencies to
different whole numbers. Because they come back into step at different rates,
the ramp travels through many hues before repeating, which is where the smooth
multi-coloured gradients come from. Non-whole numbers break the repeat entirely,
so the ends of the ramp no longer match.

Further reading:
- Inigo Quilez, Palettes | https://iquilezles.org/articles/palettes/
- Color gradient | https://en.wikipedia.org/wiki/Color_gradient
