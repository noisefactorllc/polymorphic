Straightforward physics: gravity, wind, drag and a bit of random wander. This is
the usual partner for `pointsEmit()` when a demonstration just needs something
moving convincingly.

Each frame, a particle picks up a little speed from gravity and wind, loses a
little to drag, and moves.

Drag is what makes it look right rather than merely be correct. Leave it out and
things accelerate forever, tearing off the edge of the frame at increasing
speed, which nothing in air ever does. With drag proportional to speed, a
particle accelerates until the drag balances the pull and then holds that speed,
which is exactly what a falling raindrop or a snowflake does.

Turn gravity negative and the same code becomes rising smoke or bubbles.

The random wander is rolled fresh per particle per frame, so a stream spreads
out as it travels instead of moving like a rigid sheet.

Further reading:
- Newton's laws of motion | https://en.wikipedia.org/wiki/Newton%27s_laws_of_motion
- Drag (physics) | https://en.wikipedia.org/wiki/Drag_(physics)
- Terminal velocity | https://en.wikipedia.org/wiki/Terminal_velocity
