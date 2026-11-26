const { chromium } = require("playwright-core");

function trackTransition() {
    const present = window.twoTowersGpuPresent;
    let previous;
    let start;
    const sample = { durationMs: 10000, firstPresentMs: null, longestGapMs: 0, frames: 0 };
    window.twoTowersGpuPresent = (...args) => {
        const now = performance.now();
        if (start !== undefined) {
            if (previous !== undefined && previous < start + sample.durationMs)
                sample.longestGapMs = Math.max(sample.longestGapMs, now - previous);
            if (sample.firstPresentMs === null) sample.firstPresentMs = now - start;
            if (now <= start + sample.durationMs) ++sample.frames;
            else window.twoTowersGpuPresent = present;
        }
        previous = now;
        return present(...args);
    };
    return { begin() { start = performance.now(); }, sample };
}

async function benchmark() {
    const url = process.env.TT_BENCH_URL || "http://127.0.0.1:8080/?fps=60";
    const browser = await chromium.launch({
        executablePath: process.env.TT_BENCH_BROWSER,
        args: process.platform === "win32" ? ["--enable-gpu", "--use-angle=d3d11"] : ["--enable-gpu"],
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
        const waitForLog = pattern => page.waitForEvent("console", {
            predicate: message => pattern.test(message.text()),
            timeout: 300000,
        });
        const errors = [];
        const intervals = [];
        const worldTiming = [];
        let workersCreated = 0;
        page.on("worker", () => ++workersCreated);
        let inBattle = false;
        let inStory = false;
        let interval;
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
            const line = message.text();
            if (line.includes("[FILM] mont,")) inStory = true;
            if (inStory && line.includes("[FILM] over after")) inBattle = true;
            if (!inBattle) return;
            const timing = /\[FRAMETIME\].*\((\d+) steps, (\d+) frames shown\): the world moved ([\d.]+)%/.exec(line);
            if (timing) {
                worldTiming.push({
                    steps: Number(timing[1]),
                    presents: Number(timing[2]),
                    percentRealTime: Number(timing[3]),
                });
            }
            const fps = /\[FPS\] (\d+) flips, apu \d+ periods in (\d+) ms/.exec(line);
            if (fps) {
                interval = { frames: Number(fps[1]), milliseconds: Number(fps[2]) };
                intervals.push(interval);
            }
            const perf = /([\d.]+) ms waiting on the GPU or the frame clock, ([\d.]+) ms the game's code; render thread: ([\d.]+) ms.*; (\d+) draws/.exec(line);
            if (interval && perf) {
                interval.waitMs = Number(perf[1]);
                interval.gameMs = Number(perf[2]);
                interval.renderMs = Number(perf[3]);
                interval.drawsPerFrame = Number(perf[4]);
            }
        });
        const press = (key, delay = 500) => page.keyboard.press(key, { delay });
        await page.goto(url);
        const logos = waitForLog(/\[FILM\] logos,/);
        await page.getByRole("button", { name: "Play" }).click();
        await logos;
        const title = waitForLog(/\[FILM\] over after/);
        await page.waitForTimeout(2600);
        await press("k");
        await title;
        await page.waitForTimeout(6000);
        await press("Enter");
        await page.waitForTimeout(4300);
        await press("k");
        await page.waitForTimeout(3800);
        const story = waitForLog(/\[FILM\] mont,/);
        await press("k");
        await story;
        const transitionTracker = await page.evaluateHandle(trackTransition);
        const cdp = await browser.newBrowserCDPSession();
        const cpuSample = async () => ({
            processes: (await cdp.send("SystemInfo.getProcessInfo")).processInfo,
            time: performance.now(),
        });
        const handoff = waitForLog(/\[FILM\] over after/);
        if (process.argv.includes("--skip-story")) {
            await page.waitForTimeout(4000);
            await press("k");
        }
        await handoff;
        await transitionTracker.evaluate(tracker => tracker.begin());
        const cpuStart = await cpuSample();
        const usage = async () => ({
            ...await page.evaluate(() => window.twoTowersUsage()),
            workersCreated,
            liveWorkers: page.workers().length,
        });
        const movieEnd = await usage();
        await page.waitForTimeout(22000);
        for (let i = 0; i < 14; ++i) {
            await press("k", 120);
            await page.waitForTimeout(180);
        }
        await page.waitForTimeout(10000);
        await press("w", 1000);
        const battle = await usage();
        const transition = await transitionTracker.evaluate(tracker => tracker.sample);
        const cpuEnd = await cpuSample();
        const cpuCores = {};
        for (const process of cpuEnd.processes) {
            const before = cpuStart.processes.find(item => item.id === process.id && item.type === process.type);
            if (!before) continue;
            const cores = (process.cpuTime - before.cpuTime) * 1000 / (cpuEnd.time - cpuStart.time);
            cpuCores[process.type] = (cpuCores[process.type] || 0) + cores;
        }
        if (errors.length || intervals.length < 2 || !intervals.some(item => item.drawsPerFrame > 500))
            throw new Error(`Combat benchmark failed. ${errors.join("\n")}`);
        if (process.env.TT_BENCH_CAPTURE)
            await page.screenshot({ path: process.env.TT_BENCH_CAPTURE });
        console.log(JSON.stringify({ url, movieEnd, transition, battle, cpuCores, worldTiming, intervals }, null, 2));
    } finally {
        await browser.close();
    }
}

benchmark().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
