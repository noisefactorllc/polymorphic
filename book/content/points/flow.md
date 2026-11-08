Particles steered by the picture, leaving brushstrokes that follow whatever is
in it.

Each particle reads the brightness underneath it, turns that number into a
compass heading, steps forward, and draws its trail. The picture is never drawn
directly. It is used purely as a map of which way to go.

Reading brightness as a direction is what makes the strokes describe the
subject. An area of similar tone produces similar headings, so every particle
crossing it travels roughly parallel to the others, and the trails end up
tracing out the shape of that area. Where the tone changes, the strokes turn.
The result reads as deliberate brushwork rather than as scribble, and none of it
was directed.

Each particle carries a small personal offset so that two in the same tone do
not lie exactly on top of one another.

The picture doing the steering is the one coming down the pipeline unless
`heightTex` names another. `diffuseTex` colours each particle from the surface
beneath it, so one image can direct the strokes while a second paints them.

Further reading:
- Vector field | https://en.wikipedia.org/wiki/Vector_field
- Line integral convolution | https://en.wikipedia.org/wiki/Line_integral_convolution
