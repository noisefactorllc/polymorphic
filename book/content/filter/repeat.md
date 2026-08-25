Tiles the picture across the frame. `x` and `y` set how many copies fit in each
direction.

It works by multiplying the coordinates before reading. Multiply by four and the
picture gets traversed four times across the frame, so four copies appear. The
offsets shift where the tile boundaries fall.

`wrap` decides how each tile handles content that runs past its edge, and the
choice matters more here than elsewhere because you are looking at the joins
directly. `repeat` gives hard seams wherever the source's left edge meets its
right. `mirror` reflects alternate tiles so every join matches, which turns
almost any source into a seamless pattern and is usually what you want. If you
need a genuinely tileable source rather than a mirrored one, `seamless` does
that job instead.

Further reading:
- Tessellation | https://en.wikipedia.org/wiki/Tessellation
- Texture mapping | https://en.wikipedia.org/wiki/Texture_mapping
