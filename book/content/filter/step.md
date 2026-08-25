A hard cutoff, applied to each colour channel separately. Anything above
`threshold` in a channel goes to full, anything below goes to nothing.

Because the three channels are decided independently, a colour photograph
collapses to the eight corners of the colour cube: black, white, and the six
fully saturated primaries and secondaries. It is a blunter, more graphic result
than `threshold`, which reduces everything to grey first.

`antialias` is worth turning on. Without it the cut is exactly one pixel wide
and diagonal edges come out as visible stairs. With it, the effect asks how
quickly the picture is changing at each point and softens the cut by exactly that
much, so a shallow gradient gets a wide soft transition while an already-sharp
edge stays sharp. You get smooth boundaries without blurring anything that was
crisp to begin with.

Further reading:
- Thresholding (image processing) | https://en.wikipedia.org/wiki/Thresholding_(image_processing)
- Step function | https://en.wikipedia.org/wiki/Step_function
