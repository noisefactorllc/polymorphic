A tangle of coloured threads laid over the picture, like the fibres in
banknote paper or a sheet of handmade card.

They are drawn by agents rather than by a formula. A field of gentle randomness
is generated first, then several hundred agents are dropped onto it at random
positions. Each one reads the value underneath itself, turns that into a
direction, takes a short step, and draws a line as it goes. Because neighbouring
agents read similar values, their paths sweep along together in currents.

`kink` is what separates a fibre from a drift. It multiplies the field value
before it becomes a heading, so a high setting means small changes in the field
swing the agent through many turns in a short distance, and the threads curl
instead of running straight. Each strand also fades in and back out along its
length, so the ends taper rather than stopping dead. `density` sets how many
threads there are.

Further reading:
- Security paper | https://en.wikipedia.org/wiki/Security_paper
- Perlin noise | https://en.wikipedia.org/wiki/Perlin_noise
