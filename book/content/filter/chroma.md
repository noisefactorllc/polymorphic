Picks out one colour and returns a black and white mask showing where it is.
This is the first half of a green screen key.

`targetHue` is the colour you are hunting for, `range` how much variation to
accept, and `feather` how softly the mask fades out beyond that.

Hue is measured around a circle, so the comparison has to wrap: red sits at both
the very start and the very end of the range, and a naive subtraction would call
two nearly identical reds completely different. The effect takes the shorter way
round the circle instead.

There is one more step that matters more than it sounds. The mask is multiplied
by how saturated the pixel is. A grey pixel technically has a hue, but it is
meaningless, just whatever rounding noise produced, and without this the mask
would flicker wildly across anything near-grey. Weighting by saturation makes it
confident where there is real colour and quiet where there is not.

Further reading:
- Chroma key | https://en.wikipedia.org/wiki/Chroma_key
- Matte (filmmaking) | https://en.wikipedia.org/wiki/Matte_(filmmaking)
