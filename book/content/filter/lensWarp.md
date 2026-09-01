Ripples confined to the edges of the frame, as though you were looking through a
sheet of imperfect glass. The middle of the picture stays perfectly still.

It uses the same noise displacement as `warp()`, but multiplied by a mask that
measures each pixel's distance from the centre and raises it to the fifth power.
That exponent is the entire design. A fifth power stays near zero across most of
the frame and only climbs steeply in the last part of the way out, so the effect
does nothing at all until you are close to the border and then arrives quickly.

The result reads as a flaw in the lens rather than a distortion of the subject,
because your eye takes a still centre and a disturbed edge as a property of the
glass rather than of the scene. `displacement` sets how much the border moves,
and `antialias` supersamples the ring where the stretch is steepest.

Further reading:
- Distortion (optics) | https://en.wikipedia.org/wiki/Distortion_(optics)
- Refraction | https://en.wikipedia.org/wiki/Refraction
