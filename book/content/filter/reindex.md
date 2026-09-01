Uses each pixel's brightness as a map reference, and shows whatever is at that
address instead.

Nothing moves. A pixel does not shift position: it is replaced entirely by the
colour found somewhere else in the picture, at a location its own brightness
names. Every pixel of the same tone therefore fetches from the same place and
comes out the same colour, so smooth gradients collapse into sharp bands of
repeated content.

`displacement` scales how far across the picture the lookup ranges. Because the
address wraps around when it runs off the end, raising it sweeps the lookup
through the picture many times and multiplies the banding.

To normalise brightness first the effect has to know the picture's own range,
which it finds by reducing the image in stages the same way `normalize()` does.

Further reading:
- Lookup table | https://en.wikipedia.org/wiki/Lookup_table
- Image warping | https://en.wikipedia.org/wiki/Image_warping
