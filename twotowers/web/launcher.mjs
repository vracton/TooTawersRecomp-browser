import { exportSave, openSaveLibrary } from "./persistence.mjs";

const preferencesKey = "twotowers-launch-settings";
const frameRates = ["30", "60", "unlocked"];
const holdMs = 900;
const saveDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
});

async function loadMenuFont() {
    try {
        const response = await fetch("/launcher-font.json");
        if (!response.ok) return null;
        const font = await response.json();
        const atlas = new Image();
        atlas.src = `data:image/png;base64,${font.atlas}`;
        await atlas.decode();
        return { ...font, atlas };
    } catch {
        return null;
    }
}

const menuFont = loadMenuFont();

function drawMenuText(element, font) {
    const text = element.textContent;
    const glyphs = Array.from(text, character => font.glyphs[character.codePointAt(0) - font.first]);
    if (!glyphs.length || glyphs.some(glyph => !glyph) || element.querySelector(".menu-lettering")) return;
    const width = glyphs.reduce((sum, glyph) => sum + glyph[4], 2);
    const canvas = document.createElement("canvas");
    const smoothTitle = element.classList.contains("launcher-title");
    const scale = smoothTitle ? 1 : 2;
    canvas.width = width * scale;
    canvas.height = font.height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    let x = 0;
    for (const [left, top, right, bottom, advance] of glyphs) {
        const w = right - left;
        const h = bottom - top;
        if (w && h) ctx.drawImage(font.atlas, left, top, w, h, x, 0, w, h);
        x += advance;
    }
    const lettering = document.createElement("span");
    lettering.className = "menu-lettering";
    lettering.setAttribute("aria-hidden", "true");
    lettering.style.setProperty("--lettering-width", `${width / font.height}em`);
    const mask = smoothTitle ? smoothTitleMask(canvas) : canvas;
    lettering.style.maskImage = `url(${mask.toDataURL()})`;
    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = text;
    element.replaceChildren(label, lettering);
}

function smoothTitleMask(source) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width * 4;
    canvas.height = source.height * 4;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < image.data.length; i += 4) {
        image.data[i] = (image.data[i] - 26) * 1.26;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}

menuFont.then(font => {
    if (font) document.querySelectorAll("[data-menu-text]").forEach(element => drawMenuText(element, font));
});

function preferences() {
    try {
        return JSON.parse(localStorage.getItem(preferencesKey)) ?? {};
    } catch {
        return {};
    }
}

export function connectLaunchSettings(query) {
    const slider = document.querySelector("#frame-limit");
    const stops = slider.parentElement.querySelector(".fps-stops").children;
    const profiler = document.querySelector("#show-profiler");
    const overrideNote = document.querySelector("#fps-override");
    const stored = preferences();
    const requested = query.get("fps");
    const explicit = frameRates.indexOf(requested);
    const initial = explicit >= 0 ? explicit : frameRates.indexOf(stored.fps);
    let override = requested === "120";
    slider.value = initial >= 0 ? initial : slider.defaultValue;
    profiler.checked = stored.profiler === true;

    function showFrameRate() {
        const fps = frameRates[slider.value];
        for (const [index, stop] of Array.from(stops).entries()) {
            stop.classList.toggle("selected", !override && index === slider.valueAsNumber);
        }
        slider.setAttribute("aria-valuetext", fps === "unlocked" ? "Unlocked" : `${fps} FPS`);
        if (override) slider.setAttribute("aria-describedby", overrideNote.id);
        else slider.removeAttribute("aria-describedby");
        overrideNote.hidden = !override;
    }

    function remember(changes) {
        try {
            localStorage.setItem(preferencesKey, JSON.stringify({ ...preferences(), ...changes }));
        } catch (error) {
            console.warn("Could not remember launcher settings", error);
        }
    }

    slider.addEventListener("input", () => {
        override = false;
        showFrameRate();
        remember({ fps: frameRates[slider.value] });
    });
    profiler.addEventListener("change", () => remember({ profiler: profiler.checked }));
    showFrameRate();
    return () => ({ fps: override ? "120" : frameRates[slider.value], profiler: profiler.checked });
}

