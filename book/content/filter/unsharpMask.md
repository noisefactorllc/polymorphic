Sharpening, done the way photographers have done it since long before computers.
The name comes from the darkroom: you made a blurred copy of the negative,
sandwiched it with the original, and printed through both.

The logic is neat. Blur a picture and you have thrown away exactly the fine
detail. Subtract the blurred version from the original and what is left is that
detail on its own. Add it back and the detail is now there twice over.

`radius` sets the size of detail this catches, `amount` how much is added back.

`threshold` is what makes this better than `sharpen()` on a photograph.
Differences smaller than it are left alone, so flat areas keep their smoothness
and sensor noise does not get amplified along with the real edges. Raise it until
skies stay clean and only the things you meant to sharpen do.

Further reading:
- Unsharp masking | https://en.wikipedia.org/wiki/Unsharp_masking
- Darkroom | https://en.wikipedia.org/wiki/Darkroom
