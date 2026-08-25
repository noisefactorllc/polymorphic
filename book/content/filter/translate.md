Moves the picture. `x` and `y` are the offsets.

There is a small inversion inside worth knowing about, because it explains a lot
of this chapter. To make a picture appear to move right, the effect reads from
further left. Every pixel asks "what should I be showing?" rather than "where
should I go?", so shifting the picture one way means shifting where you look the
other way. Once you have seen that, the sign conventions in every transform here
make sense.

`wrap` decides what fills the gap the picture leaves behind. `repeat` tiles it,
so the opposite edge slides in. `clamp` holds the last row of pixels and smears
it across the gap. `mirror` reflects the picture back on itself, and it is the
only one of the three with no visible join, which makes it the safe choice if
anything downstream is going to blur or distort the result.

Further reading:
- Translation (geometry) | https://en.wikipedia.org/wiki/Translation_(geometry)
- Texture mapping | https://en.wikipedia.org/wiki/Texture_mapping
