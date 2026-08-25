Rings spreading out from the middle of the frame, the way they do when you drop
a stone in still water.

Each pixel measures its distance from the centre and feeds that to a wave, so
pixels at the same distance are always at the same point in the cycle and the
result is concentric. Subtracting time sends the rings travelling outward, in
whole cycles so it loops cleanly. Negative `speed` runs them inward.

`style` decides what the wave actually does to the picture, and the three
choices are genuinely different. `outFromCenter` pushes pixels toward and away
from the middle, which squeezes and stretches the rings radially.
`aroundCenter` swings them sideways instead, giving a twisting swirl.
`pondRipples` does half of each, which is what real water does and the reason it
is the default.

The waves fade out toward the edges, so the disturbance stays near the middle.

Further reading:
- Capillary wave | https://en.wikipedia.org/wiki/Capillary_wave
- Wave interference | https://en.wikipedia.org/wiki/Wave_interference
