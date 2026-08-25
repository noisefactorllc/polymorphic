Noise with a grain, like brushed metal or wood. Most noise looks the same
whichever way you turn it. This has a direction, so you can point it and get
streaks that all run the same way.

The trick is what it is built from. Instead of random values on a grid, the
effect scatters thousands of tiny ripples across the picture and adds them all
up. Each ripple is a little wave that fades out at the edges, and because a wave
travels in a direction, so does the pattern. Give every ripple the same angle
and the whole surface takes on a grain.

`orientation` sets that angle. `isotropy` decides how strictly the ripples obey
it: at zero they all line up and the grain is strong, and as you raise it each
ripple picks its own angle until the result is ordinary directionless noise
again. `bandwidth` sets how wide each ripple is, so lower values give sharper,
more defined strands, and `density` sets how many are packed in.

Further reading:
- Gabor filter | https://en.wikipedia.org/wiki/Gabor_filter
- Lagae et al., Procedural Noise using Sparse Gabor Convolution | https://graphics.cs.kuleuven.be/publications/LLDD09PNSGC/
