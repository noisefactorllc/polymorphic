Conway's Game of Life and seventeen of its relatives, running live.

The screen is a grid of cells, each either alive or dead. Every step, each cell
counts how many of its eight neighbours are alive and consults two short rules:
how many neighbours it takes to bring a dead cell to life, and how many are
needed to keep a living one alive. Life itself is born on exactly three and
survives on two or three. That is the entire specification, and gliders,
oscillators and the rest are not programmed anywhere. They are consequences.

`ruleIndex` picks from the eighteen presets. Seeds is worth trying because
nothing ever survives, so the whole population blinks out and is reborn each
step. Maze grows corridors. Diamoeba makes wandering blobs.

`smoothing` is a display choice rather than a rule. The simulation runs on a
coarse grid, and this decides whether you see hard squares or a soft continuous
surface blurred between them. `speed` sets the rate, independent of your frame
rate.

Further reading:
- Conway's Game of Life | https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life
- Life-like cellular automaton | https://en.wikipedia.org/wiki/Life-like_cellular_automaton
- Golly, a Life explorer | https://en.wikipedia.org/wiki/Golly_(program)
