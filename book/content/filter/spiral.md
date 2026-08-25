Twists the picture around its centre, more and more the further out you go, so
straight lines wind into spiral arms.

The whole effect is one line of arithmetic. Each pixel works out its angle around
the centre and its distance from it, then the angle is nudged by an amount
proportional to the distance. Pixels near the middle barely turn at all and
pixels near the edge turn a great deal. That difference is what bends a straight
line into a curve: rotate everything by the same amount and the picture merely
spins.

Because the twist grows evenly with distance the arms are evenly spaced, rather
than the tightening coil of a nautilus shell.

`strength` sets how many turns, and its sign sets the direction. `speed` rotates
the whole figure without winding or unwinding it, so the spiral turns like a
record rather than tightening.

Further reading:
- Archimedean spiral | https://en.wikipedia.org/wiki/Archimedean_spiral
- Image warping | https://en.wikipedia.org/wiki/Image_warping
