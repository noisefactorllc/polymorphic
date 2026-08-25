Every pixel fetches its colour from a random spot nearby instead of from where
it actually sits. On its own that is frosted glass.

Five modes vary either where it looks or how the result is combined. Darken and
lighten only ever let the result go one way, so the picture picks up either
grime or sparkle but never both. Clumped makes neighbouring pixels agree on
where to look, which turns fine grain into flakes.

Anisotropic is the one worth knowing. It works out which way the edges run at
each point, then constrains the random offset to run along the edge rather than
across it. Because it never reaches over an edge for its colour, detail that
plain scatter would smash to mush survives intact. The picture gets smeared in
the direction of its own contours, like a long exposure of something flowing,
and stays legible while it happens.

Further reading:
- Frosted glass | https://en.wikipedia.org/wiki/Frosted_glass
- Anisotropic diffusion | https://en.wikipedia.org/wiki/Anisotropic_diffusion
