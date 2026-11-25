const root = "/profile";
const profileKey = "profile";

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

function storeProfile(database, files) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction("files", "readwrite");
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.objectStore("files").put(files, profileKey);
    });
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

function matches(current, saved) {
    return current.length === saved.length && current.every(([path, data], index) => {
        const [oldPath, oldData] = saved[index];
        return path === oldPath && data.length === oldData.length &&
            data.every((value, offset) => value === oldData[offset]);
    });
}

export async function restoreProfile(fs) {
    const database = await openDatabase();
    let saved = await loadProfile(database);
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
            const current = snapshot(fs, root);
            if (!matches(current, saved)) {
                await storeProfile(database, current);
                saved = current;
            }
        } finally {
            pending = false;
        }
    };
}
