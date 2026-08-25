An image that grows its own structure. Whatever you feed in, within a few
seconds it is generating swirls, ridges and cell shapes that were never in the
source.

Each frame, the previous output is blurred, then sharpened, then mixed back in
with the incoming picture and stored for next time. Blur followed by sharpen
would normally cancel out and do nothing at all. What breaks the cancellation is
that the two work at different sizes: the blur spreads things at one scale while
the sharpen pulls them back at another. That small mismatch compounds every
frame, so whichever scale wins grows until it clips, and everything else fades
out.

The result is a reaction and diffusion system built out of nothing but image
filters, the same tug of war between spreading and concentrating that puts spots
on a leopard and stripes on a fish. `reset` bypasses the loop and lets the input
straight through.

Further reading:
- Reaction-diffusion system | https://en.wikipedia.org/wiki/Reaction%E2%80%93diffusion_system
- Unsharp masking | https://en.wikipedia.org/wiki/Unsharp_masking
