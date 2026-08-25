A flow field that moves like liquid. Where ordinary noise gives you blobs that
swell and shrink, this gives you swirling currents that carry things along
without ever piling up or draining away.

That property is the whole point, and it comes from a piece of mathematics
called the curl. If you take any field of values and ask, at every point, how
much it is rotating rather than how much it is flowing outward, what you get
back is guaranteed to have no sources and no sinks. Nothing can accumulate. Feed
that to particles and they behave like smoke or water rather than being sucked
into invisible drains.

Working it out means measuring how the underlying noise changes as you step a
little in each direction, twelve times over for every pixel. That is expensive,
so leave `octaves` low unless you need the detail. `intensity` sets how strong
the swirling is.

Further reading:
- Curl | https://en.wikipedia.org/wiki/Curl_(mathematics)
- Bridson, Curl-Noise for Procedural Fluid Flow | https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf
