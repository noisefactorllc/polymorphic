The glossy sheen of cling film stretched over something, catching the light in
narrow bright streaks that follow the shapes underneath.

Like `relief()` and `chrome()` it treats brightness as height and lights the result,
but its highlights are narrow and bright rather than broad, which is the
difference between plastic and stone.

`detail` runs the opposite way to what you might expect. Higher settings mean a
*smaller* blur before the height is read, which leaves finer contours in the
surface and therefore more numerous, thinner streaks of sheen. Lower settings
smooth the surface out and give a few broad highlights instead.

The result is composited over the original picture, so the colours show through
the film rather than being replaced by it.

Further reading:
- Specular highlight | https://en.wikipedia.org/wiki/Specular_highlight
- Bump mapping | https://en.wikipedia.org/wiki/Bump_mapping
