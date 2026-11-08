Up to eight polygons on one canvas, each showing a different picture. It makes no
image of its own. It only decides which surface each pixel takes its colour from,
which is the job at the heart of projection mapping, where one projector has to
put different material on different walls.

Each pixel asks every zone whether it is inside. Run a line from the pixel out to
the right and count how many of the polygon's edges it crosses: an odd count means
inside, an even one outside. That single test works for any polygon, however
awkward its outline.

A zone is a window, not a transform. Its source is not squeezed to fit; the zone
simply shows whatever part of that picture falls behind it. Zones stack in number
order with the highest on top, lower ones show through wherever a zone above is
transparent, and `bgColor` sits under everything.

`smoothEdge` feathers each zone outward only, so its interior is never eaten away
and two zones sharing an edge meet without a seam.

In Noisedeck the corners are placed by clicking on the live canvas. Here they are
written out in the program: `zone0_tex` wires in a surface, `zone0_count` says how
many corners there are, and `zone0_v0` holds the first two of them as a packed
pair of coordinates, measured from the top left of the frame.

Further reading:
- Projection mapping | https://en.wikipedia.org/wiki/Projection_mapping
- Point in polygon | https://en.wikipedia.org/wiki/Point_in_polygon
