# Back in smoothly — playable ad

### ▶ [Play it](https://thelifeofpita.github.io/backingame/) — best on a phone, where you steer by tilting it.

A reversing-camera parking game for PlatanoMelón's *Back in smoothly* campaign.
You are looking through the tailgate camera, already in reverse. Tilt the phone to
swing the back of the car into the empty bay before the nineteen seconds run out.
The poster on the wall is one of the three campaign executions, picked at random.

## What ships

| File | What it is |
| --- | --- |
| `index.html` | **The unit.** One self-contained file — artwork, DM Sans and all code are embedded. No network requests at runtime. Open it anywhere, drop it into any ad server. 383 KB. It sits at the repo root so GitHub Pages serves the game rather than this page. |
| `dist/embed.html` | The same page as body content only, for hosts that supply their own document shell. |
| `stills/*.png` | Fifteen hero stills: the floating phone, turning, at five moments of a round — one run for each of the three executions, named `ad1` / `ad2` / `ad3`. 900 × 1600, transparent background. |

Add `#studio` to the URL to make more stills — new seed, new car park, new run,
every time: <https://thelifeofpita.github.io/backingame/#studio>. It renders one
run per execution by default, so every poster in the campaign gets a set.

## Playing it

- **Phone** — tilt left and right. iOS asks permission for motion the first time;
  it only offers that over HTTPS, which is why the link above matters. The yellow guide lines swing with you and show
  where the back of the car is going. Hold the red button to brake. If the device
  refuses motion access, it falls back to dragging a finger across the screen.
- **Desktop** — `←` `→` steer, `space` brakes.
- Holding the brake stops the car; **keep holding and the box drops into D** and
  pulls you forward again, which is the only way out of an overshoot. The P R N D
  indicator on the dashboard shows which gear you are in.
- A round is 19 seconds. Park square, centred, up to the wheel stop, without
  touching anything. Do it properly and the poster is already filling the display
  when you stop — no reveal, no cutaway.

## Art direction, and why each part is there

Everything on screen is either a reversing camera, a car park, or PlatanoMelón.

- **The phone is the head unit.** Portrait screens cannot carry a 106° lens without
  a grotesque vertical field of view, so the camera feed sits in a recessed 4:3-ish
  display and the rest of the phone becomes dashboard: gear selector, parking
  sensor, brake. It is the same object the mockups photograph.
- **Yellow is doing two jobs at once.** `#FFEA00` is the poster yellow and the
  colour of every parking guide line ever painted. The CTA, the guide lines, the
  bay markings and the campaign artwork are the same yellow on purpose.
- **The guide lines are calibrated, not decorative.** They are drawn on the ground
  plane from the car's actual steering angle, so they bend as you tilt and stop
  where the wall is. Red bar at half a metre, yellow to 1.75 m, green beyond.
- **The lens is applied last, and so is the screen.** The scene renders flat and
  cheap, then one pass adds the barrel distortion, chromatic fringing and sensor
  grain — and then the display itself: the picture is snapped to a 336-pixel-wide
  panel grid — and that grid is indexed by the *lens-mapped* coordinate, so the
  pixels bow with the picture and pack tighter towards the edges rather than
  sitting on top as a flat mesh. The colour fringing is measured in whole panel
  pixels, because snapping the sample to pixel centres quantises away anything
  smaller than a texel, which is what made an earlier version invisible. It is
  zero on the optical axis and climbs steeply towards the corners, because that
  is what a lens does — the centre of the picture, where the poster ends up, is
  never touched. How
  much of the matrix gets drawn depends on how many output pixels a panel pixel
  covers, measured per fragment: draw it where it can be resolved, fade it where
  it cannot, or it aliases into a diagonal weave. Beating them together is what
  makes a photographed screen look like a photographed screen, which is exactly
  what the mockups are. The grille eases off on the payoff so the artwork lands
  clean.
- **Reverse chevrons** mark the target bay on the floor and reappear as the tilt
  indicator in the how-to diagram.
- **The poster is framed by where you park, not by a camera trick.** That is the
  campaign: you see the ad *through the reversing camera*, in the ordinary course
  of backing in. Every bay has a concrete wheel stop about a metre off the wall —
  the reason nobody parks with their bumper against it — and the poster is sized
  and hung so that a car resting on that stop has it square in the middle of the
  display. Park well and it lands perfectly. Park crooked and it sits crooked.
  The camera never leaves the car.
- **The floor markings get out of the way.** Bay outline and chevrons fade as the
  car closes on the stop, so the last second belongs to the poster.
- **The cars are Kenney's Car Kit** (CC0), re-baked to flat colours and 16-bit
  positions so five of them cost about 185 KB and need no texture. The body
  paint is the one patch the shader re-tints, so the same five models fill a
  car park in a dozen colours.
- **The scene is drawn in WebGL with a depth buffer.** A painter's-algorithm 2D
  renderer cannot sort a two-thousand-triangle car against itself — every face
  showed at once. The hardware decides now. Flat normals come from screen-space
  derivatives and are turned to face the viewer, so winding never matters, and
  the strip lights are evaluated per pixel rather than faked with sprites. It
  also costs about a seventh of the CPU the 2D renderer did.
- **Type** is DM Sans throughout — tight and large for the brand's voice, tracked
  out with tabular figures for the car's readouts.
- **Instruction is one diagram and one line.** The diagram is a live miniature of
  the same dashboard doing the thing it is asking for.

## Accessibility

- Tilt, keyboard and drag are all first-class; the drag fallback also covers anyone
  who cannot tilt a device.
- The proximity readout says the same thing three ways — arc position, colour and a
  number — so it survives colour blindness.
- Live status region, real focus rings, 44 px targets, `inert` dashboard behind
  sheets, `prefers-reduced-motion` honoured (no flicker, reduced shake).
- No strobing. The only flashes are single, brief and under 25% opacity.

## Wiring it up

- Click-through URL: `CTA_URL` at the top of `src/game.js` (and near the top of the
  `<script>` block in the built file). Swap in the network's click macro.
- Round length: `TUNE.timeLimit` in `src/sim.js`.
- The look of the camera: `LOOK` in `src/post.js`.

## Licence

Code is original work for this campaign. The campaign artwork and the DM Sans
files carry their own terms — see [NOTICE.md](NOTICE.md).

## Building

```sh
node build.mjs                 # src/ -> index.html + dist/embed.html
node tools/stills.mjs          # renders stills/ (needs a local server on :8791)
```

`src/assets.js` and `src/fonts.css` are generated: the three campaign PNGs are
cropped, resized and re-encoded as WebP, and DM Sans is subset to the characters
this unit actually sets (about 20 KB for three weights).
