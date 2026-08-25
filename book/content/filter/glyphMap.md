ASCII art. The picture is covered with a grid of text characters, each chosen so
that how much ink it puts on the page matches how bright that part of the
picture is: light punctuation for highlights, dense blocks for shadows.

The characters are drawn from small bitmaps rather than loaded from a font, so
there is nothing to download and the shapes stay crisp at any size.

Each cell takes a single reading from the middle of its patch rather than
averaging the whole patch. That is deliberate. Averaging gives you something
closer to a photograph, while single sampling gives the harder, more posterised
edges that read as a terminal. To stop flat areas turning into long runs of the
same letter, each cell rolls a die and picks between three characters of equal
weight.

In colour mode the character is tinted with the colour it replaced, so the text
carries the picture's palette.

Further reading:
- ASCII art | https://en.wikipedia.org/wiki/ASCII_art
- Text mode | https://en.wikipedia.org/wiki/Text_mode
