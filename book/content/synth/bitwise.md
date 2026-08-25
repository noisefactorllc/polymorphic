Patterns made purely from arithmetic on the coordinates of each pixel, with no
randomness anywhere. Every pixel takes its own x and y position as whole numbers,
does one sum with them, and uses the answer as its brightness.

The famous one is XOR, which is what the default gives you. XOR compares two
numbers bit by bit, and because bits are powers of two the pattern repeats itself
at every scale: squares inside squares inside squares, forever, out of a single
operation. The other seven are the same idea with a different sum. AND leans
diagonally, OR fills in densely with triangular gaps, and multiplication draws
the curved sweeps of a times table.

`mask` changes the look most. It decides how many of the answer's bits you keep,
and so how many brightness steps exist: keep them all for a finely graded
texture, keep one for stark black and white. `seed` mixes into the coordinates
rather than shifting them, so nudging it gives a completely different pattern
instead of the same one moved along.

Further reading:
- Bitwise operation | https://en.wikipedia.org/wiki/Bitwise_operation
- Bytebeat | https://en.wikipedia.org/wiki/Bytebeat
- Demoscene | https://en.wikipedia.org/wiki/Demoscene
