The look of a document put through a photocopier a few too many times: harsh
black lines, blown-out whites, and no midtones at all.

Two things are combined. A difference-of-blurs finds the edges, which becomes
the ink outline. Separately, anything below a brightness threshold is filled in
solid, which is what a photocopier does to shadows. The two are combined by
taking whichever is stronger.

The final step is what makes it convincing: the result is mapped onto exactly
two colours, `inkColor` and `paperColor`. No pixel in the output is a shade of
the original picture. Everything is ink, paper, or a blend of the two.

`detail` sets the size of the blur and so how coarse the edges it catches are.
`darkness` pushes both the line weight and how much of the shadow fills in.

Further reading:
- Xerography | https://en.wikipedia.org/wiki/Xerography
- Difference of Gaussians | https://en.wikipedia.org/wiki/Difference_of_Gaussians
