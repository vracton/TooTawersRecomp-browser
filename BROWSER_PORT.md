# Browser port development notes

These notes reconstruct the port from `84702c3`, the last desktop-only
checkpoint before the browser work, through `31e659d`, the browser profiler
checkpoint. The target is the existing USA retail single-player port, with
the original disc data, progression, movies, controls, and 4:3 framing.
[README.md](README.md) has the current build and launch commands.

## Runtime map

| Area | Implementation |
| --- | --- |
| Build | [CMake](twotowers/CMakeLists.txt) compiles the existing generated game C and runtime with Emscripten 7.0.1, pthreads, WasmFS, and SDL2. It emits `build-web/twotowers_recomp.mjs` and `.wasm` and copies the player files into the same directory. The link uses `-O1` to keep relinks practical while retaining the Release object compilation settings. The SDK pin matches the C++ WasmFS interface used by the sparse partition backend. A native executable remains available for comparison. |
| Disc | [serve.py](serve.py) validates the retail XBE hash and serves the extracted folder read-only on loopback. The default folder is the sibling `twotowers`, with `--disc` available for other locations. `/disc.json` lists lowercase relative paths, and `/disc/` serves byte ranges. [web_host.c](twotowers/src/web_host.c) mounts those files under `/game_files` with WasmFS FetchFS. The server sends the isolation headers needed for shared memory and pthreads. |
| Launch and display | [player.mjs](twotowers/web/player.mjs) waits for **Play** before resuming Web Audio, loading the Wasm module and disc manifest, restoring the profile, and calling the game entry point. [main.c](twotowers/src/main.c) selects a 640×480 render size, 4:3 framing, render scale 1, and a 30 FPS gameplay target. [player.css](twotowers/web/player.css) fits the image inside the tab with black bars. |
| Guest memory | [xbox_memory_layout.c](xboxrecomp-0.12.0/src/kernel/xbox_memory_layout.c) maps the guest ranges and GPU aliases into Wasm linear memory. `xbox_GuestAddress` translates guest pointers. The [C lowering pass](twotowers/web/lower_memory.py) converts generated `MEM8`, `MEM16`, and `MEM32` operations for the browser build so MMIO reaches the device handlers explicitly. APU DMA uses the contiguous physical aperture, and hand-written menu and prompt hooks also translate guest pointers. |
| Saves and cache | [persistence.mjs](twotowers/web/persistence.mjs) restores `/profile` from IndexedDB before game startup and snapshots it every two seconds and when the tab becomes hidden. The snapshot includes the save tree, settings, and file-backed cache entries under that root. [web_partitions.cpp](twotowers/src/web_partitions.cpp) supplies separate writable sparse raw images under `/virtual_disk` for the guest cache formatter. Those raw pages are recreated on reload. Browser profiles are scoped to the host and port. |
| Graphics | [nv2a_gl.inc](xboxrecomp-0.12.0/src/kernel/nv2a_gl.inc) drives the NV2A OpenGL renderer with [WebGL adaptations](xboxrecomp-0.12.0/src/kernel/nv2a_webgl.inc) for shaders, texture formats, drawing, and buffer uploads. The [push-buffer worker](xboxrecomp-0.12.0/src/kernel/nv2a_pb_scan.c) owns the OffscreenCanvas in the measured Edge path. A proxied WebGL mode and a software framebuffer presentation path also exist. |
| Audio and input | The [APU browser backend](xboxrecomp-0.12.0/src/apu/apu_xaudio2.c) feeds 48 kHz stereo PCM into shared Wasm memory. [pcm-player.mjs](twotowers/web/pcm-player.mjs) consumes it in an AudioWorklet. The player bridges keyboard, pointer motion and buttons, pointer lock, wheel, and focus into the existing input layer. The desktop-style settings overlay has bundled fonts. |
| Profiling | The top-right panel samples FPS over roughly one second and shows p95 frame interval over the most recent 300 presents, allocated Wasm memory, cumulative audio underruns, and the renderer. `twoTowersUsage()` exposes the counters in the console and uses the recent 300 intervals for its FPS estimate. `/?profile` enables detailed WebGL submission timings. |

