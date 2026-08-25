Zooms the picture in or out. Above 1 magnifies, below 1 shrinks and reveals
whatever the wrap mode puts around it.

`scaleX` and `scaleY` are separate, so you can stretch in one direction only.
`centerX` and `centerY` set the fixed point: that spot stays exactly where it is
while everything else moves toward or away from it, which is what lets you zoom
in on a particular part of the picture rather than always on the middle.

The order the effect does things in is what makes the fixed point work. It
shifts the coordinates so your chosen centre sits at the origin, squares them up
so the zoom does not shear on a widescreen canvas, scales, then undoes both.
Doing the shift outside the scaling is precisely what pins that one point in
place.

Further reading:
- Image scaling | https://en.wikipedia.org/wiki/Image_scaling
- Bilinear interpolation | https://en.wikipedia.org/wiki/Bilinear_interpolation
