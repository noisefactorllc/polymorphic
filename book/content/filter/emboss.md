Turns the picture into a raised relief, as though it were stamped into metal.

The method is a lopsided comparison. Each pixel is compared with its neighbours,
but weighted so one diagonal counts positively and the opposite one negatively.
Surfaces sloping toward the light come out bright, surfaces sloping away come out
dark, and anything flat cancels to nothing, which is why an embossed picture is
mostly mid grey with detail only at the edges.

`angle` moves the light around. It does that by rotating which neighbours get
compared rather than by changing the weights, so the character of the relief
stays the same at every angle.

`style` picks between keeping the picture's colours in the relief, or converting
to neutral grey and adding a little colour back only near the edges, which gives
the classic carved-stone look.

Further reading:
- Image embossing | https://en.wikipedia.org/wiki/Image_embossing
- Kernel (image processing) | https://en.wikipedia.org/wiki/Kernel_(image_processing)
