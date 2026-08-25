Colour ramps, in seven shapes. Linear sweeps across the frame, radial spreads
from the middle, conic sweeps round like a clock hand, diamond and spiral do
what their names suggest, noise scatters the colours into clouds, and four
corners blends between a colour pinned at each corner.

Underneath, all of them work the same way. Each pixel is boiled down to a single
number between 0 and 1 depending on where it sits, and that number is looked up
along the ramp. The only thing that separates a linear gradient from a radial
one is which question gets asked: how far across are you, or how far out.

`repeat` multiplies that number before the lookup, so the ramp runs through
several times instead of once and you get bands. `speed` slides everything
along, and because the number wraps at the end rather than stopping, the motion
loops forever with no visible jump. Colours cycle in the order you give them and
the last blends back into the first, so banded gradients have no seam.

Further reading:
- Color gradient | https://en.wikipedia.org/wiki/Color_gradient
- Inigo Quilez, Palettes | https://iquilezles.org/articles/palettes/
