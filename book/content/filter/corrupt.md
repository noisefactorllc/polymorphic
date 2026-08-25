Datamosh. The picture tears into horizontal bands that shear, smear and lose
their colour registration, the way a video file does when frames go missing.

The frame is divided into bands, and each one keeps its own random state on its
own clock. A probability decides whether a given band is corrupted this frame,
and bands that miss the roll pass through completely untouched. That is what
makes the glitch flicker in and out rather than sit there constantly, and the
independent per-band clock is what stops the whole frame from twitching in
unison.

Corrupted bands get their pixels sorted and shifted sideways, imitating a
decoder that has lost its place mid-row. Two further distortions run across the
whole frame regardless: `melt` drags things downward, and `scatter` jitters them
pixel by pixel. Last of all the red and blue channels are pulled apart by
different amounts, so the damage breaks the colour alignment too.

Further reading:
- Glitch art | https://en.wikipedia.org/wiki/Glitch_art
- Compression artifact | https://en.wikipedia.org/wiki/Compression_artifact
