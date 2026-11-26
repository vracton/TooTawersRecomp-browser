const root = "/profile";
const profileKey = "profile";
const saveRoot = `${root}/saves/UDATA/45410010`;
const savePrefix = `${saveRoot.toLowerCase()}/`;
const slotPattern = /^[\da-f]{12}$/i;
const filenamePattern = /^[a-z\d_-][a-z\d_. -]{0,79}$/i;
const backupFormat = "twotowers-save-v1";
const invalidSave = "Choose a Two Towers .xsv save or a .ttsave backup.";

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("twotowers-recompiled", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("files");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function loadProfile(database) {
    return new Promise((resolve, reject) => {
        const request = database.transaction("files").objectStore("files").get(profileKey);
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
    });
}

function updateProfile(database, update) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction("files", "readwrite");
        const store = transaction.objectStore("files");
        const request = store.get(profileKey);
        let error;
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(error ?? transaction.error);
        request.onsuccess = () => {
            try {
                store.put(update(request.result ?? []), profileKey);
            } catch (cause) {
                error = cause;
                transaction.abort();
            }
        };
    });
}

function slotFromPath(path) {
    if (!path.toLowerCase().startsWith(savePrefix)) {
        return null;
    }
    const [slot, ...parts] = path.slice(savePrefix.length).split("/");
    return slotPattern.test(slot) && parts.length ? { slot, name: parts.join("/") } : null;
}

function describeSave(slot, files) {
    const meta = files.find(([name]) => name.toLowerCase() === "savemeta.xbx")?.[1];
    const label = readSaveName(meta);
    const parts = label && /^(.*) - (\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2}):(\d{2})(am|pm)$/i.exec(label);
    if (!parts) {
        return { slot, name: label || `Save ${slot}`, files };
    }
    const [, name, month, day, year, hour, minute, period] = parts;
    const savedAt = new Date(Date.UTC(2000 + Number(year), Number(month) - 1, Number(day),
        Number(hour) % 12 + (period.toLowerCase() === "pm" ? 12 : 0), Number(minute)));
    return { slot, name, savedAt, files };
}

function readSaveName(meta) {
    return meta && /^Name=([^\r\n\0]+)/im.exec(new TextDecoder("utf-16le").decode(meta))?.[1].trim();
}

function makeSaveMeta(file) {
    const filename = file.name.replace(/\.(xsv|ttsave)$/i, "");
    const name = /^(game|save)$/i.test(filename) ? "Imported Save" :
        filename.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40) || "Imported Save";
    const date = new Date(file.lastModified || Date.now());
    const hour = date.getUTCHours();
    const year = String(date.getUTCFullYear()).slice(-2);
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const time = `${hour % 12 || 12}:${minutes}${hour < 12 ? "am" : "pm"}`;
    const text = `\uFEFFName=${name} - ${date.getUTCMonth() + 1}/${date.getUTCDate()}/${year} ${time}\r\n`;
    const bytes = new Uint8Array(text.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < text.length; ++i) view.setUint16(i * 2, text.charCodeAt(i), true);
    return bytes;
}

async function readBackup(file) {
    let backup;
    try {
        backup = JSON.parse(await file.text());
    } catch {
        throw new Error(invalidSave);
    }
    if (backup?.format !== backupFormat || typeof backup.slot !== "string" ||
        !slotPattern.test(backup.slot) || !Array.isArray(backup.files)) throw new Error(invalidSave);
    const names = new Set();
    const files = backup.files.map(entry => {
        if (!Array.isArray(entry) || entry.length !== 2) throw new Error(invalidSave);
        const [name, encoded] = entry;
        if (typeof name !== "string" || !name.split("/").every(part => filenamePattern.test(part)) ||
            typeof encoded !== "string" || names.has(name.toLowerCase())) throw new Error(invalidSave);
        names.add(name.toLowerCase());
        try {
            return [name, Uint8Array.from(atob(encoded), char => char.charCodeAt(0))];
        } catch {
            throw new Error(invalidSave);
        }
    });
    return { preferredSlot: backup.slot, files };
}

async function readNativeSave(file, companions) {
    const files = [["game.xsv", new Uint8Array(await file.arrayBuffer())]];
    const allowed = ["SaveMeta.xbx", "SaveImage.xbx"];
    for (const companion of companions) {
        const name = allowed.find(candidate => candidate.toLowerCase() === companion.name.toLowerCase());
        if (!name || files.some(([existing]) => existing === name)) throw new Error(invalidSave);
        files.push([name, new Uint8Array(await companion.arrayBuffer())]);
    }
    return { files };
}

