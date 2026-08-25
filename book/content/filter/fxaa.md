Fast antialiasing. It smooths jagged edges by blurring along them but not across
them.

Each pixel looks at its four immediate neighbours and weights each one by how
similar its brightness is. A neighbour on the same side of an edge counts fully;
a neighbour across an edge counts for almost nothing. Averaging with those
weights therefore softens the stepping along an edge while leaving the edge
itself sharp, which is the trick that makes this cheap enough to run on
everything.

`threshold` is a cutoff on how much contrast has to be present before the pixel
is touched at all, so flat areas come through completely untouched rather than
very slightly smeared. `sharpness` controls how strictly it refuses to blur
across an edge, and `strength` mixes the result back against the original.

Further reading:
- Fast approximate anti-aliasing | https://en.wikipedia.org/wiki/Fast_approximate_anti-aliasing
- Spatial anti-aliasing | https://en.wikipedia.org/wiki/Spatial_anti-aliasing
