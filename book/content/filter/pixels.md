Pixelates the picture into blocks, the classic way to obscure a face or fake a
low-resolution display. `size` sets how big the blocks are.

The method is a small piece of sleight of hand. Nothing is averaged and nothing
is drawn. Each pixel simply rounds its own position down to the nearest block
corner and reads the colour from there instead of from where it actually sits.
Every pixel in a block rounds to the same place, reads the same colour, and the
block appears. It costs no more than a normal copy.

Further reading:
- Pixelization | https://en.wikipedia.org/wiki/Pixelization
- Downsampling | https://en.wikipedia.org/wiki/Downsampling_(signal_processing)
