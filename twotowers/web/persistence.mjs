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
        if ((fs.stat(path).mode & 0o170000) === 0o040000) {
            files.push(...snapshot(fs, path));
        } else {
            files.push([path, fs.readFile(path)]);
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
