Pushes the picture around with noise, so it ripples and flows like something
seen through moving water.

The idea behind it is worth knowing because it turns up everywhere. Normally a
pixel shows whatever is at its own position. Here, before looking, each pixel is
nudged somewhere else, and how far it moves comes from a noise pattern. Since
nearby pixels get nudged in similar directions, whole regions of the picture
stretch and swirl together instead of turning into confetti.

`strength` sets how far things move and `scale` sets how large the swirls are.
Small scale with high strength shreds the picture; large scale with low strength
gives a slow underwater drift.

`speed` animates it, and it does so by turning the noise in place rather than
travelling through it. That means the pattern comes back to exactly where it
began, so the motion loops forever without a jump.

Further reading:
- Inigo Quilez, Domain warping | https://iquilezles.org/articles/warp/
- Image warping | https://en.wikipedia.org/wiki/Image_warping
