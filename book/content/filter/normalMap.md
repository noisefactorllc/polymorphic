Turns a picture into a normal map: the blue-lilac image used in 3D work to
describe which way a surface is facing at every point, so flat geometry can be
lit as though it had bumps.

It reads brightness as height. Bright means high, dark means low. Then it
measures the slope at each pixel in both directions and writes those two numbers
into the red and green channels, with blue carrying what is left.

Two details are worth knowing. Height is measured using a perceptual brightness
rather than a simple channel average, so the surface follows how bright things
look rather than what their numbers say, which matters on saturated colours. And
the edges wrap, so a tiling source produces a tiling normal map, which is what
you want if the texture is going to repeat.

Further reading:
- Normal mapping | https://en.wikipedia.org/wiki/Normal_mapping
- Bump mapping | https://en.wikipedia.org/wiki/Bump_mapping
