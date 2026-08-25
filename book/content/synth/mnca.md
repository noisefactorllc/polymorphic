Cellular automata, but looking much further afield, and the results look less
like a grid of cells and more like something alive.

Conway's Life asks each cell about its eight immediate neighbours. This asks
about two much larger regions at once: a disc reaching three cells out, and a
ring further out again from four to seven. Rather than counting how many are
alive it takes the average brightness of each region, which gives it two numbers
per cell instead of one count.

The rule is then a list of bands. If the inner average falls between these two
values, switch on; if the outer average falls between those two, switch off; and
so on down six tests in order, with later tests overruling earlier ones. That is
why the parameters come in pairs, each pair being the start and width of one
band.

Small moves make large differences. Nudge one band edge and static blobs become
crawling worms.

Further reading:
- Cellular automaton | https://en.wikipedia.org/wiki/Cellular_automaton
- Slackermanz, multiple neighborhood automata | https://github.com/Slackermanz/VulkanAutomata
