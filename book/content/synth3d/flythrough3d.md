A camera flying through a fractal. Instead of filling a fixed volume once and
looking at it, the grid is rebuilt every frame around wherever the camera
currently is, so you are always sampling the part of infinite fractal space you
happen to be in.

Three things make that work. The camera follows a smooth curve that passes
exactly through its waypoints and has no corners at the joins.

Then there is the collision problem, and it is a real one: a Mandelbulb has no
corridors, and a straight line through one hits a wall almost immediately.

The solution is that the fractal already tells you how far the nearest surface
is, because the renderer needs that number to march its rays. The camera reads
the same number, sees how close it has come, and steers away along the direction
in which that distance grows fastest.

Further reading:
- Mandelbulb | https://en.wikipedia.org/wiki/Mandelbulb
- Ray marching | https://en.wikipedia.org/wiki/Ray_marching
- Centripetal Catmull-Rom spline | https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline
