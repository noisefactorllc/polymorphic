Smears the picture into streaming filaments, as though it were being drawn into
something.

It works in an unusual way for this book. Most effects have each pixel decide
what it should show. This one has each pixel decide where it should *go*. Every
pixel in the source reads its own brightness, turns that number into a direction,
flies off that way, and deposits its colour where it lands. The picture is
scattered rather than sampled.

Because brightness picks the direction, everything of a similar tone flies the
same way, and the image separates into strands sorted by lightness.

`kink` multiplies brightness before it becomes an angle, so raising it makes
similar tones fly to wildly different places and the strands tighten into curls.
`stride` sets how far they travel. Since pixels can pile up where they land, a
final pass measures the average brightness of the whole result and rescales it,
which is what keeps the image from flickering as the pile-ups shift.

Further reading:
- Vector field | https://en.wikipedia.org/wiki/Vector_field
- Line integral convolution | https://en.wikipedia.org/wiki/Line_integral_convolution
