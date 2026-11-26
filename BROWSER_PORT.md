# Browser port development notes

These notes reconstruct the port from `84702c3`, the last desktop-only
checkpoint before the browser work, through `31e659d`, the browser profiler
checkpoint. The target is the existing USA retail single-player port, with
the original disc data, progression, movies, controls, and 4:3 framing.
[README.md](README.md) has the current build and launch commands.

## Runtime map

| Area | Implementation |
| --- | --- |
| Build | [CMake](twotowers/CMakeLists.txt) compiles the existing generated game C and runtime with Emscripten 7.0.1, pthreads, WasmFS, and SDL2. It emits `build-web/twotowers_recomp.mjs` and `.wasm` and copies the player files into the same directory. Release links use `-O2`; other configurations use `-O1`. The SDK pin matches the C++ WasmFS interface used by the sparse partition backend. A native executable remains available for comparison. |
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

In the subsequent 120 FPS headroom run, `logos.bik` finished in 18.08 seconds
against its encoded 18.02 seconds. A 22-second `mont.bik` sample averaged
29.94 FPS with 52.5 ms p95 and zero new audio underruns. This measures pace
and output starvation for the story movie. The track correlation above
covers the startup movie.

### Live combat headroom

`/?fps=60` and `/?fps=120` select the corresponding existing guest pacing
modes for testing. Either option can be combined with `profile`. With no
query parameter, launch still targets stock 30 FPS gameplay. The movie
clock uses the encoded rate in every mode.

The OpenGL renderer now resolves guest vertex bases once per packed draw.
On WebGL 2, supported interleaved float and normalized-byte layouts can be
uploaded directly with rebased indices. Other layouts retain the previous
conversion path. An indexed recent-texture lookup avoids a linear scan on
repeated hits and validates the full texture key before using an entry.

In the opening battle with `/?profile&fps=60`, about half of hardware draws
in the heavy samples used the direct vertex path. CPU vertex packing in
those samples was around 2 ms per frame. The run still averaged 19.8 FPS
over the final 300 frames. The renderer and game thread both took more
than the 16.7 ms budget in heavier combat. This measurement was made before
adding the recent-texture lookup and the movie clock change. Local results
are in `build-web/climb-raw-play.log`.

With the recent-texture lookup and movie clock in place, the 120 FPS cap
run averaged 22.2 FPS over its final 300 battle frames with 69.6 ms p95 and
442.5 MiB of Wasm linear memory. Near the end, vertex packing was about
1.1–1.4 ms at roughly 900–1,050 draws per frame. The render thread still
took about 21–25 ms per frame and the game thread spent about 26–41 ms in
game code. The simulation clock kept pace with wall time in the sampled
segment. The current bottlenecks span both threads. The cap runs cover
slightly different combat states, so the difference in overall FPS is not
an isolated estimate of the renderer changes. See `build-web/climb-paced-play.log`.

The generated browser RAM helpers now check the low 64 MiB first and take
the direct load or store path there. MMIO and high-address aliases still
use the existing handlers. After rebuilding the generated game, the
default-cap run with detailed WebGL timing disabled averaged 27.1 FPS in
the final 300 battle frames with 47.9 ms p95 and 442.5 MiB of Wasm memory.
The startup movie finished in 18.11 seconds. The 22-second story sample
averaged 29.98 FPS with zero audio worklet underruns. There were 132
cumulative underruns by combat. See `build-web/climb-default-play.log`.

A V8 worker profile during the battle attributed about 315 ms of a
four-second sample to JavaScript stack capture. Reading host return
addresses in the interrupt-priority code triggered that work on Wasm.
The browser now skips those host-only diagnostic addresses. Guest call
history and the interrupt level logic are preserved. In two fast-start
120 FPS cap runs with detailed WebGL timing disabled, the final 300 battle
frames went from 39.4 FPS and 46.5 ms p95 to 63.4 FPS and 31.7 ms p95.
Earlier portions still dropped below 60 FPS. The samples have different
combat activity, so peak capacity is clearer than the exact speedup. See
`build-web/climb-headroom-play.log` and `build-web/climb-irql-play.log`.

Browser workers now use a bounded blocking mutex wait for the dispatch
lock. Previously, a contender polled the lock and eventually slept for a
millisecond between attempts. The same recursive lock and two-second
watchdog remain. The corresponding 120 FPS cap run averaged 69.0 FPS over
the final 300 battle frames, with 23.6 ms p95 and 442.5 MiB Wasm memory.
In the final seconds, the game and render threads each spent about 10–11 ms
on their respective work. Each of the final ten one-second intervals ran
between 65.2 and 74.9 FPS. A separate 60 FPS cap run averaged 59.9 FPS
over its final 300 frames with 30.9 ms p95. Earlier combat still dropped
below 60 FPS, and p95 exceeded the 16.7 ms budget in both cap runs. See
`build-web/climb-dispatch-play.log` and `build-web/climb-cap60-play.log`.

