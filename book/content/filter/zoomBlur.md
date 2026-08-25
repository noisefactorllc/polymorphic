The streaks that radiate outward from the middle of the frame when a zoom lens
is racked during an exposure.

Each pixel takes 40 samples along the line between itself and the centre of the
frame, and averages them. Pixels near the middle have almost no distance to
cover so they stay sharp, while pixels near the corners sweep a long way and
smear heavily. That difference is the whole look.

The samples are not weighted evenly. They are weighted by a curve that peaks in
the middle of the sweep and falls to nothing at both ends, so the streak fades
out rather than stopping abruptly at a hard edge.

`strength` sets how far the samples reach. As with `directionalBlur`, the whole
set of samples is nudged by a random amount to prevent the fixed sample count
showing up as ghosting.

Further reading:
- Motion blur | https://en.wikipedia.org/wiki/Motion_blur
- Zoom lens | https://en.wikipedia.org/wiki/Zoom_lens
