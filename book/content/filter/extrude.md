The picture chopped into a grid of blocks, each one pushed up out of the page
toward you by an amount taken from its own brightness. Bright cells stand tall,
dark ones stay flat.

Nothing here is a real 3D scene. A block is raised by simply scaling its
footprint outward from the centre of the image, which is precisely what
perspective does to a square lifted off a table: the closer it comes, the bigger
it looks and the further from centre it sits.

Working out which block you can see at any given point is the harder problem,
since a tall block in front hides shorter ones behind it. Each point walks back
toward the centre of the image, checking the handful of cells it could possibly
belong to, and keeps the tallest one it hits. A block's top face always beats a
block's side, so the stack sorts itself out without any depth buffer.

Further reading:
- Heightmap | https://en.wikipedia.org/wiki/Heightmap
- 3D projection | https://en.wikipedia.org/wiki/3D_projection
