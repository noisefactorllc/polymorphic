Perlin noise, the other great classic alongside `noise`. Same soft cloudy
character, built a different way, and the difference is visible once you know to
look for it.

`noise` puts a random value at each grid point and blends between them. Perlin
puts a random *direction* at each grid point instead, and asks each pixel how
much it is leaning along its neighbours' directions. The consequence is that the
value is always exactly zero at the grid points themselves, so the pattern never
develops the faint square lumpiness that value noise can show. What you get is
smoother and more organic.

`scale` sets the size of the features and `octaves` stacks finer copies on top
for detail. The warp controls are the interesting ones: they push the
coordinates around using more noise before the pattern is read, so instead of
smooth blobs you get something stretched and marbled, like stirred paint.
Raising `warpIterations` folds the result again for each pass.

Further reading:
- Perlin noise | https://en.wikipedia.org/wiki/Perlin_noise
- Ken Perlin, Improving Noise | https://mrl.cs.nyu.edu/~perlin/paper445.pdf
