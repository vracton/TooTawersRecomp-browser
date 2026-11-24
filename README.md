# The Two Towers Recompiled

A native PC port of *The Lord of the Rings: The Two Towers* (Xbox, USA, 2002), made by static recompilation. It uses your own USA Xbox disc image or extracted disc folder.

This checkout runs the retail single-player campaign with PC controls and display options. The retail roster and difficulty choices are available through the original progression. Keyboard and mouse, modern controllers, movie skipping, and the settings overlay remain available.

See [RETAIL_PORT.md](RETAIL_PORT.md) for the feature inventory, implementation notes, and verification. [CHANGES.md](CHANGES.md) records earlier upstream releases.

## Building from source

The game's code is not included. You translate it from **your own copy** of the game, then compile it. Nothing leaves your machine.

**You need:** Python 3.10+, CMake 3.20+ and Ninja, plus a compiler for your platform (below).

**1. Translate the game** (every platform). Point it at your extracted disc folder or its `default.xbe`. It checks that the file is the USA retail game and takes a few minutes:

    python generate.py "path/to/extracted/game"

**2. Build for your platform:**

- **Windows**: install [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) and put its `bin` folder on your PATH, then run:

      cmake -S twotowers -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
      cmake --build build

  This gives you `build/twotowers_recomp.exe` and `build/The Two Towers Recompiled.exe`. Copy both into a folder, together with `SDL2.dll` and the optional `dxvk` folder if you use the Vulkan renderer.
  *Cross-compiling from Linux or WSL* (how the releases are made): with llvm-mingw on your PATH, configure with
  `-DCMAKE_TOOLCHAIN_FILE=$PWD/xboxrecomp-0.12.0/cmake/mingw-w64-x86_64.cmake` instead of the two compiler options.

- **Linux**: install a compiler and SDL2's development files, e.g. `sudo apt install build-essential cmake ninja-build libsdl2-dev` (on Fedora: `sudo dnf install gcc-c++ cmake ninja-build SDL2-devel`), then run:

      cmake -S twotowers -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
      cmake --build build

  This gives you `build/twotowers_recomp` and `build/twotowers-setup`. Put them in a folder with `twotowers/linux/TwoTowers.sh` and run that.

- **macOS** (Intel, or Apple silicon through Rosetta 2): install the Xcode command line tools (`xcode-select --install`), then `brew install cmake ninja sdl2 python`. On Apple silicon, SDL2 must come from an x86-64 Homebrew: `arch -x86_64 /usr/local/bin/brew install sdl2`. Then run:

      sh twotowers/macos/build-macos.sh

  It builds into `build-macos/TwoTowers-Recompiled`, with SDL2 copied into `lib`. Double-click `TwoTowers.command` there.

**3. Play:** on first start the game asks for your disc image, or copy your extracted game into `game_files` beside the program.

