The tail of every particle program: it turns particle positions into pixels.

One dot is drawn per particle, placed by looking up that particle's position,
and its colour is added into a picture that persists between frames.

The trails come entirely from that persistence. No particle remembers where it
has been. Each frame simply adds today's dots to what is already on the canvas,
and the whole canvas fades a little. A fast particle covers a lot of ground and
leaves a long thin streak; a slow one keeps depositing in nearly the same place
and leaves a dense blob. All of that shape information is emergent, with no
history stored anywhere.

`density` thins the population using a spacing based on the golden ratio, which
removes particles evenly across the whole set rather than in blocks. The ortho
view mode rotates and projects all three coordinates, which is how the same
renderer handles the 3D behaviours.

Further reading:
- Particle system | https://en.wikipedia.org/wiki/Particle_system
- Golden ratio | https://en.wikipedia.org/wiki/Golden_ratio
