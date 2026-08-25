Removes dust, speckles and stray bright pixels while leaving edges crisp. The
page splits the frame down the middle so you can see it working: cleaned on
the left, the speckled original on the right.

The trick is to use the middle value rather than the average. Take the pixels
around each point, sort them by brightness, and use whichever one lands in the
middle. An average is dragged toward any extreme value in the group, so a single
white speck lightens everything nearby. The middle value simply ignores it: one
odd pixel out of forty-nine does not change which one is in the middle. Edges
survive for the same reason, since on one side of an edge the majority of
neighbours are still on that side.

Actually sorting forty-nine pixels per screen pixel would be slow, so the effect
uses a shortcut that finds the middle one without ordering the rest.

`threshold` gates the swap, so a pixel is only replaced if it differs enough
from the middle value to be suspicious.

Further reading:
- Median filter | https://en.wikipedia.org/wiki/Median_filter
- Salt-and-pepper noise | https://en.wikipedia.org/wiki/Salt-and-pepper_noise
