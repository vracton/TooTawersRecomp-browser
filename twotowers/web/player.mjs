import { restoreProfile } from "./persistence.mjs";
import { startAudio } from "./audio.mjs";
import { connectLaunchSettings, connectSaveLibrary } from "./launcher.mjs";

const canvas = document.querySelector("#canvas");
const gpuCanvas = document.querySelector("#gpu-canvas");
const launch = document.querySelector("#launch");
const play = document.querySelector("#play");
const starting = document.querySelector("#starting");
const status = document.querySelector("#status");
const profiler = document.querySelector("#profiler");
const query = new URLSearchParams(location.search);
const launchSettings = connectLaunchSettings(query);
connectSaveLibrary();

function showStatus(message) {
    starting.hidden = true;
    launch.hidden = false;
    status.hidden = false;
    status.textContent = message;
}

function connectCanvas(game) {
    const context = canvas.getContext("2d", { alpha: false });
    let image;
    let frames = 0;
    let firstFrame;
    let renderer = "software";
    let pointerFlags = 0;
    let previousFrame;
    const intervals = [];
    const started = performance.now();
    function recordFrame(now) {
        const nextFlags = game._xbox_WebPointerFlags();
        if (nextFlags !== pointerFlags) {
            pointerFlags = nextFlags;
            canvas.style.cursor = pointerFlags & 2 ? "none" : "";
            if (!(pointerFlags & 1) && document.pointerLockElement === canvas) {
                document.exitPointerLock();
            }
        }
        if (firstFrame === undefined) {
            firstFrame = now;
            launch.hidden = true;
            starting.hidden = true;
        }
        ++frames;
        if (previousFrame !== undefined) {
            intervals.push(now - previousFrame);
            if (intervals.length > 300) {
                intervals.shift();
            }
        }
        previousFrame = now;
    }
    globalThis.twoTowersGpuPresent = (workerOwned) => {
        if (!gpuCanvas.classList.contains("active")) {
            gpuCanvas.classList.add("active");
            renderer = workerOwned ? "webgl2-worker" : "webgl2";
        }
        recordFrame(performance.now());
    };
    globalThis.twoTowersPresent = (address, width, height, memory) => {
        const now = performance.now();
        if (!image || width !== image.width || height !== image.height) {
            canvas.width = width;
            canvas.height = height;
            image = context.createImageData(width, height);
        }
        const pixels = new Uint32Array(image.data.buffer);
        const base = address >>> 2;
        for (let index = 0; index < pixels.length; ++index) {
            const color = memory[base + index];
            pixels[index] = 0xff000000 | ((color & 0xff) << 16) |
                (color & 0xff00) | ((color >>> 16) & 0xff);
        }
        context.putImageData(image, 0, 0);
        recordFrame(now);
    };

    function readUsage() {
        const ordered = [...intervals].sort((a, b) => a - b);
        const sum = ordered.reduce((total, interval) => total + interval, 0);
        return {
            frames,
            firstFrameMs: firstFrame === undefined ? null : Math.round(firstFrame - started),
            runningMs: Math.round(performance.now() - started),
            recentFps: sum ? 1000 * ordered.length / sum : null,
            frameTimeP95Ms: ordered[Math.floor(ordered.length * 0.95)] ?? null,
            wasmMemoryBytes: game.HEAPU8.byteLength,
            audioUnderruns: globalThis.twoTowersAudioOutput?.underruns() ?? null,
            renderer,
        };
    }

    globalThis.twoTowersUsage = readUsage;
    return readUsage;
}

function connectProfiler(readUsage) {
    const renderers = {
        software: "Software",
        webgl2: "WebGL 2",
        "webgl2-worker": "WebGL 2 (worker)",
    };
    const fields = Object.fromEntries(
        [...profiler.querySelectorAll("[data-metric]")].map(field => [field.dataset.metric, field]),
    );
    let timer;

    function display(usage, fps) {
        const values = {
            fps: fps === null ? "—" : fps.toFixed(1),
            frameTime: usage.frameTimeP95Ms === null ? "—" : `${usage.frameTimeP95Ms.toFixed(1)} ms`,
            memory: `${(usage.wasmMemoryBytes / (1024 * 1024)).toFixed(1)} MiB`,
            underruns: usage.audioUnderruns?.toLocaleString() ?? "—",
            renderer: usage.frames ? renderers[usage.renderer] : "—",
        };
        for (const [metric, value] of Object.entries(values)) {
            if (fields[metric].textContent !== value) {
                fields[metric].textContent = value;
            }
        }
    }

    function updateSampling() {
        clearInterval(timer);
        if (!profiler.open || document.hidden) {
            return;
        }

        let previous = readUsage();
        display(previous, null);
        timer = setInterval(() => {
            const usage = readUsage();
            const elapsed = usage.runningMs - previous.runningMs;
            const fps = usage.frames && elapsed > 0 ? 1000 * (usage.frames - previous.frames) / elapsed : null;
            display(usage, fps);
            previous = usage;
        }, 1000);
    }

    profiler.querySelector("summary").addEventListener("pointerdown", event => {
        if (document.activeElement === canvas) {
            event.preventDefault();
        }
    });
    profiler.addEventListener("toggle", updateSampling);
    document.addEventListener("visibilitychange", updateSampling);
    profiler.hidden = false;
    updateSampling();
}

