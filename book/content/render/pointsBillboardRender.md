Draws each particle as a small shape with a real size rather than as a single
dot. Seven shapes are built in, including a circle, a ring, a star and a soft
glow, or you can supply a picture to use instead.

The extra machinery earns its keep because a single dot cannot be rotated, cannot
be scaled individually, and cannot have a soft edge. Those three things are
exactly what separates a particle system that reads as smoke or sparks from one
that reads as a scatter of pixels.

Each particle's size and rotation are worked out from its own index number, so
the population looks varied while staying perfectly reproducible: the same seed
gives the same arrangement every time, with nothing stored anywhere.

The demonstration draws a `polygon()` to a surface first and hands it in as the
sprite.

Further reading:
- Billboard (computer graphics) | https://en.wikipedia.org/wiki/Billboarding
- Particle system | https://en.wikipedia.org/wiki/Particle_system
