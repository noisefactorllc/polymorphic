Liquid metal. The picture is turned into a rippling chrome surface that has
almost nothing to do with the original colours.

Brightness is read as a height field, and then the surface distorts itself: the
slope at each point is used to shift where that point reads from, which is a
cheap imitation of light refracting through an uneven surface, and is what makes
the metal look like it is flowing rather than merely bumpy.

The chrome look comes from the tone curve. The height is fed through a wave, so
instead of a smooth gradient you get alternating light and dark bands, which the
eye reads as reflections of an environment. A small extra term makes their
spacing slightly irregular so they do not look mechanical, and a narrow boost
adds a hard highlight on the peaks only.

`detail` sets how many bands, `distortion` how much the surface flows.

Further reading:
- Specular highlight | https://en.wikipedia.org/wiki/Specular_highlight
- Refraction | https://en.wikipedia.org/wiki/Refraction
