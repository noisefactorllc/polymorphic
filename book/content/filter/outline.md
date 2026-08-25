Draws dark lines along the edges in a picture and leaves the rest alone, the way
an illustrator would ink over a painting.

It runs in three steps: reduce the picture to brightness, find the edges in
that, then darken the original wherever an edge was found. `thickness` sets how
heavy the lines are and `invert` makes them white instead.

The first step is the one with a real decision in it. Turning colour into
brightness is normally done by weighting the channels, but that has an awkward
failure: a strong red and a strong green can weigh out to nearly the same number
even though the boundary between them is obvious to look at, so no line gets
drawn where you can plainly see one. This effect checks whether there is real
colour in play first, and if there is, measures brightness in a way built to
match human vision instead. Edges you can see get outlined.

Further reading:
- Edge detection | https://en.wikipedia.org/wiki/Edge_detection
- Non-photorealistic rendering | https://en.wikipedia.org/wiki/Non-photorealistic_rendering
