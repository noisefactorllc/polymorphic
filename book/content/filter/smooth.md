Softens jagged edges without blurring the picture. Three different methods,
under one control.

`msaa` takes several samples from slightly different positions within each pixel
and averages them, which is what a renderer does natively when you turn on
antialiasing. The sample positions sit on a rotated grid, because an
axis-aligned one gives poor coverage on the near-horizontal and near-vertical
edges that alias worst.

`smaa` works from the picture rather than from extra samples. It finds the
edges, follows each one along to work out how long and how steep it is, and
blends across it by an amount that depends on how badly it is stepping. Short,
sharply angled runs get the most correction.

`blur` is the bluntest: an ordinary blur, but applied only where an edge was
found, so flat areas stay untouched. `strength` mixes any of them back against
the original.

Further reading:
- Spatial anti-aliasing | https://en.wikipedia.org/wiki/Spatial_anti-aliasing
- Bilateral filter | https://en.wikipedia.org/wiki/Bilateral_filter
