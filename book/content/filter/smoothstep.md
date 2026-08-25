A contrast adjustment with a particular shape. Everything below `edge0` is
crushed to black, everything above `edge1` is blown to white, and the range
between is stretched across the full scale with a gentle S-curve.

The S is the point. A straight remap would clip harshly at both ends; this eases
in and out, so the shadows and highlights approach their limits gradually rather
than hitting a wall. It is the same curve used for soft edges throughout the
book.

Each channel is remapped separately against the same pair of edges, which means
a colour cast in the picture gets exaggerated rather than corrected. If you want
even-handed contrast, use `adjust` instead.

Setting `edge0` above `edge1` inverts the result, which is a quick way to get a
high-contrast negative.

Further reading:
- Smoothstep | https://en.wikipedia.org/wiki/Smoothstep
- Cubic Hermite spline | https://en.wikipedia.org/wiki/Cubic_Hermite_spline
