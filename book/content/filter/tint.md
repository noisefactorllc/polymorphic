Applies a colour to the picture, three different ways, and the difference
between them is what survives.

`overlay` simply replaces the picture with the colour, so `alpha` becomes a
plain opacity control and at full strength nothing of the original is left.

`multiply` keeps the tonal structure. Anything multiplied by a small number
stays small, so the dark areas stay dark and only the bright ones take the
colour. That is how a coloured gel over a light behaves, and it is usually the
one you want.

`recolor` is the most selective. It keeps each pixel's brightness exactly and
replaces only its hue, so the shading is untouched and just the colour changes.
Worth knowing: the saturation it carries through comes from the green channel
rather than the pixel's actual saturation, which is a quirk of this
implementation and explains the occasional over-vivid result.

Further reading:
- Tints and shades | https://en.wikipedia.org/wiki/Tints_and_shades
- Duotone | https://en.wikipedia.org/wiki/Duotone
