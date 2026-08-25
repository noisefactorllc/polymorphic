Folds the tonal range back on itself repeatedly, giving the metallic,
oil-slick colours of a solarised photograph.

Each pixel's brightness is multiplied by `amount` and fed into a wave. Because a
wave rises and falls forever, brightness values that were far apart can come out
identical, and a smooth gradient turns into a series of bands. Raising `amount`
packs more bands into the same range of tones.

`colorMode` changes the character completely. In mono the picture is reduced to
brightness first, so the bands follow its tonal structure and everything comes
out grey. In rgb each channel is folded on its own, and since the three channels
rarely hold the same value, their bands land in different places. That
disagreement is where the colours come from: nothing is being tinted, the
channels have simply stopped agreeing with each other.

Further reading:
- Sabattier effect | https://en.wikipedia.org/wiki/Sabattier_effect
- Sine wave | https://en.wikipedia.org/wiki/Sine_wave
