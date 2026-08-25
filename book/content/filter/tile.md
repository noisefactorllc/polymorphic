Kaleidoscopic tiling: the frame is divided into a repeating grid, and each cell
folds the picture so that neighbouring cells always match at their edges.

`symmetry` picks how the folding works. Mirror reflects each axis, so every cell
is a mirror image of the ones beside it and no join can ever show. The two
rotational settings fold around each cell's centre instead, giving two-fold or
four-fold rotational symmetry, which produces a more pinwheel-like figure.

The hex setting is the one that stands out. Hexagonal grids are awkward to work
with, so instead of doing hexagon arithmetic the effect lays down two ordinary
square grids offset from each other and lets each pixel take whichever centre is
nearer. That produces a genuine hexagonal lattice almost for free. `repeat` sets
how many cells, `scale` how much of the source each one shows.

Further reading:
- Kaleidoscope | https://en.wikipedia.org/wiki/Kaleidoscope
- Wallpaper group | https://en.wikipedia.org/wiki/Wallpaper_group
