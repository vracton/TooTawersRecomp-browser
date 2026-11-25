const capacity = 8192;

export async function startAudio(context, game) {
    await context.audioWorklet.addModule(new URL("./pcm-player.mjs", import.meta.url));
    const address = game._xbox_WebAudioBuffer();
    const memory = game.HEAPU8.buffer;
    const state = new Int32Array(memory, address, 4);
    const samples = new Int16Array(memory, address + 4 * Int32Array.BYTES_PER_ELEMENT, capacity * 2);
    const output = new AudioWorkletNode(context, "pcm-player", {
        numberOfInputs: 0,
        outputChannelCount: [2],
        processorOptions: { state, samples },
    });
    output.connect(context.destination);
    Atomics.store(state, 3, 1);

    return {
        underruns() {
            return Atomics.load(state, 2);
        },
    };
}
