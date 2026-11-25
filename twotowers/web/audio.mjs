const capacity = 8192;
const queueLimit = 4096;

export async function startAudio(context) {
    await context.audioWorklet.addModule(new URL("./pcm-player.mjs", import.meta.url));
    const state = new Int32Array(new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT));
    const samples = new Int16Array(new SharedArrayBuffer(capacity * 2 * Int16Array.BYTES_PER_ELEMENT));
    const output = new AudioWorkletNode(context, "pcm-player", {
        numberOfInputs: 0,
        outputChannelCount: [2],
        processorOptions: { state, samples },
    });
    output.connect(context.destination);

    return {
        submit(memory, address, frames) {
            const write = Atomics.load(state, 1);
            const read = Atomics.load(state, 0);
            if (((write - read) >>> 0) + frames > queueLimit) {
                return 0;
            }
            const source = address >>> 1;
            const index = write & (capacity - 1);
            const first = Math.min(frames, capacity - index) * 2;
            samples.set(memory.subarray(source, source + first), index * 2);
            if (first !== frames * 2) {
                samples.set(memory.subarray(source + first, source + frames * 2));
            }
            Atomics.store(state, 1, write + frames);
            return 1;
        },
        clear() {
            Atomics.store(state, 0, Atomics.load(state, 1));
        },
        queuedPeriods() {
            return ((Atomics.load(state, 1) - Atomics.load(state, 0)) >>> 0) >>> 8;
        },
        underruns() {
            return Atomics.load(state, 2);
        },
    };
}
