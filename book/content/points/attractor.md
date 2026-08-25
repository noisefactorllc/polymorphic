Thousands of particles caught in a strange attractor, tracing out the famous
butterfly shape as they go.

Three effects make the program. `pointsEmit` creates the particles,
`attractor` moves each one according to the attractor's equations, and
`pointsRender` draws the trails they leave. It is a genuinely
three-dimensional system, so it is worth watching with
`pointsRender(viewMode: ortho)`.

The behaviour comes entirely from the equations. There is no rule anywhere
telling the particles to form a shape. An attractor of this kind has no stable
orbit and never repeats itself, yet no trajectory ever escapes a bounded region
either. So a particle released anywhere gets drawn onto the same surface and
then wanders it forever without retracing its steps. Chaotic and confined at the
same time, which is exactly what made these things famous.

Particles start out in a small range and are scattered out to fit the
attractor's much larger space on the first frame.

Further reading:
- Lorenz system | https://en.wikipedia.org/wiki/Lorenz_system
- Attractor | https://en.wikipedia.org/wiki/Attractor
- Chaos theory | https://en.wikipedia.org/wiki/Chaos_theory
