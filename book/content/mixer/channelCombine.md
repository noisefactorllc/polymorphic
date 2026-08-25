Builds one picture out of three, putting each into a different colour channel.
The first source becomes the red, the second the green, the third the blue.

Each source is reduced to plain brightness before being written in. That matters
more than it sounds. If it took the red channel of the first source instead, the
result would depend on colours you were not thinking about, and a source that
happened to be blue would contribute nothing at all. Taking brightness means
each source contributes exactly what you can see in it.

The three level controls scale each contribution on its own, which is how you
balance sources of quite different average brightness so one does not swamp the
other two.

Transparency is forced solid, because there is no sensible way to combine three
different transparencies into one.

Further reading:
- Channel (digital image) | https://en.wikipedia.org/wiki/Channel_(digital_image)
- False color | https://en.wikipedia.org/wiki/False_color