The native and browser builds share the generated source contract. The
browser lowering runs on build-directory copies. After changing the runtime
template, an existing ignored generated tree can still hold an older
`recomp_types.h` until regenerated. The browser build was tested with all 38
generated C translation units in the local checkout.

## Milestones and debugging decisions

| Commits | Result |
| --- | --- |
| `dde7bc0`, `52add43`, `68739de`, `c844ed1` | Removed desktop launcher and packaging targets, added the local disc server, built the Recomp output as Wasm, and connected Play and IndexedDB. |
| `b3d6f35`, `eafa71c` | Backed the guest address space and aliases with Wasm memory, lowered MMIO accesses, and brought up software framebuffer display, input, and PCM output. |
| `238005b`, `825662e` | First exposed sparse partition images over HTTP. The retail formatter writes to the cache devices, so the second checkpoint moved raw partitions to a writable sparse in-memory WasmFS backend. This avoided allocating the partitions' full logical sizes. |
| `6dcc411`, `9093f63`, `d5318fb` | Corrected APU DMA address translation, rendered the **first WebGL 2 frames** in `9093f63`, and repaired guest pointers in hand-written menus and adaptive prompts. |
| `73303d2`, `42227e6`, `6792196` | Moved PCM consumption off the browser main thread and gave the push-buffer worker ownership of the WebGL canvas. Added pointer capture, relative cursor handling, fonts, and stalled-submission diagnostics. |
| `4d5fe41`, `1ae1f2a` | Added CPU-side WebGL phase timing and removed the synchronous error query from each browser present. Repeated zero-duration guest delays now park briefly on Wasm workers. This reduced busy polling. The first benchmark still measured about 9 FPS in the transition into the real-time prologue. |
| `0f17b8c`, `b1f3704` | Gave each WebGL uniform block an independent stream buffer, eliminating the worst recurring upload stalls on the tested ANGLE D3D11 path. Reused vertex attribute enable state across hardware draws and recorded a run through live combat. |
| `f00e48c` | Restored the startup `logos.bik` movie. The guest save probe overwrote the flag used by the startup film branch after the port's earlier menu hook had set it. The fix applies the default at the startup lookup after the probe, while preserving the existing `TT_FIRSTRUN_PROLOGUE` and explicit developer override behavior. |
| `31e659d` | Set the full game name as the tab title and added the collapsible profiler. Its pointer toggle preserves canvas keyboard focus. |

Two rendering experiments were discarded. Giving geometry its own fresh
buffer on every draw left the earlier prologue sample near 9 FPS. Changing
ANGLE backends in headless Edge selected SwiftShader on the test machine and
lowered the later sample to about 7 FPS. The uniform-buffer change addressed
the recurring stall with the existing hardware path. The software run also
paused during the opening sequence when the test sent Enter, so its timing
has limited value as a gameplay comparison.

## Verification and performance

- The Wasm build and Windows native reference built successfully. The disc
  manifest and byte-range checks passed, including invalid ranges and path
  traversal rejection. A fresh browser did not load the game module or
  create its audio context until **Play**.
- In Edge, the game reached the title, main menu, difficulty selection,
  New Game on Normal, the skippable `mont.bik` story movie, and the opening
  battle with the HUD and keyboard movement. After the startup movie fix,
  separate no-input runs played `logos.bik` in about 19 seconds and reached
  the title. The profiler was checked at 1366×768 and 390×844 in Edge.
- A synthetic binary file in the save tree and an INI file round-tripped
  through IndexedDB after reload. This covers the storage path. Creating a
  campaign save through gameplay and loading it again remains unverified.

