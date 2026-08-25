Colour fringing, but displaced in time rather than in space. Red, green and blue
each show you a different moment.

Eight frames of history are kept, passed along one slot per frame like a bucket
brigade, so the last slot holds what the picture looked like eight frames ago.
Each colour channel then reads from whichever slot you point it at: red from
four frames back, green from two, blue from right now.

Because nothing changes in a still picture, this only shows up on movement,
where it leaves coloured ghosts trailing behind anything that moves.

The delays are allowed to be fractional, blending between two stored frames
rather than snapping to whole ones, which keeps the trails smooth. Slots that
have not been written yet fall back to the live frame, so the effect fades in
over the first few frames instead of starting from black.

Further reading:
- Delay line memory | https://en.wikipedia.org/wiki/Delay_line_memory
- Chromatic aberration | https://en.wikipedia.org/wiki/Chromatic_aberration
