The Mandelbulb and Mandelcube, three-dimensional relatives of the Mandelbrot
set.

There is a wrinkle. The Mandelbrot set is built on multiplying complex numbers,
and there is no three-dimensional equivalent of that operation. Nobody found
one, because none exists.

So the Mandelbulb invents a substitute by analogy. Squaring a complex number
doubles the angle it points at and squares its length. In three dimensions a
point has two angles instead of one, so the rule becomes: multiply both angles,
raise the length to the power, and convert back. It is not algebra any more, it
is a shape defined by imitating what algebra used to do, which is why the
Mandelbulb was found by experiment in 2009 rather than derived.

The shader keeps an estimate of how far the surface is, which is what lets the
renderer take long strides through empty space and slow down near the surface.

Further reading:
- Mandelbulb | https://en.wikipedia.org/wiki/Mandelbulb
- Mandelbox | https://en.wikipedia.org/wiki/Mandelbox
- Inigo Quilez, Distance functions | https://iquilezles.org/articles/distfunctions/