The benchmark used headless Edge with hardware-accelerated ANGLE D3D11 on
Windows and an AMD Radeon 780M. The mixed browser route was measured before
the startup logo restoration. It took about 99 seconds and reached live
combat. The first frame arrived about 6.5 seconds after the module and
profile were ready. Title and menu were around 46 FPS. The final 300 battle
presents averaged 21.9 FPS with a 63 ms p95 interval. In one sampled
10-second battle segment, simulation time kept pace with wall time.

| Resource | Recorded result |
| --- | --- |
| Browser linear memory | 442.5 MiB by the battle |
| Browser process CPU time | About 256 renderer CPU-seconds and 205 GPU-process CPU-seconds over the 99-second route |
| Browser audio | 1,319 cumulative worklet underruns over the full mixed run |
| Native reference | Around 60 FPS in the title and menu at 640×480, 56 CPU-seconds over a 26-second sample, and a 389 MiB working set |

Browser linear memory is the Wasm allocation size. The GPU-process number is
CPU time for that process. The native numbers cover a shorter, different
route and are useful as a reference for that route. Sustained 30 FPS in
combat, the source of audio gaps, later levels, physical controller behavior,
and full desktop parity remain open.

### Local evidence and reproduction

The build logs, browser logs, and captures were kept in ignored build
directories. Useful files, when present in the checkout, include
`build-web/final-play.log`, `build-web/uniform-play.log`,
`build-web/upload-play.log`, `build-web/gl-play.log`,
`build-web/startup-film-verified.log`, `build-web/profiler-ui.log`, and
`build-reference/usage.csv`.

For a fresh run, build and serve as described in the README. After clicking
**Play**, leave input alone until the logo movie finishes. The console emits
`[FILM] logos` and `[FILM] over after ...`, followed by the title/menu load.
Enter advances from the title. With the default WASD preset, K accepts
**New Game** and **Normal** and can skip `mont.bik` while it plays. Let the
real-time cutscene run through before testing movement. Enter can pause the
opening battle, which changes the performance sample. `/?profile`, the
on-screen profiler, and separate browser-process measurements can be used
to compare the same section before and after a change.

## Frame pacing work

The default gameplay target remains 30 FPS. The performance target is
sustained 60 FPS in actual combat with the higher ceiling used to expose
headroom. Bink movies keep their original pacing.

### Movie reads

The browser mounts `fmv` separately with 1 MiB FetchFS chunks. The other
disc files still use 256 KiB chunks. The loopback server now recognizes the
repeated slash that FetchFS inserts between the movie mount URL and the file
name. It still looks up files in the validated disc manifest.

On the Radeon 780M in hardware-accelerated Edge, the startup logo movie
used 13 successful range GETs, compared with about 49 256 KiB chunks for
the same file. It finished in 19.7 seconds with zero audio underruns in the
12-second sample. The first 22 seconds of `mont.bik` produced 28.1 FPS over
the latest 300 frames, 47.5 ms p95, and one new audio worklet underrun.
These samples verify playback and measure stalls. Direct agreement between
the video frames and the audio track was measured separately below. Local
logs are `build-web/climb-verified.log` and `build-web/climb-server-main.log`.

### Movie clock

Bink frames were also waiting for the emulated console's vblank counter.
The browser now uses a monotonic deadline based on the Bink frame index and
encoded rate for the movie's own frame wait. A late frame can catch up to
the scheduled deadline. The guest's GPU completion wait still runs, and
gameplay keeps its own pacing. The startup and story assets inspected both
encode 29.97 FPS.

A separate Edge run recorded AudioWorklet output and sampled rendered
frames from `logos.bik`. Matching both tracks against the local Bink asset
put the strongest baseline matches around 0.7 seconds of audio lead at
9.5 and 13.4 seconds. After the clock change, five strong matches from
3.6 to 12.9 seconds ranged from 30 ms of audio lag to 120 ms of audio lead.
These are estimates from timed screenshots and audio correlation. Capture
latency limits the precision. Local comparisons are `build-web/climb-av-before.log`
and `build-web/climb-av-after.log`. Long movies under load and later chapters
still need the same check.
