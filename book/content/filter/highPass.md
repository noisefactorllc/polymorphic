Keeps only the fine detail in a picture and throws away everything else, leaving
a flat grey sheet with edges floating in it.

It works the same way as `unsharpMask` up to the last step. Blur the picture,
subtract the blur from the original, and what remains is exactly the detail the
blur removed. `unsharpMask` adds that back; this shows it to you on its own. Mid
grey is added because the difference can be negative, and would otherwise clip
to black.

On its own it is not much to look at. Its value is as an ingredient: overlay it
on the original with a contrast-style blend mode and you have very controllable
sharpening, or use it as a mask to select textured areas and leave smooth ones
alone. `mono` discards the colour so only structure survives.

Further reading:
- High-pass filter | https://en.wikipedia.org/wiki/High-pass_filter
- Unsharp masking | https://en.wikipedia.org/wiki/Unsharp_masking