The same build with the default settings averaged 30.0 FPS over the final
300 battle frames with 46.9 ms p95, 442.5 MiB linear memory, and 141
cumulative audio underruns. The game's 10-second simulation sample kept
pace with real time. These fast-start tests skipped the movies after a few
seconds and entered battle on Normal. They complement the separate movie
sync measurements above. See `build-web/climb-final-default-play.log`.

## First-level frame pacing

The browser accepts `/?fps=unlocked`. F10 also opens the display settings
from the focused game canvas. A keyboard test launched with the 30 FPS
default, opened F10, and selected Unlocked on the Frame rate row. A second
launch selected Unlocked directly from the URL. Its ceiling is 1000 FPS.

On a fast-start Normal run, the browser's frame-complete watchdog logged
waits of 2.07 and 4.07 seconds around the opening battle. Browser recovery
now checks for 32 ms with an empty render queue, no queued GPU callback,
and no change in pushbuffer run. It rechecks under the guest dispatch lock
before releasing the guest's frame or flush wait. In a separate run the
frame recovery fired after 39 and 44 ms in the frontend. First-time 3D
submission still stalled with no recovery logged. See the local
`build-web/combat-stream-play.log` and `build-web/combat-fence-play.log`.

WebGL now advances the same texture-check clock as D3D11. Static art is
checked in staggered groups, and linear movie textures retain their
per-pushbuffer checks. The renderer reuses unchanged texture bindings,
samplers, uniform-buffer bindings and vertex-array state. It rebuilds
texture-stage state for each new pushbuffer and for draws that sample a
render target. Successful reads no longer flush a console message by
default. `RECOMP_READ_TRACE` restores that trace.

On Edge with the Radeon 780M, the 60 FPS run in `build-web/combat-final-play.log`
averaged 59.8 FPS over its last 300 presents, with 31.1 ms p95, 442.5 MiB
of Wasm memory and 903 cumulative audio underruns. The busiest intervals
around 1,400–1,700 draws per frame ran at 26–49 FPS. Two first-level
presents took 2.60 and 4.48 seconds. From story playback through the
battle sample, Edge's renderer and GPU processes consumed 2.87 and 3.38
CPU cores on average. These are process CPU times divided by elapsed time.
The isolated runs reached different enemy counts as the battle progressed.

Earlier experiments combined shadow-shader warmup, eager Wasm heap growth,
alternative worker waits and different linker settings. Their last-300
averages ranged from 26.1 to 50.5 FPS. They did not establish an advantage
in the crowded scene and were dropped.

### Natural movie-to-battle transition

With the 60 FPS option on the Radeon 780M in Edge, the story movie ended
after 179.1 seconds at 30.0 FPS over its last 300 presents. In the first
interval with battlefield geometry, five frames took 1,085 ms (4.6 FPS).
The game thread averaged 97.8 ms of game code and 117.8 ms of waiting per
frame. The render worker averaged 153.5 ms over 928 draws per frame. The
next interval reached 15.7 FPS. The last 300 combat presents averaged
38.9 FPS with a 34.2 ms p95. Wasm memory was 442.5 MiB at movie end and
at the combat sample. Cumulative audio underruns rose from 14 to 366.
The local capture is `build-web/combat-natural-play.log`.

This run used Wasm SIMD in the GPU command interpreter, immutable WebGL
texture storage, and deferred mipmap generation until a draw samples the
mip chain. Writes to the vertex constant bank also mark it for upload,
so draws with unchanged constants skip a 3 KiB comparison. All timings
above include these changes.

With the development server running and `playwright-core` available to
Node, run `node twotowers/web/benchmark.cjs` from the repository root.
Set `TT_BENCH_BROWSER` to the Edge or Chromium executable and optionally
`TT_BENCH_URL` to the player URL (the default selects 60 FPS). The run
lets the story finish, enters the first battle, sends attack and movement
input, and emits JSON containing resource samples and frame intervals.
`--skip-story` measures entry after a skip, which exercises a different
loading schedule.

The Release link reduced the module from 30.77 to 25.97 MB. On its own
it still produced single-present intervals of 1.12 and 2.03 seconds at
the natural transition. WebGL now reuses the vertex shader lookup until
the guest program changes and checks each pending shader or program at
most once every 2 ms while the driver compiles it. In the next natural
run, the first interval over 500 draws per frame reached 10.4 FPS
(11 presents in 1,058 ms, 936 draws per frame). The last 300 presents
averaged 59.7 FPS with a 31.3 ms p95. Intervals above 1,400 draws ranged
from 53 to 60 FPS. Enemy count and compilation timing vary between runs.
See `build-web/combat-O2-natural.json` and
`build-web/combat-shader-poll-natural.json`.

The Win32 compatibility layer previously created joinable host threads
and signaled its own completion handles. Nothing joined the pthreads, so
Emscripten kept their workers and stacks after exit. Host threads now
start detached. The compatibility handle continues to carry the exit
code and wait signal independently of the browser worker's lifetime.

