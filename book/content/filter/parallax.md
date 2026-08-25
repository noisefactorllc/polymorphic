Making a flat picture look like it has real depth, using a second picture as a
map of how high each part stands.

The naive way is to shift the picture sideways by an amount proportional to
height, which gives a mild sense of relief but nothing more. This does better.
It follows the line of sight into the surface in thirty-two small steps,
lowering an imaginary height as it goes, and asks at each step whether the
surface has come up to meet it yet. The first step where the ground overtakes
the ray is where you are actually looking.

That is what lets tall things properly hide what is behind them, instead of just
sliding past. The final answer is refined between the last two steps so the
hidden edge lands cleanly rather than in visible bands.

`pivot` picks which height stays put. Everything above it moves one way and
everything below moves the other.

Further reading:
- Parallax mapping | https://en.wikipedia.org/wiki/Parallax_mapping
- Displacement mapping | https://en.wikipedia.org/wiki/Displacement_mapping
