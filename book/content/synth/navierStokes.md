An actual fluid simulation. Not noise that resembles smoke, but a solver that
tracks a velocity for every point on the screen and moves it the way real fluid
moves.

Six things happen each frame. The input image pushes the fluid. The fluid then
carries itself along, which is done by asking each point where its contents must
have come from a moment ago and fetching from there, a trick that stays stable
however large the timestep. Then the interesting part: the solver measures where
fluid is piling up or draining away, works out the pressure that would cancel
that out, and subtracts it. Fluid cannot compress, and that step is what enforces
it. Without it you get smoke; with it you get water.

Finding that pressure has no direct answer, so the solver guesses and improves
its guess repeatedly. That is what `iterations` controls, and it is a quality
setting rather than a look: too few and the fluid goes spongy, more costs frames.

Further reading:
- Navier-Stokes equations | https://en.wikipedia.org/wiki/Navier%E2%80%93Stokes_equations
- Jos Stam, Stable Fluids | https://www.dgp.toronto.edu/public_user/stam/reality/Research/pdf/ns.pdf
- GPU Gems 38, Fast Fluid Dynamics | https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu
