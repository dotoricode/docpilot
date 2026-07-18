const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensurePrivateDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dirPath, 0o700); } catch {}
}

function writeFileAtomic(filePath, content, options = {}) {
  const directory = path.dirname(filePath);
  ensurePrivateDirectory(directory);
  const mode = options.mode ?? 0o600;
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'wx', mode);
    fs.writeFileSync(fd, content, { encoding: options.encoding || 'utf8' });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
    try { fs.chmodSync(filePath, mode); } catch {}
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function writeJsonAtomic(filePath, value, options = {}) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

module.exports = {
  ensurePrivateDirectory,
  writeFileAtomic,
  writeJsonAtomic,
};
