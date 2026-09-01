A tangle of coloured threads laid over the picture, like the fibres in
banknote paper or a sheet of handmade card.

They are drawn by agents rather than by a formula. A field of gentle randomness
is generated first, then several hundred agents are dropped onto it at random
positions. Each one reads the value underneath itself, turns that into a
direction, takes a short step, and draws a line as it goes. Because neighbouring
agents read similar values, their paths sweep along together in currents.

The turn rate is what separates a fibre from a drift. The field value is
multiplied before it becomes a heading, so small changes in the field swing an
agent through many turns in a short distance and the threads curl rather than
running straight. That multiplier is fixed here rather than exposed. Each strand
also fades in and back out along its length, so the ends taper rather than
stopping dead. `density` sets how many threads there are, `alpha` how strongly
they sit over the picture, and `seed` picks a different tangle.

Further reading:
- Security paper | https://en.wikipedia.org/wiki/Security_paper
- Perlin noise | https://en.wikipedia.org/wiki/Perlin_noise
