The coloured fringing you see at the edges of a photograph taken with a cheap
lens. Glass bends different wavelengths by slightly different amounts, so red,
green and blue never quite land in the same place.

The effect reproduces that by pulling the red channel one way and the blue the
other, leaving green where it is. Crucially the amount grows with distance from
the centre of the frame, which is how real lenses fail: dead centre everything
lines up, and the further off axis you go the worse the separation gets.

What makes this more than a channel shift is what happens next. Instead of
returning the shifted channels directly, the effect subtracts the unshifted
image to leave only the difference, which is the coloured fringing on its own,
and then adds the original back scaled by `passthru`. That lets you push the
fringing hard while keeping the underlying picture at whatever strength you like.

Further reading:
- Chromatic aberration | https://en.wikipedia.org/wiki/Chromatic_aberration
- Dispersion (optics) | https://en.wikipedia.org/wiki/Dispersion_(optics)
