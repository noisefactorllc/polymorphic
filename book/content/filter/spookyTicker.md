Rows of digits scrolling along the bottom of the frame, drifting at different
speeds.

The digits are the blocky bank-cheque typeface, stored as a handful of bytes
each. A pixel looks up the right row of the right character and tests a single
bit to find out whether it is inside a stroke or outside it.

Nothing about the ticker is stored. Which digit shows up in a given slot is
worked out by scrambling the slot's position number and taking the remainder,
which means an endlessly long row of digits exists without anything holding it
in memory. Scroll back far enough and you find the same digits again, because
the same slot number gives the same answer. Each row scrambles its own speed
too, so they slide out of step with one another.

The glyphs can only brighten what is behind them, and a second lookup slightly
offset draws a shadow that only darkens.

Further reading:
- MICR | https://en.wikipedia.org/wiki/MICR
- Computer font | https://en.wikipedia.org/wiki/Computer_font
