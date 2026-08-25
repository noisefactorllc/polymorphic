The glitch-art staple where each row of pixels is sorted by brightness, dragging
the picture into long smears of graduated colour.

There is a problem. Sorting means putting things in order one after another, and
a shader works on every pixel at the same time, in no particular order and with
no knowledge of what its neighbours are doing. It genuinely cannot sort.

The way around it is to notice you do not need the sort, only the answer. A
pixel's place in a sorted row is just the number of pixels in that row brighter
than it, and you can estimate that without ordering anything. So each pixel
takes thirty-two readings spread across its row, counts how many came back
brighter, and uses that as its position. Ties fall back to original position so
matching pixels keep a stable order.

The roughness of that estimate is the effect's whole character. A true sort
would look mechanical; sampling thirty-two points leaves the banded smear.

Further reading:
- Glitch art | https://en.wikipedia.org/wiki/Glitch_art
- Sorting algorithm | https://en.wikipedia.org/wiki/Sorting_algorithm
