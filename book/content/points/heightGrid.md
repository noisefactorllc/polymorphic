A landscape made of particles. This behaviour simulates nothing at all: it takes
every particle `pointsEmit()` allocated, lays them out in a square grid on the
ground, and raises each one by the brightness of a picture.

Two pictures do the work, and keeping them apart is the point. `heightTex` sets
the shape and `diffuseTex` paints it, each read at the particle's own place in
the grid, so one image can carve the hills while a different one colours them.
Leave either unset and it reads the picture coming down the pipeline.

Both are read again on every frame, so the ground moves whenever they do.
Position is decided here, afresh, each time, which is why the emitter's layout
and attrition make no difference to the result.

`gridScale` sets how wide the sheet is and `heightScale` how high white stands,
with negative values turning the relief inside out. `heightOffset` lifts or
lowers the whole thing.

The grid lies flat rather than facing you, so it needs a camera to read as land.
The demonstration uses `pointsBillboardRender(viewMode: perspective)`. The top of
each picture lies along the far edge, so a view from straight above shows them
the way they were drawn.

Further reading:
- Digital elevation model | https://en.wikipedia.org/wiki/Digital_elevation_model
- Point cloud | https://en.wikipedia.org/wiki/Point_cloud
