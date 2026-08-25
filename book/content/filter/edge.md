Finds the outlines in a picture: the places where brightness changes suddenly.

The basic test is to compare each pixel with the ones around it. Somewhere flat,
the pixel and its neighbours agree and the answer is zero. On an edge they
disagree, and the size of the disagreement is how strong the edge is. `kernel`
picks whether the comparison uses only the four pixels directly up, down, left
and right, or all eight including diagonals, and `size` moves them further out
so it responds to broader shapes rather than fine detail.

The contour setting works differently. Instead of looking for any change it
looks for one specific brightness level and marks only the pixels where the
picture crosses it, which draws a contour line through a chosen tone rather than
outlining everything. `blend` decides how the edges are combined back with the
original, and `mixAmt` how much of it you see.

Further reading:
- Edge detection | https://en.wikipedia.org/wiki/Edge_detection
- Sobel operator | https://en.wikipedia.org/wiki/Sobel_operator
