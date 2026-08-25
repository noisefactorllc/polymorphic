Makes a picture look crisper by exaggerating the difference between each pixel
and its surroundings.

The method is older than computers. Compare a pixel with the average of its
neighbours: on a flat area they are the same and nothing happens, but on an edge
the pixel differs, and that difference gets added back on top, pushing it further
from its neighbours than it was. Edges gain contrast, flat areas are untouched.
The weights are arranged so they add up to exactly one, which means the picture's
overall brightness comes out unchanged.

`amount` does something slightly surprising. Rather than sharpening harder, it
moves the neighbours it compares against further away. So turning it up does not
make fine detail more intense, it starts sharpening larger and larger features
instead. If you want fine detail brought up hard, `unsharpMask` gives you that
control separately.

Further reading:
- Unsharp masking | https://en.wikipedia.org/wiki/Unsharp_masking
- Kernel (image processing) | https://en.wikipedia.org/wiki/Kernel_(image_processing)
