The Mandelbrot set, the most famous picture in mathematics, and the twin of
`julia`.

Both run the same short sum over and over. The difference is which part of it
the pixel supplies. In `julia` the pixel is the starting value and the constant
is fixed, so you get one shape. Here the pixel is the constant and every point
starts from zero, so a single image contains every Julia shape at once. That is
not a coincidence or a pretty analogy: the black region is precisely the set of
constants whose Julia set holds together in one piece, and the fringe around it
is where they fall apart.

The output modes are five things you can say about how a pixel behaved rather
than five fractals: how long it took to escape, how close it sits to the edge,
how near it passed to a chosen shape on the way, or a shaded version that reads
like relief. It all runs at extra precision so deep zooms stay sharp instead of
dissolving into blocks.

Further reading:
- Mandelbrot set | https://en.wikipedia.org/wiki/Mandelbrot_set
- Plotting algorithms for the Mandelbrot set | https://en.wikipedia.org/wiki/Plotting_algorithms_for_the_Mandelbrot_set
