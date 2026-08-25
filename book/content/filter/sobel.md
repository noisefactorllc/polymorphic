Another edge finder, and the one most people mean when they say edge detection.
Sobel dates from 1968 and is still the standard.

It uses two comparisons rather than one. The first measures how much the picture
changes going left to right, the second how much it changes going top to bottom.
Together they tell you not just that there is an edge but which way it runs.
Both weight the pixels directly beside the centre twice as heavily as the corner
ones, which smooths out noise as it measures, and that combination of smoothing
and measuring in one step is why Sobel held on while simpler methods did not.

The two measurements are then combined into a single strength, which multiplies
the original colour rather than replacing it, so the edges keep the hue of
whatever they were found in. `alpha` mixes the result back against the untouched
picture.

Further reading:
- Sobel operator | https://en.wikipedia.org/wiki/Sobel_operator
- Edge detection | https://en.wikipedia.org/wiki/Edge_detection
