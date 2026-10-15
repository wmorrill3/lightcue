# LightCue API reference (v1)

Base URL: `https://lightcue.io/api/v1` (or `http://localhost:3150/api/v1` when self-hosted).

All responses are JSON unless noted. There's no authentication for normal use. Rate limits are per IP,
and an API key raises them.

- [Overview](#overview)
- [Authentication and limits](#authentication-and-limits)
- [GET /v1](#get-v1)
- [GET /v1/catalog](#get-v1catalog)
- [POST /v1/shows](#post-v1shows)
- [GET /v1/shows/:id](#get-v1showsid)
- [Show files](#show-files)
- [POST /v1/validate](#post-v1validate)
- [POST /v1/remux](#post-v1remux)
- [MCP server](#mcp-server)
- [Errors](#errors)
- [Examples](#examples)

---

## Overview

Making a show is asynchronous:

```
POST /v1/shows ──▶ 202 { id, status: "queued" }
GET  /v1/shows/:id   queued → analyzing → choreographing → done | failed
GET  /v1/shows/:id/download   USB pack (.zip)
```

A typical 3–4 minute song takes 10–30 seconds end to end.

## Authentication and limits

| | Without key | With `x-api-key` |
|---|---|---|
| New shows | 20 / hour / IP | 500 / hour / key |
| Validations | 100 / hour | 2 500 / hour |

Self-hosters set keys with `API_KEYS=key1,key2` in `.env`.

| Limit | Value |
|---|---|
| Audio upload | 40 MB |
| Song length | 5 s – 15 min |
| Cars per show | 12 |
| Job retention | 7 days |

---

## GET /v1

Service info plus the full catalog (same as `/v1/catalog`), with the docs and MCP URLs.

## GET /v1/catalog

Everything you can ask for.

```json
{
  "cars": [
    { "id": "model3", "name": "Model 3", "closures": ["mirror", "window", "chargePort", "liftgate"], "lightBars": false, "previewOnly": false },
    { "id": "modely", "name": "Model Y", "closures": ["mirror", "window", "chargePort", "liftgate"], "lightBars": false, "previewOnly": false },
    { "id": "models", "name": "Model S", "closures": ["mirror", "window", "chargePort", "liftgate", "handle"], "lightBars": false, "previewOnly": false },
    { "id": "modelx", "name": "Model X", "closures": ["mirror", "window", "chargePort", "liftgate", "falcon"], "lightBars": false, "previewOnly": false },
    { "id": "cybertruck", "name": "Cybertruck", "closures": ["mirror", "window", "chargePort", "liftgate"], "lightBars": true, "previewOnly": false },
    { "id": "roadster", "name": "Roadster", "closures": [], "lightBars": false, "previewOnly": true }
  ],
  "vibes": ["smooth", "party", "insane"],
  "palettes": ["neon", "sunset", "ice", "forest", "mono", "inferno", "candy"],
  "closures": ["all", "safe", "none"],
  "wraps": [{ "id": "aurora", "name": "Aurora", "preview": "https://lightcue.io/wraps/aurora.jpg" }, "…"],
  "wrapVariants": {
    "modely": [{ "id": "modely", "name": "2020–2024" }, { "id": "modely-2025-base", "name": "2025+ Standard" }, "…"],
    "…": []
  },
  "limits": { "maxCars": 12, "maxSongMinutes": 15, "maxAudioMB": 40 }
}
```

---

## POST /v1/shows

Creates a show. There are two ways to send the song.

### A. Upload the audio as the request body

Options go in the query string. `content-type` must be `audio/*`, `video/mp4` or `application/octet-stream`.

```bash
curl -X POST "https://lightcue.io/api/v1/shows?car=modelx&vibe=party&palette=sunset&closures=all&wrap=aurora&title=Wedding" \
  -H "content-type: audio/mpeg" --data-binary @song.mp3
```

### B. JSON with a link to the audio

```bash
curl -X POST https://lightcue.io/api/v1/shows \
  -H "content-type: application/json" \
  -d '{"audio_url":"https://example.com/song.mp3","cars":["modelx","modely","modely","cybertruck"],"vibe":"insane"}'
```

`audio_url` must be public `https://`. Private and internal addresses are refused, redirects are re-checked,
and the download is capped at 40 MB.

### Parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `car` | string | `modely` | Single-car show: `model3`, `modely`, `models`, `modelx`, `cybertruck`, `roadster` (preview only) |
| `cars` | string[] (query: comma-separated) | — | Fleet show, in parking order left to right, up to 12. Overrides `car`. Mixed models are allowed. Roadster can't be part of a fleet |
| `vibe` | string | `party` | `smooth` (calm, flowing), `party` (energetic), `insane` (strobes on the drops) |
| `palette` | string | `neon` | Interior colours: `neon`, `sunset`, `ice`, `forest`, `mono`, `inferno`, `candy` |
| `closures` | string | `all` | `all`: everything that can move moves. `safe`: windows, mirrors and charge port only. `none`: lights only |
| `wrap` | string | — | Add a Paint Shop wrap: `aurora`, `chrome`, `synth`, `sakura`, `carbon`, `lava` |
| `wrapVariant` (JSON) / `wrap_variant` (MCP) | string | first variant for the car | Exact body, e.g. `modely-2025-premium`. See `wrapVariants` in the catalog |
| `title` | string | `lightshow` | Show name (max 60 characters). Used for the file names |
| `seed` | integer | `1` | Change it for a different show from the same settings. The same seed always gives the same show |

### Response: `202 Accepted`

```json
{ "id": "x7Kq2mR9aB1c", "status": "queued", "title": "Wedding", "cars": ["modelx"], "vibe": "party",
  "palette": "sunset", "closures": "all", "wrap": "aurora", "wrapVariant": null, "created": 1760000000000 }
```

---

## GET /v1/shows/:id

Polls a job. `status` is one of `queued`, `analyzing`, `choreographing`, `done` or `failed`.

When `done`:

```json
{
  "id": "x7Kq2mR9aB1c",
  "status": "done",
  "cars": ["modelx"],
  "analysis": { "bpm": 124.99, "duration": 214.3, "sections": [{ "start": 0.78, "end": 14.22, "mood": "intro" }, "…"] },
  "notes": [["liftgate opens at 31.3 s and dances at the drop", "falcon doors dance once on the final chorus", "…"]],
  "validation": [{ "ok": true, "frames": 10715, "duration": 214.3, "warnings": [] }],
  "download": "https://lightcue.io/api/v1/shows/x7Kq2mR9aB1c/download",
  "preview": {
    "page": "https://lightcue.io/s/x7Kq2mR9aB1c",
    "audio": "https://lightcue.io/api/v1/shows/x7Kq2mR9aB1c/audio.mp3",
    "fseq": ["https://lightcue.io/api/v1/shows/x7Kq2mR9aB1c/car/0.fseq"]
  }
}
```

`notes` and `validation` have one entry per car. `preview.page` is a shareable page that plays the show on
the 3D car.

For Roadster jobs, `download` is `null` and `previewOnly` explains why: there's no public Roadster format
yet.

When `failed`, `error` holds a readable message.

## Show files

| Endpoint | Returns |
|---|---|
| `GET /v1/shows/:id/download` | The USB pack (`.zip`) |
| `GET /v1/shows/:id/car/:n.fseq` | The raw `.fseq` for car `n` (0-based) |
| `GET /v1/shows/:id/audio.mp3` | Preview audio |
| `GET /v1/shows/:id/analysis.json` | Full song analysis: beats, downbeats, kicks, snares, hats, sections, per-frame energy |

`404 { "error": "not ready" }` means the job isn't done yet. `404 { "error": "expired" }` means it's older
than 7 days.

---

## POST /v1/validate

Checks any `.fseq` against Tesla's rules, whether LightCue made it or not.

```bash
curl -X POST https://lightcue.io/api/v1/validate --data-binary @show.fseq
```

```json
{
  "ok": true,
  "errors": [],
  "warnings": [],
  "stats": { "frames": 10715, "stepMs": 20, "duration": 214.3, "commands": { "35": 2, "36": 2, "…": 0 } }
}
```

Checks include: FSEQ v2 header, no compression, 48 or 200 channels, step time, length, complete channel
data, and per-closure command counts against Tesla's limits.

## POST /v1/remux

Converts a short screen recording (WebM, or MP4 with Opus audio) into an MP4 with H.264 and AAC that social
platforms accept. The site uses it for "Record clip". Max 60 s, 40 MB, 30 per hour.

---

## MCP server

Endpoint: `https://lightcue.io/mcp` (streamable HTTP, stateless). No session or auth needed.

```json
{ "mcpServers": { "lightcue": { "url": "https://lightcue.io/mcp" } } }
```

### `list_options`
No input. Returns the catalog.

### `create_light_show`

| Field | Type | Notes |
|---|---|---|
| `audio_url` | string (url), **required** | https link to mp3/wav/m4a/flac, max 40 MB, max 15 min |
| `title` | string | Max 60 characters |
| `car` | enum | Single car (default `modely`) |
| `cars` | enum[] | Fleet, up to 12, in parking order |
| `vibe` | `smooth` \| `party` \| `insane` | |
| `palette` | `neon` \| `sunset` \| `ice` \| `forest` \| `mono` \| `inferno` \| `candy` | |
| `closures` | `all` \| `safe` \| `none` | |
| `wrap` | `none` \| `aurora` \| `chrome` \| `synth` \| `sakura` \| `carbon` \| `lava` | |
| `wrap_variant` | string | e.g. `modely-2025-premium` |

Returns the job (same shape as `GET /v1/shows/:id`).

### `get_light_show`
`{ id }`. Returns the job status and, when done, the download link, preview page, analysis and notes.

### `validate_fseq`
`{ fseq_url }`. Validates a `.fseq` from a public https link.

A typical agent flow:

```
user: "Make my Model X dance to this: https://…/song.mp3, go crazy"
agent → create_light_show { audio_url, car: "modelx", vibe: "insane" }
agent → get_light_show { id }   (poll every few seconds until done)
agent: "Here's your show: <download>. Preview it here: <preview.page>.
        The falcon doors open on the first drop and the charge port goes rainbow on the last one."
```

---

## Errors

Errors are `{ "error": "message" }` with a meaningful status:

| Status | When |
|---|---|
| `400` | Bad parameters (`unknown car "modelz"`), empty or unreadable audio, song too short or too long, bad `audio_url` (`audio_url must be https`, `audio_url host is not public`, `audio file is larger than 40 MB`) |
| `404` | Unknown job, file not ready, or expired |
| `413` | Upload over 40 MB |
| `429` | Rate limit |
| `400` with `busy right now` / `storage is full` | The server is at capacity. Retry later |

---

## Examples

### JavaScript

```js
const BASE = 'https://lightcue.io/api/v1';
const song = await fs.promises.readFile('song.mp3');
let job = await (await fetch(`${BASE}/shows?car=cybertruck&vibe=insane`, {
  method: 'POST', headers: { 'content-type': 'audio/mpeg' }, body: song,
})).json();
while (!['done', 'failed'].includes(job.status)) {
  await new Promise((r) => setTimeout(r, 2000));
  job = await (await fetch(`${BASE}/shows/${job.id}`)).json();
}
console.log(job.download, job.preview.page, job.notes[0]);
```

### Python

```python
import time, requests
BASE = "https://lightcue.io/api/v1"
job = requests.post(f"{BASE}/shows", json={
    "audio_url": "https://example.com/song.mp3",
    "cars": ["modely", "model3", "modely"],
    "vibe": "party", "palette": "ice",
}).json()
while job["status"] not in ("done", "failed"):
    time.sleep(2)
    job = requests.get(f"{BASE}/shows/{job['id']}").json()
open("fleet.zip", "wb").write(requests.get(job["download"]).content)
```
