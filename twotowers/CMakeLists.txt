cmake_minimum_required(VERSION 3.20)

# ============================================================================
# The Lord of the Rings: The Two Towers (Xbox, USA) -- static recompilation
#
# src/recomp/gen/ is generated from YOUR copy of default.xbe by
# ../generate.py before configuring; see ../README.md.
# ============================================================================

project(twotowers_recomp C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Reproducible, path-free binaries: no build-machine paths in __FILE__ /
# debug info, no link timestamp.
get_filename_component(TT_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
if(MINGW OR CMAKE_C_COMPILER_ID MATCHES "Clang|GNU")
    add_compile_options("-ffile-prefix-map=${TT_REPO_ROOT}=." "-ffile-prefix-map=${CMAKE_BINARY_DIR}=build")
endif()
if(MINGW)
    add_link_options(-Wl,--no-insert-timestamp)
elseif(MSVC)
    add_link_options(/Brepro)
    add_compile_options(/Brepro)
endif()

# Common definitions
add_compile_definitions(
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    ${TT_EXTRA_DEFS}
    # The Two Towers' image (with .data BSS) ends at 0x009194E0; move the
    # runtime's stack / TLS / kernel-data block above it (also applies to the
    # toolkit libraries built by add_subdirectory below).
    XBOX_LOW_AREA_BASE=0x00920000
)

# ── xboxrecomp toolkit ──────────────────────────────────────────
#
# Option A: xboxrecomp as a subdirectory (simplest)
#   Place xboxrecomp/ next to your game project and use a relative path.
#
# Option B: find_package (if you install xboxrecomp system-wide)
#   find_package(xboxrecomp REQUIRED)
#
# Adjust this path to point to your xboxrecomp clone:
set(XBOXRECOMP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../xboxrecomp-0.12.0" CACHE PATH
    "Path to the xboxrecomp toolkit root directory")

# Add xboxrecomp as a subdirectory -- this builds all 6 runtime libraries
# and provides the 'xboxrecomp' umbrella target to link against.
add_subdirectory(${XBOXRECOMP_DIR} ${CMAKE_BINARY_DIR}/xboxrecomp)

# ── Recompiled game executable ──────────────────────────────────

# Collect generated recompiled code.
# The recomp pipeline outputs files into src/recomp/gen/.
# With --split 1000, you get gen_0000.c, gen_0001.c, etc.
# CONFIGURE_DEPENDS so re-running the recompiler picks up added/removed files
# without a manual re-configure. A plain GLOB is evaluated once at configure
# time, so a newly generated file (an extra chunk, recomp_stubs_unresolved.c)
# is silently left out of the build and shows up as unresolved externals.
file(GLOB RECOMP_GEN_SOURCES CONFIGURE_DEPENDS "src/recomp/gen/*.c")

# Core game sources
set(GAME_SOURCES
    src/main.c
    src/recomp_manual.c
    src/twotowers_manual.c
    src/heroes.c
    src/retail_hooks.c
    src/menus.c
    src/prompts.c
    src/options.c
    # Add game-specific sources here, e.g.:
    # src/asset_loader.c
    # src/custom_renderer.c
)

# The recomp pipeline also generates a dispatch header and function declarations.
# These are included by the generated .c files:
#   src/recomp/gen/recomp_funcs.h    - extern declarations for all recompiled functions
#   src/recomp/recomp_dispatch.h     - binary search dispatch table
#   src/recomp/recomp_types.h        - register model, ICALL macros, MEM helpers

add_executable(${PROJECT_NAME} WIN32
    ${GAME_SOURCES}
    ${RECOMP_GEN_SOURCES}
)
# (1.9.5) the game code's sin/cos/tan: our own (src/rc_fastmath.h), four
# times as fast as the C library's x87 versions with the same accuracy.
set_property(SOURCE ${RECOMP_GEN_SOURCES} src/heroes.c src/twotowers_manual.c APPEND PROPERTY COMPILE_OPTIONS
    "-include" "${CMAKE_CURRENT_SOURCE_DIR}/src/rc_fastmath.h")

# Link against the xboxrecomp umbrella target (all 6 runtime libraries)
target_link_libraries(${PROJECT_NAME} PRIVATE xboxrecomp)

# Include paths for generated recomp headers
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/src/recomp
    ${XBOXRECOMP_DIR}/include
)

if(WIN32)
    # Windows SDK libraries needed at link time
    # (d3d11.dll and dxgi.dll are loaded at run time: the system's, or
    # DXVK's for renderer=vulkan -- xboxrecomp src/platform/d3d11_dyn.h)
    target_link_libraries(${PROJECT_NAME} PRIVATE
        dxguid
        xinput
        winmm
        # Lets the fault handler resolve the host RIP back to the generated
        # function's symbol, i.e. to the guest function that faulted.
        dbghelp
        bcrypt
    )
else()
    # Linux: SDL2 (window, OpenGL context, sound, controllers); OpenGL itself
    # is loaded at run time through SDL.
    find_package(SDL2 REQUIRED)
    target_link_libraries(${PROJECT_NAME} PRIVATE SDL2::SDL2 ${CMAKE_DL_LIBS} m pthread)
    target_compile_options(${PROJECT_NAME} PRIVATE -Wno-incompatible-pointer-types
        -Wno-int-conversion -Wno-format)
    # A few guest functions carry the names of the C library's (the XDK CRT's
    # close/write/lseek/isatty): in one ELF executable they would take the
    # place of the real ones for the host code and for every shared library.
    # The generated code gets them under other names, and nothing in the
    # executable is exported to the libraries it loads.
    set(TT_GUEST_RENAMES "close=tt_guest_close;write=tt_guest_write;lseek=tt_guest_lseek;isatty=tt_guest_isatty")
    set_source_files_properties(${RECOMP_GEN_SOURCES} src/twotowers_manual.c src/recomp_manual.c
        PROPERTIES COMPILE_DEFINITIONS "${TT_GUEST_RENAMES}")
    if(APPLE)
        # macOS (Intel, or Apple silicon through Rosetta 2: the build is
        # x86-64 -- see the README's macOS section). Mach-O's two-level
        # namespace already keeps the executable's symbols from the
        # libraries; the translated code nests deeply on the main thread's
        # stack (64 MB, as on Windows); SDL2 from lib/ beside the program
        # (or Homebrew's).
        target_link_options(${PROJECT_NAME} PRIVATE -Wl,-stack_size,0x4000000
            -Wl,-rpath,@executable_path/lib -Wl,-rpath,@executable_path/../Frameworks
            -Wl,-rpath,/usr/local/lib -Wl,-rpath,/opt/homebrew/lib)
        set_target_properties(${PROJECT_NAME} PROPERTIES SKIP_BUILD_RPATH ON)
    else()
        file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/exe_exports.map" "{ local: *; };\n")
        target_link_options(${PROJECT_NAME} PRIVATE "-Wl,--version-script=${CMAKE_CURRENT_BINARY_DIR}/exe_exports.map")
        # optional bundled libraries live in lib/ beside the executable; only
        # that (not the build tree's library paths) goes into the binary
        set_target_properties(${PROJECT_NAME} PROPERTIES
            BUILD_WITH_INSTALL_RPATH ON INSTALL_RPATH "$ORIGIN/lib")
    endif()
endif()

# MSVC-specific: large address aware, increase section limit for big generated files
if(MSVC)
    target_link_options(${PROJECT_NAME} PRIVATE
        /LARGEADDRESSAWARE
        /STACK:67108864     # translated code nests deeply on the native stack
    )
    # The generated code files can be very large. Increase object file section limit.
    target_compile_options(${PROJECT_NAME} PRIVATE /bigobj)
endif()

# ── Game-specific additions ─────────────────────────────────────
#
# Add any game-specific libraries, loaders, or custom renderers below.
# Examples:
#
# # Custom texture loader for your game's format
# target_sources(${PROJECT_NAME} PRIVATE src/texture_loader.c)
#
# # If your game uses RenderWare, you may need a RW bridge layer
# target_sources(${PROJECT_NAME} PRIVATE src/rw_bridge.c)
#
# # Additional compile definitions for debugging
# target_compile_definitions(${PROJECT_NAME} PRIVATE
#     ENABLE_ICALL_TRACE=1
#     VERBOSE_KERNEL_LOG=1
# )

set_target_properties(${PROJECT_NAME} PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
# Use the bundled C++ runtime on older Linux systems.
if(UNIX AND NOT APPLE)
    target_link_options(${PROJECT_NAME} PRIVATE -static-libstdc++ -static-libgcc)
endif()
# MinGW (cross) builds: equivalents of the MSVC options above.
if(MINGW)
    target_compile_options(${PROJECT_NAME} PRIVATE -Wno-incompatible-pointer-types
        -Wno-int-conversion -Wno-parentheses-equality)
    # Translated code nests deeply on the native stack.
    target_link_options(${PROJECT_NAME} PRIVATE -Wl,--stack,67108864 -static)
endif()
