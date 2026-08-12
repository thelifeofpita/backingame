# Back in smoothly — playable ad

A reversing-camera parking game for PlatanoMelón's *Back in smoothly* campaign.
You are looking through the tailgate camera, already in reverse. Tilt the phone to
swing the back of the car into the empty bay before the nineteen seconds run out.
The poster on the wall is one of the three campaign executions, picked at random.

## What ships

| File | What it is |
| --- | --- |
| `dist/index.html` | **The unit.** One self-contained file — artwork, DM Sans and all code are embedded. No network requests at runtime. Open it anywhere, drop it into any ad server. 381 KB. |
| `dist/artifact.html` | The same page as body content only, for hosts that supply their own document shell. |
| `stills/*.png` | Ten hero stills: the floating phone, turning, at ten moments of one demo round. 900 × 1600, transparent background. |

Open `dist/index.html#studio` to make more stills — new seed, new car park, new
run, every time.

## Playing it

- **Phone** — tilt left and right. The yellow guide lines swing with you and show
  where the back of the car is going. Hold the red button to brake. If the device
  refuses motion access, it falls back to dragging a finger across the screen.
- **Desktop** — `←` `→` steer, `space` brakes.
- A round is 19 seconds. Park square, centred and close to the wall without
  touching anything. Win or lose, the camera goes and reads the poster.

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
- **The lens is applied last.** The scene is rendered flat and cheap (760 px wide,
  flat grey, auto-gain), then a WebGL pass adds the barrel distortion, chromatic
  fringing, scan lines, the LCD's RGB stripe and the sensor grain — the moiré you
  get photographing a dashboard, which is exactly what the mockups are.
- **Reverse chevrons** mark the target bay on the floor and reappear as the tilt
  indicator in the how-to diagram.
- **The payoff is a camera move.** On the last frame of a round the lens leaves the
  car and reads the poster on the wall, and the cheap-camera treatment eases off
  as it goes, so the artwork arrives as artwork.
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
node build.mjs                 # src/ -> dist/
node tools/stills.mjs          # renders stills/ (needs a local server on :8791)
```

`src/assets.js` and `src/fonts.css` are generated: the three campaign PNGs are
cropped, resized and re-encoded as WebP, and DM Sans is subset to the characters
this unit actually sets (about 20 KB for three weights).
