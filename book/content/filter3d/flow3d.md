Particles wandering through a volume, leaving trails behind them in three
dimensions. It is the same idea as `flow()` in the points chapter, but it reads a
volume and writes a volume rather than producing a picture, which is why it
lives here.

Each particle reads the volume around it, turns that into a heading in three
dimensions, steps, and deposits into the volume as it goes.

Because the trails accumulate in the volume rather than on a flat canvas, the
result has genuine depth. The raymarcher that follows can look into the tangle
from any angle, and strands that appear to cross on screen are actually at
different distances from you, passing one in front of the other. Draw the same
thing flat and the crossings are just overlaps, with no way to tell what is in
front.

Further reading:
- Vector field | https://en.wikipedia.org/wiki/Vector_field
- Volume rendering | https://en.wikipedia.org/wiki/Volume_rendering
