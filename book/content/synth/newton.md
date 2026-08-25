Another fractal, and one with a satisfying story behind it. Newton's method is
the standard way to hunt down where an equation equals zero: guess, see how far
off you are, adjust, repeat. It usually works.

Here every pixel on the screen is used as a starting guess for the same
equation, which has several answers. Run the method and each guess eventually
homes in on one of them. Colour each pixel by which answer it found, and the
screen divides into territories. The startling part is the borders: however far
you zoom in, two neighbouring pixels can end up at different answers, so the
boundaries never resolve into a clean line. They are fractal all the way down.

`degree` sets how many answers there are and so how many territories. The one to
experiment with is `relaxation`: instead of taking the full correction each step
it takes a fraction or an excess of it, which makes the method overshoot and
spiral, twisting the territories into pinwheels.

Further reading:
- Newton fractal | https://en.wikipedia.org/wiki/Newton_fractal
- Newton's method | https://en.wikipedia.org/wiki/Newton%27s_method
