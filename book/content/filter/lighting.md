Lights the picture as though it were a physical surface with bumps in it.

First it works out which way the surface faces at each point, reading brightness
as height and measuring the slope. Then it lights that with the standard model
used across real-time 3D: a base level so nothing is pitch black, a diffuse term
that depends on the angle between the surface and the light, and a specular
highlight where the surface happens to face the light and viewer just right.

The specular term is what sells it, and its tightness is what tells you what the
material is: broad and soft reads as plastic or skin, small and hard reads as
polished metal.

`lightDirection` moves the light. The lit result is combined with the original
colours, so the picture supplies both the shape and the paint.

Further reading:
- Phong reflection model | https://en.wikipedia.org/wiki/Phong_reflection_model
- Specular highlight | https://en.wikipedia.org/wiki/Specular_highlight
- Bump mapping | https://en.wikipedia.org/wiki/Bump_mapping
