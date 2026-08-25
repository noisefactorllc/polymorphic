Auto levels. Stretches the picture so its darkest pixel becomes black and its
brightest becomes white, using the full range instead of a portion of it. The
page is split down the middle: stretched on the left, the washed-out original
on the right.

The arithmetic is trivial. The interesting problem is that a shader works on one
pixel at a time and has no way to see the whole picture, so finding the darkest
and brightest values is not something it can simply look up.

The answer is to reduce the image in stages. One pass has each output pixel
examine a 16 by 16 block and record that block's minimum and maximum, shrinking
the picture sixteenfold. A second pass does the same again to that result, and a
third scans what is left down to a single pair of numbers. Three passes turn
millions of pixels into two values, which the final pass then uses.

A guard skips the stretch when the range is nearly zero, which would otherwise
blow a flat picture out completely.

Further reading:
- Normalization (image processing) | https://en.wikipedia.org/wiki/Normalization_(image_processing)
- Histogram equalization | https://en.wikipedia.org/wiki/Histogram_equalization
