The same idea as `palette`, but the twenty-one ramps here are drawn from art
movements and cultural traditions rather than generated from waves. Bauhaus,
ukiyo-e, and so on. Each is a set of five colours.

Brightness picks a position along the set, and `smoothness` decides whether the
colours blend into one another or meet at hard edges. At zero you get five flat
bands, which is closer to how the original palettes were actually used.

`repeat` runs through the set several times across the tonal range, and
`rotation` cycles the whole mapping over time.

One small guard is worth mentioning because it is a classic bug: pure white maps
to exactly the end of the range, which wraps around to the beginning, so the
brightest pixels in a picture would come out the darkest colour. The effect
scales the input a hair short of the top to prevent it.

Further reading:
- Palette (computing) | https://en.wikipedia.org/wiki/Palette_(computing)
- Color scheme | https://en.wikipedia.org/wiki/Color_scheme
