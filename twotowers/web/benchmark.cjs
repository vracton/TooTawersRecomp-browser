const { chromium } = require("playwright-core");

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
        let inBattle = false;
        let inStory = false;
        let interval;
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
            const line = message.text();
            if (line.includes("[FILM] mont,")) inStory = true;
            if (inStory && line.includes("[FILM] over after")) inBattle = true;
            if (!inBattle) return;
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
        const handoff = waitForLog(/\[FILM\] over after/);
        if (process.argv.includes("--skip-story")) {
            await page.waitForTimeout(4000);
            await press("k");
        }
        await handoff;
        const usage = () => page.evaluate(() => window.twoTowersUsage());
        const movieEnd = await usage();
        await page.waitForTimeout(22000);
        for (let i = 0; i < 14; ++i) {
            await press("k", 120);
            await page.waitForTimeout(180);
        }
        await page.waitForTimeout(10000);
        await press("w", 1000);
        const battle = await usage();
        if (errors.length || intervals.length < 2 || !intervals.some(item => item.drawsPerFrame > 500))
            throw new Error(`Combat benchmark failed. ${errors.join("\n")}`);
        console.log(JSON.stringify({ url, movieEnd, battle, intervals }, null, 2));
    } finally {
        await browser.close();
    }
}

benchmark().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
