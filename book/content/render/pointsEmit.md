The head of every particle program. It creates the particles and gives each one
a starting position, a velocity, and a colour taken from the incoming picture.

All of that is held in textures, one pixel per particle. A 256 by 256 state
holds 65,536 particles; a 2048 by 2048 one holds over four million.

Keeping the state in pictures is what lets the whole simulation run as ordinary
image passes. Each frame reads last frame's state as a picture and writes this
frame's out as another one, with one pixel doing the work for one particle. No
special machinery, just the same texture-in texture-out arrangement everything
else here uses.

Six starting layouts are available. Attrition gives every particle a small
chance of being reborn each frame, and because the timing is drawn from a
continuous clock rather than a frame count, the respawns spread out evenly
instead of arriving in visible waves.

Further reading:
- Particle system | https://en.wikipedia.org/wiki/Particle_system
- GPGPU | https://en.wikipedia.org/wiki/General-purpose_computing_on_graphics_processing_units