In the natural run before this change, Edge had 123 live workers at
movie end and 142 after combat. With detached threads it had 19 at both
samples, and the Wasm heap went from 442.5 to 368.75 MiB. The first
battlefield intervals still recorded three frames in 1.00 seconds and
five in 1.34 seconds. Combat ended at 59.6 FPS over 300 presents with a
30.8 ms p95 and 890 cumulative audio underruns. The resource improvement
reproduced independently of movie timing. See
`build-web/combat-detached-natural.json`.

The benchmark also reports live and cumulative worker counts, CPU cores
by browser process type during combat, and the longest gap between
main-thread GPU present notifications crossing the first ten seconds
after the movie-end event. `TT_BENCH_CAPTURE` optionally names a PNG to
save at the final combat sample.

WebGL retains the offsets of short triangle index lists in its streaming
element buffer. It checks the full list before reuse and invalidates all
offsets when the buffer gets fresh storage. In one profiled combat
interval, 35,083 of 45,927 draws reused their uploaded indices. In
`build-web/combat-reuse-natural.json`, the first ten seconds after the
movie had 251 presents and a 610 ms longest gap. Ten intervals above
1,400 draws ranged from 51.8 to 60.4 FPS. The last 300 presents averaged
59.5 FPS with a 30.9 ms p95. Edge's renderer and GPU processes averaged
2.84 and 3.31 CPU cores over the measured transition and combat.

### Eliminating duplicate pixel shader compilation at the cut

A Chromium GPU trace starting just before a story skip recorded 12
overlapping ANGLE `D3DCompile` calls with byte-identical 16,309-byte
HLSL source for the general pixel shader. Those calls took 7.89–8.96
seconds each on background threads. As each new vertex shader appeared,
the WebGL renderer was linking it with the general fragment shader while
its specialized program was still being prepared.

During compilation the browser now uses the already-linked general
program and the existing CPU vertex transform. It switches to the GPU
vertex program as soon as the specialized pair is ready. A permanently
failed or disabled specialization still permits a general fragment shader
paired with that GPU vertex program.

Repeating the traced skip on Edge/D3D11 produced zero compiles of that
HLSL source during the handoff. Summed wall time in all overlapping
`D3DCompile` calls fell from 102.69 to 1.74 seconds; this is a sum over
workers. The longest interval between present notifications during the
first ten seconds fell from 1,304 to 125 ms, with 437 presents instead of
129. These measurements include tracing overhead. The captures are
`build-web/combat-handoff-profile.json`, `build-web/combat-shared-shader-profile.json`
and the corresponding local Chromium traces.

When the 179-second movie ended naturally with detailed tracing off, the
first ten seconds went from 251 to 502 presents, and the longest gap
fell from 610 to 303 ms. The first interval over 500 draws per frame
rose from 12.8 to 30.8 FPS (985 draws per frame on the new run). The
following interval reached 58.9 FPS. The last 300 combat presents
averaged 59.9 FPS, but intervals above 1,400 draws still ran at 46–59 FPS.
At 1,608 draws the game thread took 19.0 ms of game code and the render
worker took 16.5 ms per frame. The final sample showed 368.75 MiB of
Wasm memory, 19 workers and two cumulative audio underruns. See
`build-web/combat-shared-shader-natural.json`.

### Timer and guest CPU costs in the Isildur fight

A four-second worker CPU profile triggered at 1,400 draws per frame
found two workers spending most of their samples reading clocks or
yielding. Browser performance counters now read Emscripten's monotonic
clock directly with the same nanosecond counter frequency. The 500 Hz
kernel timer waits on a Wasm atomic until its deadline or a GPU callback
wakes it.

In the next 60 FPS natural run the renderer process averaged 2.65 CPU
cores over the transition and combat, down from 3.73. This run ended at
54.1 FPS with a 34.3 ms p95. The five intervals above 1,400 draws ran
at 42.9–55.0 FPS, and the final audio underrun count was four. The
timer change reduced processor demand; this pair of runs did not show
a frame-rate improvement. See `build-web/combat-clock-natural.json`.

Generated game code now uses Wasm SIMD for its packed vertex and matrix
operations. Aligned 64 MiB guest address regions have a direct host
lookup, including the low RAM mirrors and both views of physical RAM.
Device registers and irregular mappings retain their original handlers.
Unaligned 16-byte vector accesses wholly within one mapped bank use one
copy. Cross-bank accesses retain their individual lane translations. A
Wasm smoke test checked physical/tiled aliases, the split between
physical banks, unaligned loads and stores, and MMIO dispatch. The new
Release module is 35.64 MB, up from 25.97 MB.

The natural run in `build-web/combat-bank-natural.json` still used the
original 60 FPS limiter. At 1,658 draws it averaged 14.8 ms in game
code, 14.3 ms on the render worker and 6.0 ms waiting for the GPU or
clock (46.9 FPS). Across all fifteen intervals above 1,400 draws it
reached 46.9–56.8 FPS. In separate four-second busy-scene CPU profiles,
the game thread spent 441 ms in the guest address translation function
before the change and had zero samples there afterward. The two CPU
profiles used different caps and did not follow identical enemy movement.
