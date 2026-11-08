Laying one picture over another, with a single slider covering both directions.
Below the midpoint the pipeline image sits on top of the second picture; above
it the second picture sits on top. The full stack is at the centre, and each end
of the slider fades out to one picture alone.

What decides where the top picture is see-through is its transparency, which
means it only works on something that already carries transparency with it.

Mask mode drops that requirement. Instead of reading the second picture's
transparency it reads its brightness, and uses that as the transparency of the
first. Now anything at all can act as a stencil: bright areas of the mask keep
the picture solid, dark areas cut holes in it. `baseTex` decides what shows
through those holes; left unset, they stay transparent.

That is the difference between laying down something that already knows its own
shape and cutting a shape out of something that does not.

Further reading:
- Alpha compositing | https://en.wikipedia.org/wiki/Alpha_compositing
- Porter and Duff, Compositing Digital Images | https://keithp.com/~keithp/porterduff/p253-porter.pdf