function connectInput(game) {
    canvas.addEventListener("focus", () => game._xbox_WebFocus(1));
    canvas.addEventListener("blur", () => game._xbox_WebFocus(0));
    window.addEventListener("blur", () => game._xbox_WebFocus(0));
    window.addEventListener("focus", () => game._xbox_WebFocus(document.activeElement === canvas));
    for (const type of ["keydown", "keyup"]) {
        canvas.addEventListener(type, (event) => {
            if (type === "keydown" && event.key !== "Control" && event.key !== "Alt" &&
                (event.altKey || event.ctrlKey || event.metaKey)) {
                return;
            }
            if (event.keyCode) {
                event.preventDefault();
                game._xbox_WebKey(event.keyCode, type === "keydown");
            }
        });
    }
    for (const type of ["pointermove", "pointerenter", "pointerleave"]) {
        canvas.addEventListener(type, (event) => {
            const bounds = canvas.getBoundingClientRect();
            const sx = canvas.width / bounds.width;
            const sy = canvas.height / bounds.height;
            game._xbox_WebMouse(
                Math.floor((event.clientX - bounds.left) * sx),
                Math.floor((event.clientY - bounds.top) * sy),
                Math.round(event.movementX * sx),
                Math.round(event.movementY * sy),
                type !== "pointerleave",
            );
        });
    }
    canvas.addEventListener("pointerdown", (event) => {
        canvas.focus();
        if (document.pointerLockElement !== canvas) {
            canvas.setPointerCapture(event.pointerId);
            if (game._xbox_WebPointerFlags() & 1) {
                canvas.requestPointerLock?.()?.catch(() => {});
            }
        }
        game._xbox_WebMouseButton(event.button, 1);
    });
    canvas.addEventListener("pointerup", (event) => game._xbox_WebMouseButton(event.button, 0));
    canvas.addEventListener("pointercancel", () => game._xbox_WebFocus(0));
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        game._xbox_WebWheel(-Math.sign(event.deltaY));
    }, { passive: false });
}

play.addEventListener("click", async () => {
    const settings = launchSettings();
    launch.querySelector(".launcher").hidden = true;
    starting.hidden = false;
    try {
        if (!crossOriginIsolated) {
            throw new Error("The page needs cross-origin isolation. Start it with serve.py.");
        }
        const Audio = window.AudioContext ?? window.webkitAudioContext;
        const audio = Audio ? new Audio({ sampleRate: 48000 }) : null;
        globalThis.twoTowersAudio = audio;
        await audio?.resume();
        const [wasm, response] = await Promise.all([
            import("./twotowers_recomp.mjs"),
            fetch("/disc.json"),
        ]);
        if (!response.ok) {
            throw new Error("Could not open the configured disc folder.");
        }
        const files = await response.json();
        const game = await wasm.default({
            canvas: gpuCanvas,
            noInitialRun: true,
            onAbort: (error) => showStatus(`The game stopped. ${error}`),
            onExit: (code) => showStatus(`The game exited with code ${code}.`),
            print: (line) => console.log(line),
            printErr: (line) => console.error(line),
        });
        if (audio) {
            globalThis.twoTowersAudioOutput = await startAudio(audio, game);
        }
        game.FS.writeFile("/disc-manifest", files.join("\n") + "\n");
        const flush = await restoreProfile(game.FS);
        const persist = () => flush().catch((error) => console.error("Could not save browser data", error));
        setInterval(persist, 2000);
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                persist();
            }
        });
        const readUsage = connectCanvas(game);
        if (settings.profiler) connectProfiler(readUsage);
        connectInput(game);
        canvas.focus();
        const args = [`--fps=${settings.fps}`];
        if (query.has("profile")) {
            args.push("--profile-webgl");
        }
        game.callMain(args);
    } catch (error) {
        showStatus(error.message);
    }
}, { once: true });
