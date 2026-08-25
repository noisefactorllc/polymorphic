Bends the picture into ripples, like a reflection in disturbed water or a badly
tracking video tape.

It is one line of arithmetic. Each pixel looks at its horizontal position, feeds
that to a sine wave, and shifts where it reads from vertically by the result.
Move across the picture and the shift rises and falls, so straight lines come out
wavy.

`scale` sets how many ripples fit across the frame and `strength` how far they
bend. `speed` sends them travelling, in whole cycles so the motion loops
seamlessly.

`rotation` is the useful one and it works in an indirect way: the coordinates
are turned before the ripple is applied and turned back afterwards, so the wave
runs at whatever angle you like while the picture itself stays upright. `wrap`
decides what fills the strip at the top and bottom that the bending pushes out
of frame.

Further reading:
- Sine wave | https://en.wikipedia.org/wiki/Sine_wave
- Image warping | https://en.wikipedia.org/wiki/Image_warping
