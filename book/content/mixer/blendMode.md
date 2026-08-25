The nineteen blend modes from an image editor's layer panel, applied between the
pipeline picture and a second one. Multiply, screen, overlay, difference and the
rest, all behaving the way they do everywhere else.

The part worth knowing is how transparency is handled. After the two colours are
blended, the result is faded back against the base according to how solid the
top picture is at that point. So a fully transparent pixel on top leaves the
base completely untouched, no matter what the blend mode would otherwise have
done to it. That is the standard rule for stacking layers, and it is what stops
a transparent region from mysteriously darkening or brightening what is under
it.

Further reading:
- Blend modes | https://en.wikipedia.org/wiki/Blend_modes
- Alpha compositing | https://en.wikipedia.org/wiki/Alpha_compositing
