The colour correction workhorse: brightness, contrast, hue and saturation, all
in one place. Reach for this when a picture is too dark, too flat, or the wrong
colour.

`brightness` scales everything up or down. `contrast` pushes values away from
mid grey, so lights get lighter and darks get darker. `rotation` spins every
hue around the colour wheel, and `saturation` sets how vivid things are, with
zero giving you greyscale.

`mode` is the strange one, and it is not a correction at all. It takes the three
numbers that describe each pixel and pretends they mean something else. Normally
they are amounts of red, green and blue. Set `mode` to HSV and the effect reads
them as hue, saturation and brightness instead, then converts that back to a
colour. Nothing is being corrected; the numbers are simply being misread on
purpose, which scrambles the picture into sharp rainbow bands. It is a
deliberate abuse and a useful one.

Further reading:
- HSL and HSV | https://en.wikipedia.org/wiki/HSL_and_HSV
- Color balance | https://en.wikipedia.org/wiki/Color_balance
