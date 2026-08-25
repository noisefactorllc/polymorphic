Finds every pixel close to one colour and swaps it for another. The everyday use
is fixing one wrong colour in a picture without touching anything else.

Each pixel's distance from `targetColor` is measured, and `sensitivity` sets how
close counts as a match while `smoothing` softens the boundary so the selection
does not have a hard edge.

The useful part is that the match then drives two separate things. `colorMix`
decides how far the colour moves toward `replaceColor`, and `replaceAlpha` and
`keepAlpha` decide what happens to transparency. Because they are independent,
you can recolour a region while leaving it fully opaque, or punch it out
completely while leaving its colour untouched. That second option is what turns
this into a green screen key: set the replacement alpha to zero and the matched
colour disappears.

Further reading:
- Chroma key | https://en.wikipedia.org/wiki/Chroma_key
- Color difference | https://en.wikipedia.org/wiki/Color_difference
