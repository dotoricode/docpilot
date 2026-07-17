const DEFAULT_MAX_BYTES = 1024 * 1024;

function retainUtf8Tail(value, maxBytes) {
  const data = String(value || '');
  const encoded = Buffer.from(data);
  if (encoded.length <= maxBytes) return { data, truncated: false };

  let start = encoded.length - maxBytes;
  while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start += 1;
  return {
    data: encoded.subarray(start).toString('utf8'),
    truncated: true,
  };
}

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
    this.disposed = false;
  }

  append(value) {
    const data = String(value || '');
    const frame = { seq: this.lastSeq + 1, data };
    const retained = retainUtf8Tail(data, this.maxBytes);
    this.lastSeq = frame.seq;
    this.frames.push({ ...frame, data: retained.data, truncated: retained.truncated });
    this.retainedBytes += Buffer.byteLength(retained.data);
    this.trim();
    const screen = this.screen;
    if (screen && !this.disposed) {
      this.screenWrites = this.screenWrites
        .catch(() => {})
        .then(() => new Promise(resolve => {
          if (this.disposed || this.screen !== screen) {
            resolve();
            return;
          }
          try {
            screen.terminal.write(data, resolve);
          } catch {
            resolve();
          }
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
    const screen = this.screen;
    if (!screen || this.disposed) return this.snapshot();
    await this.screenWrites.catch(() => {});
    if (this.screen !== screen || this.disposed) return this.snapshot();
    return {
      data: screen.serializer.serialize({ scrollback: true }),
      fromSeq: this.frames[0]?.seq || this.lastSeq,
      lastSeq: this.lastSeq,
    };
  }

  resize(cols, rows) {
    if (!this.screen) return;
    this.screen.terminal.resize(Math.max(2, Number(cols || 100)), Math.max(1, Number(rows || 30)));
  }

  dispose() {
    if (this.disposed) return this.screenWrites;
    this.disposed = true;
    const screen = this.screen;
    this.screen = null;
    this.screenWrites.catch(() => {});
    try { screen?.terminal.dispose(); } catch {}
    this.screenWrites = Promise.resolve();
    return this.screenWrites;
  }

  replayAfter(seq) {
    const requestedSeq = Math.max(0, Number(seq || 0));
    const firstSeq = this.frames[0]?.seq || this.lastSeq + 1;
    if (requestedSeq < firstSeq - 1) return { needsSnapshot: true, frames: [] };
    if (this.frames.some(frame => frame.seq > requestedSeq && frame.truncated)) {
      return { needsSnapshot: true, frames: [] };
    }
    return {
      needsSnapshot: false,
      frames: this.frames
        .filter(frame => frame.seq > requestedSeq)
        .map(({ seq: frameSeq, data }) => ({ seq: frameSeq, data })),
    };
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  TerminalSessionModel,
};
