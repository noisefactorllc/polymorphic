An ordinary blur, done the standard way: each pixel becomes an average of the
pixels around it, weighted so that close neighbours count for more than distant
ones. That weighting is the bell curve, which is why it is called a Gaussian
blur, and it is what makes the result smooth rather than smeared.

`radiusX` and `radiusY` set how far the averaging reaches. They are separate, so
setting one much higher than the other gives a directional smear instead of a
round blur.

Underneath, the work is done in two passes: first blur every row, then blur every
column of that result. The trick is that this gives exactly the same answer as
blurring in both directions at once, for a small fraction of the effort. A blur
reaching twenty pixels each way means looking at over 1,600 pixels the direct
way, or 82 in two passes. That is the difference between a blur you can use live
and one you cannot.

Further reading:
- Gaussian blur | https://en.wikipedia.org/wiki/Gaussian_blur
- Kernel (image processing) | https://en.wikipedia.org/wiki/Kernel_(image_processing)
