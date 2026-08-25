Rotational blur, like a photograph of a spinning record or a wheel in motion.

Instead of sampling along a straight line, each pixel samples along an arc
centred on `centerX` and `centerY`, taking 32 steps across a total sweep of
`amount` degrees and averaging them. Pixels close to the centre travel almost no
distance around their arc so they stay sharp; pixels near the edge sweep a long
way and smear.

The arcs have to be measured in a squared-up coordinate space, or they come out
as ellipses on a widescreen canvas and the blur no longer follows a circle.

As with the other blurs here, the set of samples is jittered slightly per pixel
so the fixed sample count reads as fine grain rather than as visible repeated
copies of the picture.

Further reading:
- Motion blur | https://en.wikipedia.org/wiki/Motion_blur
- Polar coordinate system | https://en.wikipedia.org/wiki/Polar_coordinate_system
