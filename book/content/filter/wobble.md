Shakes the whole frame around, like a camera nobody is holding still.

Nothing inside the picture is distorted. Every pixel moves by exactly the same
amount, so the image stays intact and simply drifts, which is what separates a
camera shake from a warp.

The amount it moves comes from noise rather than a regular oscillation, so the
motion is unpredictable instead of a mechanical wobble. Two independent noise
sources supply the horizontal and vertical drift, which stops the movement being
diagonal.

The path through the noise is a closed circle, so however long you leave it
running the shake returns exactly to where it started and the loop is seamless.
`range` sets how far it travels and `speed` how fast, and both feed into the
noise, so raising the speed changes the path as well as the pace rather than
just replaying the same wobble faster.

Further reading:
- Camera stabilizer | https://en.wikipedia.org/wiki/Camera_stabilizer
- Perlin noise | https://en.wikipedia.org/wiki/Perlin_noise
