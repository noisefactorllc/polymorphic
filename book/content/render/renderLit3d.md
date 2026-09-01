`render3d()` with the lighting opened up. The same two methods find the surface;
what changes is what happens once a ray has hit something.

The base renderer applies a fixed, serviceable shading. This one puts the light
direction, its colour, the ambient level, the shininess and the falloff all in
your hands.

That matters more for a volume than for anything else, because a surface pulled
out of a volume has no texture of its own. There is no paint on it and no
pattern. Every single thing you can see about its shape is carried by how it
responds to light, so the lighting is not a finishing touch, it is the whole
image.

Which way the surface faces is worked out from how the volume changes around the
hit point rather than being stored anywhere, which is why it stays smooth even
when the volume itself is coarse.

Further reading:
- Phong reflection model | https://en.wikipedia.org/wiki/Phong_reflection_model
- Normal (geometry) | https://en.wikipedia.org/wiki/Normal_(geometry)
