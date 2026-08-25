Makes a picture tile without a visible join, so you can repeat it as a texture.

The problem is that a picture's left edge and its right edge know nothing about
each other, so butting them together shows a hard seam. The fix is to blend each
edge into the content from the opposite side.

The effect samples the picture four times: at the coordinate itself, and at the
same coordinate shifted half a tile across, down, and both. Shifting by half a
tile puts what used to be the middle of the picture exactly where the seam was.
A weight that rises from nothing at the centre of the tile to full at its edges
then blends the four together, so the middle shows the original and the edges
show the wrapped copy. Both sides of any seam end up computing the same blend,
so the join disappears.

`blend` sets how wide that transition is.

Further reading:
- Texture mapping | https://en.wikipedia.org/wiki/Texture_mapping
- Tessellation | https://en.wikipedia.org/wiki/Tessellation
