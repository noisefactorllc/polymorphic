Half of a pair that builds a feedback loop you get to fill yourself.

`loopBegin` reads a stored picture left over from previous frames, combines it
with what is coming in, and passes the result on. `loopEnd`, at the other end,
writes whatever came out back into that same store. Everything you put between
the two runs round and round, once per frame.

The combining is done by keeping whichever is brighter, and that choice gives
the effect its character. The store can only ever get lighter, so bright things
persist across frames and leave long-exposure trails behind them, while dark
areas get overwritten freely. It builds up instead of averaging out.

`intensity` dims the store slightly each frame, which is the fade: below one,
old trails gradually lose out to newer ones. The demonstration puts `warp`
inside the loop, which is why the trails smear as they age.

Further reading:
- Video feedback | https://en.wikipedia.org/wiki/Video_feedback
- Long-exposure photography | https://en.wikipedia.org/wiki/Long-exposure_photography