export async function openSaveLibrary() {
    const database = await openDatabase();
    return {
        async list() {
            const slots = new Map();
            for (const [path, data] of await loadProfile(database)) {
                const file = slotFromPath(path);
                if (!file) continue;
                const files = slots.get(file.slot) ?? [];
                files.push([file.name, data]);
                slots.set(file.slot, files);
            }
            return Array.from(slots, ([slot, files]) => describeSave(slot, files))
                .filter(save => save.files.some(([name]) => name.toLowerCase() === "game.xsv"))
                .sort((a, b) => (b.savedAt?.getTime() ?? 0) - (a.savedAt?.getTime() ?? 0) ||
                    a.slot.localeCompare(b.slot));
        },
        remove(slot) {
            return updateProfile(database, files =>
                files.filter(([path]) => slotFromPath(path)?.slot.toLowerCase() !== slot.toLowerCase()));
        },
        async upload(selection) {
            const source = selection.find(file => /\.(xsv|ttsave)$/i.test(file.name));
            if (!source || selection.reduce((size, file) => size + file.size, 0) > 2 * 1024 * 1024)
                throw new Error(invalidSave);
            const { preferredSlot, files: imported } = /\.xsv$/i.test(source.name) ?
                await readNativeSave(source, selection.filter(file => file !== source)) :
                await readBackup(source);
            if (preferredSlot && selection.length !== 1) throw new Error(invalidSave);
            const gameEntry = imported.find(([name]) => name.toLowerCase() === "game.xsv");
            const game = gameEntry?.[1];
            if (!game || game.length <= 24 || new DataView(game.buffer).getUint32(0, true) !== game.length)
                throw new Error(invalidSave);
            gameEntry[0] = "game.xsv";
            const meta = imported.find(([name]) => name.toLowerCase() === "savemeta.xbx");
            if (meta) {
                meta[0] = "SaveMeta.xbx";
                if (!readSaveName(meta[1])) meta[1] = makeSaveMeta(source);
            } else {
                imported.push(["SaveMeta.xbx", makeSaveMeta(source)]);
            }
            const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", game));
            const slotId = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
                .join("").toUpperCase();
            await updateProfile(database, files => {
                const occupied = new Set();
                for (const [path] of files) {
                    const entry = slotFromPath(path);
                    if (entry) occupied.add(entry.slot.toUpperCase());
                }
                let slot = preferredSlot ?? slotId(hash.subarray(0, 6));
                while (occupied.has(slot.toUpperCase())) {
                    slot = slotId(crypto.getRandomValues(new Uint8Array(6)));
                }
                return files.concat(imported.map(([name, data]) => [`${saveRoot}/${slot}/${name}`, data]));
            });
        },
    };
}

export function exportSave({ slot, files }) {
    return new Blob([JSON.stringify({
        format: backupFormat,
        slot,
        files: files.map(([name, data]) => {
            let binary = "";
            for (const byte of data) binary += String.fromCharCode(byte);
            return [name, btoa(binary)];
        }),
    })], { type: "application/json" });
}

function snapshot(fs, directory) {
    const files = [];
    for (const name of fs.readdir(directory)) {
        if (name === "." || name === ".." || name.endsWith(".tmp")) {
            continue;
        }
        const path = `${directory}/${name}`;
        const stat = fs.stat(path);
        const type = stat.mode & 0o170000;
        if (type === 0o040000) {
            files.push(...snapshot(fs, path));
        } else if (type === 0o100000) {
            const stream = fs.open(path, "r");
            try {
                const data = new Uint8Array(stat.size);
                const length = data.length ? fs.read(stream, data, 0, data.length) : 0;
                files.push([path, data.subarray(0, length)]);
            } catch (error) {
                throw new Error(`Cannot read ${path} (errno ${error.errno ?? "unknown"})`, { cause: error });
            } finally {
                fs.close(stream);
            }
        }
    }
    return files.sort(([a], [b]) => a.localeCompare(b));
}

export async function restoreProfile(fs) {
    const database = await openDatabase();
    let saved = new Map(await loadProfile(database));
    fs.mkdirTree(root);
    for (const [path, data] of saved) {
        fs.mkdirTree(path.slice(0, path.lastIndexOf("/")));
        fs.writeFile(path, data);
    }

    let pending = false;
    return async function flush() {
        if (pending) {
            return;
        }
        pending = true;
        try {
            const current = new Map(snapshot(fs, root));
            const changes = new Map();
            for (const path of saved.keys()) {
                if (!current.has(path)) changes.set(path, null);
            }
            for (const [path, data] of current) {
                const previous = saved.get(path);
                if (!previous || data.length !== previous.length ||
                    data.some((value, offset) => value !== previous[offset])) changes.set(path, data);
            }
            if (changes.size) {
                await updateProfile(database, files => {
                    const updated = new Map(files);
                    for (const [path, data] of changes) {
                        if (data === null) updated.delete(path);
                        else updated.set(path, data);
                    }
                    return [...updated];
                });
                saved = current;
            }
        } finally {
            pending = false;
        }
    };
}
