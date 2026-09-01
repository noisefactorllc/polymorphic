A flat field of one colour. It is the simplest thing in the book, and it does
exactly what it says: pick a colour, fill the screen.

It earns its place as a starting point. A lot of effects need something to work
on, and a plain colour is the clearest possible test of what they do to it. Run
an effect over `solid()` and whatever appears is entirely the effect's doing, with
no pattern underneath to confuse you.

The one detail worth knowing is `alpha`. It does not just make the colour
fainter on screen, it records how much of the pixel this colour actually covers.
That matters later, when you stack this on top of something else: the surface
carries its own coverage with it, so a blend or a mask further down the chain
knows how much of what is underneath should show through.

Further reading:
- RGB color model | https://en.wikipedia.org/wiki/RGB_color_model
- Alpha compositing | https://en.wikipedia.org/wiki/Alpha_compositing
