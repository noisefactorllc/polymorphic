Grow or shrink the bright parts of a picture. Dilate takes the brightest pixel
in a neighbourhood, so light regions swell into dark ones. Erode takes the
darkest and does the reverse.

On a mask these thicken or thin it, which is the everyday use: closing small
gaps, or nibbling a selection back from its edge. On a photograph they give the
waxy, melted look of the classic minimum and maximum filters.

`shape` is worth knowing about because it changes the cost as much as the
result. A square neighbourhood can be done in two cheap passes, one across and
one down, because the brightest pixel in a square is the brightest of each row's
brightest. A disc has no such shortcut and has to be checked in full, which is
hundreds of samples per pixel. Round looks better on curves; square is much
faster.

Further reading:
- Mathematical morphology | https://en.wikipedia.org/wiki/Mathematical_morphology
- Dilation (morphology) | https://en.wikipedia.org/wiki/Dilation_(morphology)
- Erosion (morphology) | https://en.wikipedia.org/wiki/Erosion_(morphology)
