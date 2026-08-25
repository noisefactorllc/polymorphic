Bands and stripes, driven by a waveform. It is the simplest generator here after
`solid`, and useful as a source of moving structure for other effects to chew
on.

Every pixel is reduced to a single number based on how far up the screen it sits,
and that number is fed to the chosen waveform. Everything at the same height gets
the same answer, which is why the output is always stripes. `frequency` sets how
many, `speed` scrolls them, and `rotation` turns the whole field first so the
bands can run at any angle.

`oscType` picks the waveform. Sine gives soft gradients, triangle gives even
ramps, sawtooth ramps and snaps back, square gives hard edges with nothing in
between. The two noise settings are the interesting ones: they replace the
regular wave with randomness that still repeats exactly, so the bands come out
irregular but the pattern tiles and loops seamlessly rather than drifting.

Further reading:
- Sine wave | https://en.wikipedia.org/wiki/Sine_wave
- Wave interference | https://en.wikipedia.org/wiki/Wave_interference
