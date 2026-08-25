Television static, from an untuned analogue set.

`alpha` sets how much of it you see, but `density` is the parameter worth
understanding, because it does not simply fade the static in and out. It thins
it. At low settings you get sparse isolated specks on an otherwise clean
picture; as you raise it, more and more specks appear until the frame is full.

That behaviour comes from a second, hidden noise field acting as a gate. Each
pixel only shows static if that gate is above a cutoff, and `density` raises or
lowers the cutoff very sharply. At the low end almost nothing passes and only
the rare extreme values survive, which is why the specks are scattered rather
than faint. A simple fade would make the whole field dim; this makes it sparse,
which is what real static does as a signal weakens.

Further reading:
- Noise (video) | https://en.wikipedia.org/wiki/Noise_(video)
- White noise | https://en.wikipedia.org/wiki/White_noise
