An edge finder with an unusual character, closer to an etching than an outline.

It measures how quickly the picture is changing in two directions: to the right,
and downward. On a flat area both are zero. On an edge one or both are large.

What it does with the two measurements is the interesting part. A conventional
edge detector would combine them into a single strength, treating a horizontal
edge and a vertical one as equally strong. This one measures how much the two
*disagree with each other*, which responds strongly to corners, texture and
diagonal detail while treating clean straight edges more quietly. The result is
less like an outline and more like a rubbing.

The answer multiplies the original colour rather than replacing it, so the edges
come through in whatever colour they were found in. `amount` sets how far apart
the compared pixels are, so it moves between fine texture and coarse structure.

Further reading:
- Image gradient | https://en.wikipedia.org/wiki/Image_gradient
- Edge detection | https://en.wikipedia.org/wiki/Edge_detection
