const DEFAULT_MAX_BYTES = 1024 * 1024;

function createScreenBuffer(options) {
  try {
    const { Terminal } = require('@xterm/headless');
    const { SerializeAddon } = require('@xterm/addon-serialize');
    const terminal = new Terminal({
      cols: Math.max(2, Number(options.cols || 100)),
      rows: Math.max(1, Number(options.rows || 30)),
      scrollback: Math.max(0, Number(options.scrollback || 5000)),
      allowProposedApi: true,
    });
    const serializer = new SerializeAddon();
    terminal.loadAddon(serializer);
    return { terminal, serializer };
  } catch {
    return null;
  }
}

class TerminalSessionModel {
  constructor(options = {}) {
    this.maxBytes = Math.max(1, Number(options.maxBytes || DEFAULT_MAX_BYTES));
    this.frames = [];
    this.retainedBytes = 0;
    this.lastSeq = 0;
    this.screen = createScreenBuffer(options);
    this.screenWrites = Promise.resolve();
  }

  append(value) {
    const data = String(value || '');
    const frame = { seq: this.lastSeq + 1, data };
    this.lastSeq = frame.seq;
    this.frames.push(frame);
    this.retainedBytes += Buffer.byteLength(data);
    this.trim();
    if (this.screen) {
      this.screenWrites = this.screenWrites.then(() => new Promise(resolve => {
        this.screen.terminal.write(data, resolve);
      }));
    }
    return frame;
  }

  trim() {
    while (this.frames.length > 1 && this.retainedBytes > this.maxBytes) {
      const frame = this.frames.shift();
      this.retainedBytes -= Buffer.byteLength(frame.data);
    }
  }

  snapshot() {
    return {
      data: this.frames.map(frame => frame.data).join(''),
      fromSeq: this.frames[0]?.seq || this.lastSeq,
      lastSeq: this.lastSeq,
    };
  }

  async screenSnapshot() {
    if (!this.screen) return this.snapshot();
    await this.screenWrites;
    return {
      data: this.screen.serializer.serialize({ scrollback: true }),
      fromSeq: this.frames[0]?.seq || this.lastSeq,
      lastSeq: this.lastSeq,
    };
  }

  resize(cols, rows) {
    if (!this.screen) return;
    this.screen.terminal.resize(Math.max(2, Number(cols || 100)), Math.max(1, Number(rows || 30)));
  }

  dispose() {
    this.screen?.terminal.dispose();
    this.screen = null;
  }

  replayAfter(seq) {
    const requestedSeq = Math.max(0, Number(seq || 0));
    const firstSeq = this.frames[0]?.seq || this.lastSeq + 1;
    if (requestedSeq < firstSeq - 1) return { needsSnapshot: true, frames: [] };
    return {
      needsSnapshot: false,
      frames: this.frames.filter(frame => frame.seq > requestedSeq),
    };
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  TerminalSessionModel,
};
