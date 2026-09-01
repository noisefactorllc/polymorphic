Barrel and pincushion distortion, the two ways a real lens fails to keep
straight lines straight. Barrel bows them outward, pincushion pulls them in.
Wide-angle lenses do the first, telephotos the second.

Every pixel is pushed along the line between itself and the centre of the frame.
How far it moves depends on how far out it already is, weighted so the effect is
strongest in the middle and fades to nothing at the corners. That particular
falloff is what gives lens distortion its recognisable shape rather than a
uniform stretch.

`displacement` picks which way and how much. Negative values also zoom in
slightly, because pulling the picture inward would otherwise leave the corners
empty. `aspectLens` decides whether the distortion is circular or follows the
frame's proportions, and `antialias` supersamples where the stretch is worst.

Further reading:
- Distortion (optics) | https://en.wikipedia.org/wiki/Distortion_(optics)
- Optical aberration | https://en.wikipedia.org/wiki/Optical_aberration
