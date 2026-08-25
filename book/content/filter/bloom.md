The glow that spills out of bright things: the halo around a street lamp at
night, or the way a highlight smears when a camera looks at something too bright
for it.

It happens in three steps. First the effect finds the bright parts of the
picture and throws everything else away. `threshold` sets how bright a pixel has
to be to count, and `softKnee` softens that cutoff so areas near the line fade
in instead of snapping on.

Then it blurs what survived, spreading each highlight into a halo as wide as
`radius`. That blur reads the picture at up to 64 points arranged in a spiral,
which spaces them evenly enough that the glow comes out smooth rather than
showing its own sampling pattern.

Last, the halo is added back on top of the original picture. Adding, rather than
replacing, is why bloom only ever brightens a picture and never darkens it, and
why `intensity` above 1 blows the highlights out.

Further reading:
- Bloom (shader effect) | https://en.wikipedia.org/wiki/Bloom_(shader_effect)
- Gaussian blur | https://en.wikipedia.org/wiki/Gaussian_blur
