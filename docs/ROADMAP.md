# Roadmap

LightCue is at **v1**: a complete, working pipeline from any song to a validated show for every Tesla that
supports light shows, with an accurate 3D preview, a REST API and an MCP server. Below is where it goes
next, roughly in order.

## v1: shipped

- [x] NumPy song analysis at 50 fps: tempo, kick-aligned beats, downbeats, drums, sections, drops
- [x] Rule-based director with seven moods and three vibes
- [x] 200-channel choreography: exterior lights with native ramps, closures, interior RGB, Cybertruck
      light bars
- [x] Hard safety rules: per-closure command limits, dance length, Model X window/falcon interlock,
      travel times
- [x] FSEQ v2 writer, reader and validator
- [x] Fleet shows for up to 12 mixed cars, with chases that travel car to car
- [x] Lock sound cut from the hook
- [x] Six wraps fitted to all twelve official body templates
- [x] Web studio with a 3D preview driven by the actual `.fseq`, live re-choreography and clip recording
- [x] REST API, MCP server, share pages
- [x] Roadster preview mode (liftoff on the drop)

## v1.x: next

- [ ] **Real-car verification matrix**: every model and year, with community video reports linked
- [ ] **Timeline editor**: nudge cues, lock sections, paint moments, then re-render the rest
- [ ] **Show presets**: "wedding entrance", "car-meet opener", "holiday"
- [ ] Export the show plan alongside the `.fseq` so it can be opened again later
- [ ] Better analysis for half-time, rubato and live recordings
- [ ] Localised site and pack README

## v2

- [ ] **AI director**: a language model reads the song's structure (and the lyrics, if you want) and
      writes the plan. It saves the big moves for the big moments, calls back to motifs, and follows
      directions like "make it romantic until the last chorus"
- [ ] **Custom wraps from a prompt**, generated and fitted to your exact body variant
- [ ] **Library and accounts**: save, remix and share shows. Packs no longer expire
- [ ] **Event mode**: plan a fleet show by parking layout, with a start-time sheet for every driver
- [ ] **Roadster**: full support as soon as Tesla publishes its channel map

## Ideas under consideration

- Matching lock sound, wrap and show "themes"
- Choreograph from a video's soundtrack
- Light shows timed to a DJ set or playlist, as several shows on one drive

Have a request? Open an issue.
