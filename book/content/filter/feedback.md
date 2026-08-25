Video feedback. Point a camera at the screen it is filming and you get an
infinite tunnel of receding copies; this does the same thing, but with a
transformation applied each time round.

Every frame, the previous output is scaled, rotated, bent, twisted and
hue-shifted, then blended back in with whatever is coming in fresh, and stored
for the next go round. Because the transformation happens on every pass, its
effect stacks up. Scale a fraction above one and you get the tunnel. Add a small
rotation and it becomes a spiral. Do both and you get the classic vortex.

Which of the nineteen blend modes you pick decides how the trail behaves as it
recedes. Under `screen` it glows brighter going in; under `multiply` it darkens
into a hole. The mixing is balanced so that feeding live input into the loop
cannot run away and blow out to white.

Further reading:
- Video feedback | https://en.wikipedia.org/wiki/Video_feedback
- Blend modes | https://en.wikipedia.org/wiki/Blend_modes
