import { restoreProfile } from "./persistence.mjs";
import { startAudio } from "./audio.mjs";

const canvas = document.querySelector("#canvas");
const launch = document.querySelector("#launch");
const play = document.querySelector("#play");
const status = document.querySelector("#status");

function showStatus(message) {
    launch.hidden = false;
    status.hidden = false;
    status.textContent = message;
}

function connectCanvas(game) {
    const context = canvas.getContext("2d", { alpha: false });
    let image;
    let frames = 0;
    let previousFrame;
    const intervals = [];
    const started = performance.now();
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
        ++frames;
        if (previousFrame !== undefined) {
            intervals.push(now - previousFrame);
            if (intervals.length > 300) {
                intervals.shift();
            }
        }
        previousFrame = now;
    };

    globalThis.twoTowersUsage = () => {
        const ordered = [...intervals].sort((a, b) => a - b);
        const sum = ordered.reduce((total, interval) => total + interval, 0);
        return {
            frames,
            firstFrameSeen: frames > 0,
            runningMs: Math.round(performance.now() - started),
            recentFps: sum ? 1000 * ordered.length / sum : null,
            frameTimeP95Ms: ordered[Math.floor(ordered.length * 0.95)] ?? null,
            wasmMemoryBytes: game.HEAPU8.byteLength,
            audioUnderruns: globalThis.twoTowersAudioOutput?.underruns() ?? null,
        };
    };
}

function connectInput(game) {
    canvas.addEventListener("focus", () => game._xbox_WebFocus(1));
    canvas.addEventListener("blur", () => game._xbox_WebFocus(0));
    window.addEventListener("blur", () => game._xbox_WebFocus(0));
    window.addEventListener("focus", () => game._xbox_WebFocus(document.activeElement === canvas));
    for (const type of ["keydown", "keyup"]) {
        canvas.addEventListener(type, (event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) {
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
        canvas.setPointerCapture(event.pointerId);
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
    play.hidden = true;
    showStatus("Starting the game…");
    try {
        if (!crossOriginIsolated) {
            throw new Error("The page needs cross-origin isolation. Start it with serve.py.");
        }
        const Audio = window.AudioContext ?? window.webkitAudioContext;
        const audio = Audio ? new Audio({ sampleRate: 48000 }) : null;
        globalThis.twoTowersAudio = audio;
        if (audio) {
            await audio.resume();
            globalThis.twoTowersAudioOutput = await startAudio(audio);
        }
        const [wasm, response] = await Promise.all([
            import("./twotowers_recomp.mjs"),
            fetch("/disc.json"),
        ]);
        if (!response.ok) {
            throw new Error("Could not open the configured disc folder.");
        }
        const files = await response.json();
        const game = await wasm.default({
            canvas,
            noInitialRun: true,
            onAbort: (error) => showStatus(`The game stopped. ${error}`),
            onExit: (code) => showStatus(`The game exited with code ${code}.`),
            print: (line) => console.log(line),
            printErr: (line) => console.error(line),
        });
        game.FS.writeFile("/disc-manifest", files.join("\n") + "\n");
        const flush = await restoreProfile(game.FS);
        const persist = () => flush().catch((error) => console.error("Could not save browser data", error));
        setInterval(persist, 2000);
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                persist();
            }
        });
        connectCanvas(game);
        connectInput(game);
        launch.hidden = true;
        canvas.focus();
        game.callMain([]);
    } catch (error) {
        showStatus(error.message);
    }
}, { once: true });
