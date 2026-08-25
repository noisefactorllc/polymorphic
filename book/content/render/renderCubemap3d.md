`render3d` run six times over, once for each face of a cube, with the camera
sitting in the middle of the volume looking outward. Together the six views
cover every direction at once.

The faces join without a seam, and not because anything blends them. Each face
covers exactly a quarter turn, and adjacent faces share the directions along
their common edge. A ray leaving the edge of one face is literally the same ray
entering the edge of the next, so the pictures line up exactly by construction
rather than by correction.

Lighting and gamma are inherited from `render3d`, so what you get is a lit
object floating in space, viewed from inside.

If you want the raw field with no lighting applied at all, use
`renderCubemapSurface` instead.

Further reading:
- Cube mapping | https://en.wikipedia.org/wiki/Cube_mapping
- Skybox (video games) | https://en.wikipedia.org/wiki/Skybox_(video_games)
