A Julia set: one of the classic fractal shapes, and a good place to get lost for
an hour.

The rule behind it is tiny. Take a pixel's position, feed it through the same
short sum over and over, and watch what happens. Some starting points settle
down and stay put no matter how long you run it. Others shoot off to infinity.
Colour each pixel by which fate it met, and how quickly, and the boundary
between the two turns out to be infinitely detailed: zoom in anywhere on it and
there is always more structure.

`cReal` and `cImag` set the constant in that sum, and changing them changes the
shape entirely, so the `poi` list of preset values is the quickest way to find
the famous ones. The output modes are five different things you can say about
each pixel's journey rather than five different fractals: how long it survived,
how close it came to the edge of the set, or how near it passed to a chosen
shape along the way.

Further reading:
- Julia set | https://en.wikipedia.org/wiki/Julia_set
- Mandelbrot set | https://en.wikipedia.org/wiki/Mandelbrot_set
