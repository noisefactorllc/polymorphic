A frame chopped into rectangles of different sizes, like a Mondrian or a
newspaper layout.

The splitting has no plan behind it and nothing is stored. Every pixel works out
its own rectangle from scratch, independently, and they all agree. It starts by
considering the whole frame, then flips a weighted coin to decide whether to
split it. If it splits, the pixel notices which half it landed in, keeps that
half, and asks again. Up to six rounds later it knows exactly which rectangle it
belongs to. Because the coin flip depends only on the rectangle's own position,
every pixel inside a given rectangle flips the same coin and gets the same
answer, and a consistent layout appears with no pixel ever consulting another.

`density` is the weighting on that coin, `depth` sets how many rounds. `fill`
puts a shape inside each cell, and `outline` draws the divisions. Splits that
would leave a very thin sliver are refused.

Further reading:
- Piet Mondrian | https://en.wikipedia.org/wiki/Piet_Mondrian
- Binary space partitioning | https://en.wikipedia.org/wiki/Binary_space_partitioning
