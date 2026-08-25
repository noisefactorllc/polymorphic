Bright things smeared sideways into light trails, as though the picture were
being blown across the frame.

Each pixel looks back up to a hundred and twenty-eight pixels upwind along its
own row and collects what it finds, weighted three ways at once: brighter
samples count for more, closer samples count for more, and the far end of the
run is tapered off to nothing.

Adding all of it up rather than just grabbing the brightest sample is what keeps
this from looking like grain. Picking a winner gives hard edges wherever the
winner changes, which is a very recognisable failure. Accumulating gives a
smooth falloff instead.

The three methods differ only in how fast things fade. Wind is short and quick,
blast carries a broad dense trail, and stagger drifts each row slightly out of
phase with its neighbours so the streaks separate without hard breaks between
rows.

Further reading:
- Motion blur | https://en.wikipedia.org/wiki/Motion_blur
- Long-exposure photography | https://en.wikipedia.org/wiki/Long-exposure_photography