function download(save) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(exportSave(save));
    link.download = `${save.name.replace(/[^a-z\d_-]+/gi, "-")}-${save.slot}.ttsave`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function connectHold(button, action) {
    let timer;
    function cancel() {
        clearTimeout(timer);
        timer = undefined;
        button.classList.remove("holding");
    }

    function start() {
        if (timer !== undefined) return;
        button.classList.add("holding");
        timer = setTimeout(() => {
            cancel();
            action();
        }, holdMs);
    }

    button.style.setProperty("--hold-duration", `${holdMs}ms`);
    button.addEventListener("pointerdown", event => {
        if (event.isPrimary && event.button === 0) start();
    });
    for (const type of ["pointerup", "pointerleave", "pointercancel", "blur", "contextmenu"]) {
        button.addEventListener(type, cancel);
    }
    button.addEventListener("keydown", event => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) start();
    });
    button.addEventListener("keyup", cancel);
    button.addEventListener("contextmenu", event => event.preventDefault());
}

export async function connectSaveLibrary() {
    const play = document.querySelector("#play");
    const upload = document.querySelector("#upload-save");
    const input = document.querySelector("#save-file");
    const list = document.querySelector("#save-list");
    const empty = document.querySelector("#save-empty");
    const count = document.querySelector("#save-count");
    const message = document.querySelector("#save-message");
    const template = document.querySelector("#save-row");

    function showSaveError(text) {
        message.textContent = text;
        message.hidden = !text;
    }

    function setEmptyText(text) {
        if (empty.textContent === text) return;
        empty.textContent = text;
        menuFont.then(font => { if (font) drawMenuText(empty, font); });
    }

    try {
        const library = await openSaveLibrary();
        let changing = false;

        async function edit(operation) {
            if (changing) return;
            changing = true;
            upload.disabled = play.disabled = true;
            showSaveError("");
            try {
                await operation();
                await refresh();
            } catch (error) {
                showSaveError(error.message || "Could not update your saves.");
            } finally {
                changing = false;
                upload.disabled = play.disabled = false;
            }
        }

        async function refresh() {
            const saves = await library.list();
            const rows = saves.map(save => {
                const row = template.content.firstElementChild.cloneNode(true);
                const name = row.querySelector("strong");
                name.textContent = save.name;
                name.title = save.name;
                menuFont.then(font => { if (font) drawMenuText(name, font); });
                const time = row.querySelector("time");
                if (save.savedAt) {
                    time.dateTime = save.savedAt.toISOString();
                    time.textContent = saveDate.format(save.savedAt).replace(/\s/g, " ");
                    menuFont.then(font => { if (font) drawMenuText(time, font); });
                } else {
                    time.hidden = true;
                }
                const get = row.querySelector(".download-save");
                get.setAttribute("aria-label", `Download ${save.name}`);
                get.addEventListener("click", () => download(save));
                const remove = row.querySelector(".delete-save");
                remove.setAttribute("aria-label", `Hold to delete ${save.name}`);
                connectHold(remove, async () => {
                    await edit(() => library.remove(save.slot));
                    if (!remove.isConnected) upload.focus();
                });
                return row;
            });
            list.replaceChildren(...rows);
            list.hidden = !saves.length;
            empty.hidden = !!saves.length;
            count.hidden = saves.length <= 3;
            count.textContent = `(${saves.length})`;
            setEmptyText("No saves");
        }

        await refresh();
        upload.disabled = false;
        upload.addEventListener("click", () => input.click());
        input.addEventListener("change", () => {
            const files = Array.from(input.files);
            input.value = "";
            if (files.length) edit(() => library.upload(files));
        });
        window.addEventListener("focus", () => {
            if (changing || document.querySelector("#launch").hidden ||
                document.querySelector(".launcher").hidden || list.contains(document.activeElement)) return;
            refresh().catch(() => showSaveError("Could not refresh your saves."));
        });
    } catch {
        setEmptyText("Could not open your browser saves.");
    }
}
