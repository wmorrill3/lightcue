# Tesla light-show format: what LightCue writes

These are working notes on the file format, collected from Tesla's public
[light-show](https://github.com/teslamotors/light-show) documentation and the xLights model it ships with.
The authoritative values live in [`engine/channels.js`](../engine/channels.js).

## Container

| Field | Value |
|---|---|
| Format | xLights FSEQ **v2.0**, magic `PSEQ` |
| Compression | **none** (the car rejects compressed files) |
| Channels | **200** (48 is also accepted for lights-only shows; LightCue always writes 200) |
| Step time | **20 ms** (50 frames per second) |
| Variable headers | `mf` (media file name), `sp` (sequence producer) |
| Audio | `.wav` (recommended) or `.mp3`, same base name as the `.fseq` |
| Location | `LightShow/` at the root of the USB drive |

## Channel map (1-based, as in xLights)

| Channels | What |
|---|---|
| 1–30 | Exterior lights: low beams, high beams, signature/DRL, fog lights, aux park, side markers, repeaters, front and rear turn signals, brake, tail, reverse, rear fog, license plate (left/right pairs) |
| 31–46 | Closures: falcon doors, front doors, mirrors, windows (×4), liftgate/trunk/frunk, door handles, charge port |
| 47–106 | Cybertruck front light bar (60 pixels) |
| 111–162 | Cybertruck rear light bar (52 pixels) |
| 167–172 | Cybertruck off-road lights |
| 176–193 | Interior ambient RGB |

## Light byte values

A light channel's value picks both brightness and Tesla's built-in fade:

| Byte | Meaning |
|---|---|
| 0 | Off (instant) |
| 25 / 51 / 76 | Ramp **off** over 500 / 1000 / 2000 ms |
| 178 / 204 / 229 | Ramp **on** over 500 / 1000 / 2000 ms |
| 255 | On (instant) |

## Closure byte values

Closures read commands, not brightness:

| Byte | Command |
|---|---|
| 0 | Idle |
| 63 | Open |
| 127 | Dance |
| 191 | Close |
| 255 | Stop |

## Per-show limits

Tesla limits how many commands each closure may receive in one show. LightCue counts them as it writes and
validates again before export.

| Closure | Max commands / show | Approx. travel time LightCue allows |
|---|---|---|
| Liftgate / trunk | 6 | 14 s open, 4 s close |
| Front doors | 6 | 22 s open, 3 s close |
| Falcon doors (Model X) | 6 | 20 s open, 8 s close |
| Windows | 6 | 4 s |
| Mirrors | 20 | 2 s |
| Door handles (Model S) | 20 | 2 s |
| Charge port | 3 | 2 s |

Also:

- A "dance" must stay under 30 seconds.
- **Model X**: windows must not move while the falcon doors are moving.
- Multi-car shows sync with **Schedule Show** (up to 10 minutes ahead), not over a network.

## Wraps

| Rule | Value |
|---|---|
| Format | PNG |
| Size | 512×512 to 1024×1024 px, max 1 MB |
| Paintable area | Template alpha |
| Templates | One per body variant, from [teslamotors/custom-wraps](https://github.com/teslamotors/custom-wraps) |
| Location | `Wraps/` at the root of the USB drive |

## Lock sound

`LockChime.wav` at the root of the drive, selectable in **Toybox → Boombox → Lock Sound**. LightCue cuts
2 seconds from the song's hook, applies short fades and normalises loudness.
