Turns a three-dimensional volume into a flat picture. This is the last stage of
every program in the two 3D chapters.

A ray is fired into the volume for each pixel on the screen and walked forward
until it hits something. There are two modes, and they are genuinely different
methods with different strengths.

Isosurface mode steps along the ray at regular intervals, watching for the point
where the volume crosses from empty to solid. Having found the step where it
happened, it then narrows down on the exact crossing by repeatedly halving the
interval, which pins the surface to well under the size of one cell. That is
what gets a smooth surface out of a coarse volume.

Voxel mode instead walks cell by cell in the exact order a straight line crosses
a grid, and shades whichever face it came in through. Blocky, and it never
misses a thin wall.

Further reading:
- Volume ray casting | https://en.wikipedia.org/wiki/Volume_ray_casting
- Isosurface | https://en.wikipedia.org/wiki/Isosurface
- Digital differential analyzer | https://en.wikipedia.org/wiki/Digital_differential_analyzer_(graphics_algorithm)
