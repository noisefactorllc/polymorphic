Turns a volume into a picture of a landscape. Where `render3d()` orbits a block of
material, this one holds a view made for terrain: by default the fixed diagonal of
an isometric map, with every ray parallel, so nothing shrinks with distance.

A ray leaves each pixel and walks the grid cell by cell until it reaches a solid
one. The colour stored there is lit according to the face the ray came in through.
A block only ever shows three faces from this angle, and each catches the light
differently, which is what gives the terrain its carved look.

`viewMode` swaps the fixed view for a movable camera. Its rotation, position and
`fieldOfView` work as they do in `pointsBillboardRender()`, down to the same world
units, so a landscape and a particle system can share one camera.

`filtering` decides what kind of surface you get. `voxel` keeps the blocks.
`isosurface` blends between neighbouring cells, narrows in on where the surface
is crossed, and shades it smoothly, which melts the staircase into rolling ground.
The two are compiled as separate shaders, so neither pays for the other.

`lightDirection` sets where the light comes from, and `ambient`,
`diffuseIntensity` and `specularIntensity` balance it. Where a ray misses
everything, `bgColor` shows through.

Further reading:
- Isometric video game graphics | https://en.wikipedia.org/wiki/Isometric_video_game_graphics
- Voxel Space | https://en.wikipedia.org/wiki/Voxel_Space
