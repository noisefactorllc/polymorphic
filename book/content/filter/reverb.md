The picture added to shrunken copies of itself, each copy smaller and fainter
than the last.

The first copy repeats twice across the frame at half strength, the next four
times at a quarter, and so on for up to eight rounds. The total is divided back
down so the brightness stays where it started.

This is exactly the recipe that builds fractal noise, applied to a picture
instead of to a noise function. Which is why the output looks like the input
grew its own fine detail: the same shapes are showing up at every scale at once,
which is what makes real clouds and mountains look the way they do.

The `ridges` option flips each copy back on itself at its midpoint before adding
it, turning smooth gradients into sharp creases and giving the whole stack a
much harder, more metallic look.

Further reading:
- Fractional Brownian motion | https://en.wikipedia.org/wiki/Fractional_Brownian_motion
- Inigo Quilez, fBm | https://iquilezles.org/articles/fbm/
