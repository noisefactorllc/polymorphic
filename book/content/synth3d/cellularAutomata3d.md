Conway's Game of Life, but in a solid block instead of on a flat sheet. Each
cell counts its living neighbours and a birth and survival rule decides whether
it lives.

The extra dimension changes things more than you might expect. On a flat grid a
cell has eight neighbours. In a block it has twenty-six. That spreads the counts
across a much wider range, so a rule tuned for the flat version either fills the
whole volume solid within a few steps or dies out immediately. The rules that
produce anything interesting in three dimensions are a completely different set,
found by search rather than by adapting the famous one.

Alongside whether a cell is alive, its age is tracked, so the renderer can shade
freshly born cells differently from settled ones.

The first frame seeds itself, either at random or from an upstream volume.

Further reading:
- Cellular automaton | https://en.wikipedia.org/wiki/Cellular_automaton
- Moore neighborhood | https://en.wikipedia.org/wiki/Moore_neighborhood
