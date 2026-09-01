Folds the tonal range at a chosen point, so that mid tones become the brightest
and both ends fall away to black.

Pick a `level`. Values sitting exactly there come out white, and the further a
value is from it in either direction, the darker it gets. Applied to a smooth
gradient this draws a bright band along the contour where the gradient crosses
your level. Applied to noise it turns every gentle slope into a sharp
ridgeline, which is where the name comes from and why `noise()` and its relatives
have a `ridges` option of their own.

There is a correction that stops an off-centre level breaking it. If `level` sits
near one end, one side of the fold is much longer than the other, so the effect
scales by whichever side is longer. Without that the short side would clip to
black long before reaching the end of the range.

Further reading:
- Tone mapping | https://en.wikipedia.org/wiki/Tone_mapping
- Absolute value | https://en.wikipedia.org/wiki/Absolute_value
