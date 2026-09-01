The same cosine gradient formula that `palette()` uses, but with its four controls
exposed instead of hidden behind a list of presets. Brightness picks a position
along the ramp; the four controls decide what the ramp looks like. Each is a
trio, one per colour channel.

Each one does something you can predict. `offsetR`, `offsetG` and `offsetB` are
the middle of the ramp, roughly its average colour. `ampR`, `ampG` and `ampB`
are how far it swings either side of that. `freqR`, `freqG` and `freqB` are how
many times each channel oscillates across the range of tones. `phaseR`, `phaseG`
and `phaseB` slide each channel along independently.

The interesting behaviour comes from setting the three channels' frequencies to
different whole numbers. Because they come back into step at different rates,
the ramp travels through many hues before repeating, which is where the smooth
multi-coloured gradients come from. Non-whole numbers break the repeat entirely,
so the ends of the ramp no longer match.

Further reading:
- Inigo Quilez, Palettes | https://iquilezles.org/articles/palettes/
- Color gradient | https://en.wikipedia.org/wiki/Color_gradient
