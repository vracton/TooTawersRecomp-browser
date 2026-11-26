# The Two Towers Recompiled

A browser port of *The Lord of the Rings: The Two Towers* (Xbox, USA, 2002), made by static recompilation. It runs from your extracted USA Xbox disc folder.

This checkout runs the retail single-player campaign with PC controls and display options. The retail roster and difficulty choices are available through the original progression. Keyboard and mouse, modern controllers, movie skipping, and the settings overlay remain available.

See [RETAIL_PORT.md](RETAIL_PORT.md) for the feature inventory, implementation notes, and verification. [CHANGES.md](CHANGES.md) records earlier upstream releases.
[BROWSER_PORT.md](BROWSER_PORT.md) records the browser architecture, development milestones, and verification gaps.

## Generating the game code

Use Python 3.10 or newer and your own extracted USA retail Xbox disc.

```sh
python generate.py path/to/extracted/game
```

## Browser build

Activate [Emscripten SDK 7.0.1](https://emscripten.org/docs/getting_started/downloads.html)
and build with CMake and Ninja. The browser build uses this version's WasmFS
interface for the game's sparse raw partitions.

```sh
emcmake cmake -S twotowers -B build-web -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build-web
python serve.py --disc path/to/extracted/game
```

Open `http://127.0.0.1:8080` and click **Play**. The server defaults to the
sibling `twotowers` disc folder and serves it on loopback. The launcher
remembers the frame-rate and profiler settings. **Saves** reads the campaign
slots from IndexedDB. Download a slot as a `.ttsave` file to share it.
**Upload** accepts these backups and existing `.xsv` files. To keep an Xbox
save's original name, date or image, select its `SaveMeta.xbx` or
`SaveImage.xbx` alongside the `.xsv`. Hold a slot's × button to delete it.
Use the same host and port to keep using the same browser profile.

## Browser verification and performance

The top-right **Profiler** updates once a second with FPS, 95th-percentile
frame time, allocated Wasm memory, audio underruns, and the active renderer.
Click its heading to collapse or reopen it.

Run `window.twoTowersUsage()` in the browser console after launching to see
time to the first frame, FPS and 95th-percentile frame interval across the
last 300 presents, Wasm linear memory, and audio underruns. Load `/?profile`
for per-frame WebGL submission timings in the console. Those timings measure
CPU-side submission and any waits it encounters. Use the browser profiler to
measure process CPU and memory separately. `/?fps=60` uses unlocked guest
timing and caps presentation at 60 FPS. `/?fps=120` selects the 120 FPS
gameplay cap. `/?fps=unlocked` selects the same
Unlocked mode as **Frame rate** in the in-game display settings (F10), with a
1000 FPS ceiling. The default gameplay target is 30 FPS.

On Windows with Edge and an AMD Radeon 780M, the browser reached the retail
title screen, main menu, Normal difficulty, the skippable Bink intro, and
the first playable battle with keyboard movement. A binary file in the save
directory and an INI file survived a reload through IndexedDB. Campaign
completion and a save created from gameplay are still unverified.

| Sample | Result |
| --- | --- |
| Browser startup | First frame in 6.5 s after the Wasm module was ready |
| Browser title and menu | Around 46 FPS |
| Browser opening battle | 21.9 FPS over the last 300 presents, 63 ms at the 95th percentile |
| Browser mixed run | 256 renderer CPU-seconds and 205 GPU-process CPU-seconds over 99 wall-clock seconds, 442.5 MiB of Wasm linear memory by the battle |
| Native title and menu sample | Around 60 FPS at 640×480, 56 CPU-seconds over 26 wall-clock seconds, 389 MiB working set |

The samples cover different parts of the game. In a sampled 10-second battle
segment, the game clock kept pace with real time while rendering below its
30 FPS target. The earlier browser profile measured 9.0 FPS and 605 ms at the
95th percentile during the transition into the real-time prologue. Giving
WebGL uniform blocks separate buffers removed the worst recurring upload
stalls. That baseline run logged 1,319 audio worklet underruns across startup,
menus, intro, and battle.

## Desktop reference build

The native executable is available for checking browser behavior against the desktop
port. On Windows with LLVM-MinGW, configure and build it with CMake and Ninja.

```sh
cmake -S twotowers -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
cmake --build build
```

Run the executable with your extracted disc files in a `game_files` directory
beside it. The OpenGL and controller paths also require `SDL2.dll` on Windows.
