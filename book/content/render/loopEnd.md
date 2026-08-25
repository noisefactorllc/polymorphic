The closing half of the pair. It takes whatever the chain has produced since
`loopBegin` and writes it back into the store, ready for the next frame to read.

That is the whole shader. No parameters, no arithmetic.

What makes the pair worth having is that the loop is open. Effects with feedback
built in, like `motionBlur` or `feedback`, decide for you what happens inside
it. Here you decide. Put a warp between the two and the trails smear along the
warp. Put a rotation there and they spiral. Put a colour shift there and each
generation of the trail comes out a different hue, so the history of the image
is written in colour.

The pair also nests inside a longer chain, so the loop can sit in the middle of
a program rather than having to be the whole of it.

Further reading:
- Video feedback | https://en.wikipedia.org/wiki/Video_feedback
- Framebuffer | https://en.wikipedia.org/wiki/Framebuffer
