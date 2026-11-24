# Retail campaign port

This checkout starts from upstream `96c1623` (v2.0.3) and runs the single-player campaign from the USA retail Xbox disc. `CHANGES.md` and Git history document the upstream versions. Use the current README to build this checkout.

## Removed from the runnable port

| Area | Scope |
|---|---|
| ECTS 2002 HUD and orange pickups | Removed both independent switches, the demo HUD implementation and bundled art, and the pickup recoloring and custom texture-hash list. |
| Extra Heroes | Disabled the campaign roster override, unlock modes, guest asset substitution, added progress records, and character-specific models, moves, UI, and sounds. The original four heroes and Isildur's retail unlock still use the disc's data. The old Sauron sprint setting is gone. |
| Local co-op | Removed the front-end entry and activation paths, including direct launch switches. Disabled multiplayer devices and campaign changes for extra players, bots, separate progress and HUDs, shared camera, teleport, companion replacement, extra enemies, double pickups, balance, and co-op mission gating. |
| Versus | Removed local Deathmatch, Team Deathmatch, Free-for-all, Troll Battle, and the Find the Shield test path. This includes the added arena rules, scores, results, records, audio, and related HUD. |
| Online | Removed the network implementation and menu entry, including lobbies, chat, synchronized input, votes, session saves, and the path that re-enabled Extra Heroes. |
| Impossible | Removed the fourth choice, damage rules, and preferences. The three retail difficulty choices remain clickable. |
| Achievements | Removed pop-ups, F10 page and switch, event tracking, and achievement file I/O. |
| Extra credits music | Removed loading and playback of the second and third tracks. Kept the existing frame-rate correction for the retail credits. |
| Ultra textures | Removed the launcher and overlay settings, the texture builder, and pack data. Disabled high-resolution substitutions for menus, fonts, HUD, and the external GameCube pack. |
| Added languages | Removed the game and launcher language settings, packs, asset and string redirection, dynamic font upscaling, and regional pack builders. The current UI uses the retail USA text and existing English PC labels. |

Existing INI keys for retired options are ignored. Existing disc files, save files, and user-installed sidecars can stay where they are. The old upstream source archive and co-op bot suite are available in Git history.

## Retained PC features

- Keyboard and mouse bindings, Walk, clickable menus, cursor size and sensitivity, mouse aiming and steering, keyboard/mouse entry of the retail Secret Codes, and pause/menu input fixes.
- Modern controllers, rebinding, rumble, stick dead zones, adaptive button prompts, and original Xbox controls. Platform controller support remains in the runtime.
- First-view movie skipping, original films and audio, original campaign enemies and companions, retail mission availability, retail cheat behavior, and the original save format.
- Disc setup and validation, separate PC save directory and migration, PC launcher, desktop/window controls, main-menu Exit, Display and Controls options, and F10 settings including the FPS counter.
- Renderer and platform support, including Direct3D 11, OpenGL, optional DXVK, and software paths. Kept internal resolution, widescreen, framing options for HUD, menus, films, and cutscenes, higher frame-rate modes, antialiasing, filtering, display calibration and post-processing, and focus-related audio or pause behavior.
- Existing timing, graphics, animation, audio, memory, input, and crash fixes. Kept developer diagnostics and the generic scripted-input, texture-dump, and direct-level tools.

## Implementation notes

- The generated game functions and hand-written wrappers share dispatch entries and guest state. Preserve those contracts when editing them. Mixed multiplayer and hero wrapper code remains where carving it out could change the retail call path. Its mode entry points return the solo or off state regardless of legacy settings.
- `twotowers/src/retail_hooks.c` supplies neutral results to callers of deleted modules. Its file hook always falls through to the original disc path. Keep the per-level reset it calls because it also resets the retail Fangorn cutscene fix.
- Renderer texture substitutions stay off at the renderer boundary. The ordinary texture decoder, cache, renderer fixes, and prompt textures remain in use.
- Some internal graphics IDs remain reserved because the guest options and renderer share their numbering. They have no user-facing mod controls.
- Future language support can be recovered from Git history. Reintroduce it with its own asset and font tests rather than restoring unrelated hero or Versus redirections with it.

## Verification

- Windows Release built with LLVM-MinGW and the existing generated USA game code. The game and Windows launcher linked successfully.
- Smoke tests ran from temporary folders pointed at the extracted retail disc. Legacy INI settings and environment flags attempted to enable the removed modes. Only Easy, Normal, and Expert were visible. The game loaded the retail prologue in solo mode and performed the level reset.
- A separate scripted controller run navigated the main menu to Exit and closed the game with exit code 0.
- The existing manual scanner self-test passed all seven checks.
- Linux and macOS launcher scripts were syntax-checked. Linux and macOS binaries were outside this Windows run.
