The same six-faced camera as `renderCubemap3d()`, but showing the volume's own
colour rather than a lit surface. No lighting, no gamma, no surface threshold.

Instead of stopping at a surface, each ray travels all the way through and adds
up what it passes. At every step the volume both blocks a little light and gives
off a little colour of its own, and what it gives off is dimmed by everything
already in front of it.

This is how you render smoke, cloud, dye in water, or a nebula: things with no
surface anywhere, that you see into rather than at. Trying to find a surface in
a cloud gives you a lumpy solid, which is not what a cloud is.

Density and absorption both control how quickly the volume blocks light, and
emission controls how much it gives off, so a thin bright volume and a thick dim
one are separately reachable.

Further reading:
- Volume rendering | https://en.wikipedia.org/wiki/Volume_rendering
- Radiative transfer | https://en.wikipedia.org/wiki/Radiative_transfer
