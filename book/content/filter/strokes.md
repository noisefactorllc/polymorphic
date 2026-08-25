A brush engine. The picture is rebuilt out of directional marks, each one
tapering away along its length.

Every mode works by gathering colour along a line and weighting the samples so
that nearby ones count for a lot and distant ones fade out. That fade is what
turns a point into a stroke with a head and a tail rather than a smear of even
thickness.

Where each stroke lies is decided by a smooth noise field rather than a
per-pixel roll of the dice, so neighbouring pixels agree on where they are in
the same mark and the strokes come out whole instead of dissolving into fuzz.

The modes vary the direction and the finish. Angled runs two sets of strokes
crossing at right angles and picks between them by tone, so light and dark areas
are hatched crosswise. Sprayed scatters its samples off the stroke line. Sumi-e
bleeds the darks outward, the way ink spreads into wet paper.

Further reading:
- Non-photorealistic rendering | https://en.wikipedia.org/wiki/Non-photorealistic_rendering
- Ink wash painting | https://en.wikipedia.org/wiki/Ink_wash_painting
