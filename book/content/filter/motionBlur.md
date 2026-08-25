Trails. Each frame is mixed with the one before it, so moving things leave a
smear behind them and still things stay sharp.

What makes it more than a two-frame average is that the previous frame already
contains a mixture of the frame before that, and so on backwards. Every frame in
history is still in there, contributing a little less each time it ages. The
trail therefore fades away smoothly rather than cutting off after a set number
of frames.

`amount` sets how much of the old picture is kept. It is deliberately capped
just short of the maximum: at exactly the top the incoming frame would
contribute nothing at all and the picture would freeze on whatever happened to
be there. `resetState` clears the accumulated history and starts again.

Further reading:
- Motion blur | https://en.wikipedia.org/wiki/Motion_blur
- Long-exposure photography | https://en.wikipedia.org/wiki/Long-exposure_photography
