# The Two Towers Recompiled

A native PC port of *The Lord of the Rings: The Two Towers* (Xbox, USA, 2002), made by static recompilation. It uses your own USA Xbox disc image or extracted disc folder.

This checkout runs the retail single-player campaign with PC controls and display options. The retail roster and difficulty choices are available through the original progression. Keyboard and mouse, modern controllers, movie skipping, and the settings overlay remain available.

See [RETAIL_PORT.md](RETAIL_PORT.md) for the feature inventory, implementation notes, and verification. [CHANGES.md](CHANGES.md) records earlier upstream releases.

## Generating the game code

Use Python 3.10 or newer and your own extracted USA retail Xbox disc.

```sh
python generate.py path/to/extracted/game
```

## Desktop reference build

The native executable is available for checking browser behavior against the desktop
port. On Windows with LLVM-MinGW, configure and build it with CMake and Ninja.

```sh
cmake -S twotowers -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
cmake --build build
```

Run the executable with your extracted disc files in a `game_files` directory
beside it. The OpenGL and controller paths also require `SDL2.dll` on Windows.
