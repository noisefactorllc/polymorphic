Uses one picture's colours as literal addresses into the other. The red value at
a point says how far across to look, the green value says how far down, and
whatever is there is what you get.

This is not a displacement. A displacement nudges a pixel from where it already
was. This throws away the pixel's own position entirely and goes wherever the
map says to go.

The consequence is worth sitting with. A smooth black-to-white gradient running
across in red and down in green reproduces the picture completely unchanged,
because that gradient is exactly a map of where everything already is. Anything
else scatters it, and a noisy map shreds it into confetti.

Scale and offset act on the address before it is used, so you can confine the
lookup to one region or sweep the source many times over.

Further reading:
- UV mapping | https://en.wikipedia.org/wiki/UV_mapping
- Image warping | https://en.wikipedia.org/wiki/Image_warping
