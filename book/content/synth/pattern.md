Twelve repeating patterns: checkerboard, dots, grid, stripes, hexagons, rings,
radial lines, spiral, triangles, hearts, waves, and zigzag.

They share one piece of setup, which is why the controls behave the same across
all of them. Before any pattern is drawn, the coordinates are centred, rotated
by `rotation`, leaned over by `skew`, and scaled. Each pattern then works in
that prepared space without knowing anything has happened to it, so rotating
stripes and rotating hexagons are the same operation.

The patterns themselves are mostly built from one idea: chop the plane into
repeating cells, then ask each pixel where it sits inside its own cell. Close to
the middle of the cell, or close to an edge, or on one side of a diagonal. That
question answers itself differently for each shape and gives you dots, grids, or
checks. Hexagons need a small trick, two square grids offset from each other
with each pixel taking whichever centre is nearer, which produces a hex lattice
without any hexagon maths at all.

Further reading:
- Tessellation | https://en.wikipedia.org/wiki/Tessellation
- Wallpaper group | https://en.wikipedia.org/wiki/Wallpaper_group
