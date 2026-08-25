Text on the picture. Any font installed on the machine, with word wrap, kerning
and line breaks behaving exactly the way they do everywhere else in a browser.

None of it is drawn by the shader. The browser's own text engine draws the words
onto an offscreen canvas, that canvas is handed to the graphics card as a
picture, and this pass lays it over the top. That division is why the typography
is right: nobody reimplemented a font renderer, they just used the one already
there.

The layering has three parts. The text sits on top, `matteOpacity` fills a
backing colour behind it so the words stay legible over a busy picture, and the
input shows through everywhere else.

Further reading:
- fillText (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fillText
- Kerning | https://en.wikipedia.org/wiki/Kerning
