import { restoreProfile } from "./persistence.mjs";

const canvas = document.querySelector("#canvas");
const launch = document.querySelector("#launch");
const play = document.querySelector("#play");
const status = document.querySelector("#status");

function showStatus(message) {
    launch.hidden = false;
    status.hidden = false;
    status.textContent = message;
}

play.addEventListener("click", async () => {
    play.hidden = true;
    showStatus("Starting the game…");
    try {
        if (!crossOriginIsolated) {
            throw new Error("The page needs cross-origin isolation. Start it with serve.py.");
        }
        const Audio = window.AudioContext ?? window.webkitAudioContext;
        if (Audio) {
            const audio = new Audio({ sampleRate: 48000 });
            globalThis.twoTowersAudio = audio;
            await audio.resume();
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
        globalThis.twoTowersUsage = () => ({ wasmMemoryBytes: game.HEAPU8.byteLength });
        launch.hidden = true;
        canvas.focus();
        game.callMain([]);
    } catch (error) {
        showStatus(error.message);
    }
}, { once: true });
