A round window: one picture in the middle, the other around the edges.

Distance from the centre of the frame decides which you see, and raising that
distance to a power reshapes the falloff. A low power spreads the centre picture
across most of the frame; a high one keeps it small until close to the border.

`hardness` decides whether it is a window or a fade. At zero, the transition is
a gradient stretched across the entire frame. Near one, it becomes a crisp
boundary.

How distance is measured changes the shape entirely. Measure it the ordinary way
and you get a circle. Measure it by whichever direction is furthest and you get
a rectangle; add the two directions together and you get a diamond.

The two pictures are blended together first, and the mask then chooses between
the centre picture and that blend.

Further reading:
- Vignetting | https://en.wikipedia.org/wiki/Vignetting
- Metric space | https://en.wikipedia.org/wiki/Metric_space
