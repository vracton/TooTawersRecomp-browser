class PcmPlayer extends AudioWorkletProcessor {
    constructor({ processorOptions }) {
        super();
        this.state = processorOptions.state;
        this.samples = processorOptions.samples;
        this.mask = this.samples.length / 2 - 1;
        this.started = false;
    }

    process(_inputs, [output]) {
        const [left, right] = output;
        const read = Atomics.load(this.state, 0);
        const write = Atomics.load(this.state, 1);
        const available = (write - read) >>> 0;
        const count = Math.min(available, left.length);
        for (let frame = 0; frame < count; frame++) {
            const index = ((read + frame) & this.mask) * 2;
            left[frame] = this.samples[index] / 32768;
            right[frame] = this.samples[index + 1] / 32768;
        }
        Atomics.compareExchange(this.state, 0, read, read + count);
        this.started ||= count > 0;
        if (this.started && count < left.length) {
            Atomics.add(this.state, 2, 1);
        }
        return true;
    }
}

registerProcessor("pcm-player", PcmPlayer);
