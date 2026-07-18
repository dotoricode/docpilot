const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fileRevision(content) {
  return crypto.createHash('sha256').update(String(content ?? '')).digest('hex');
}

function writeExistingWorkspaceFileAtomic(filePath, content, expectedRevision, options = {}) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('target is not a regular file');
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'wx', stat.mode & 0o777);
    fs.writeFileSync(fd, String(content), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    // The HTTP route checks once before preparing this temp file. Check again
    // at commit time so an external editor cannot silently lose a concurrent
    // change made while the temp file was being written and flushed.
    options.beforeCommit?.(tempPath);
    const latestStat = fs.lstatSync(filePath);
    if (!latestStat.isFile() || latestStat.isSymbolicLink()) {
      throw new Error('target is no longer a regular file');
    }
    const latestRevision = fileRevision(fs.readFileSync(filePath, 'utf8'));
    if (expectedRevision && latestRevision !== expectedRevision) {
      const error = new Error('file changed on disk; reload or review the conflict before saving');
      error.code = 'SAVE_CONFLICT';
      error.revision = latestRevision;
      throw error;
    }
    fs.renameSync(tempPath, filePath);
    return fileRevision(content);
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

module.exports = { fileRevision, writeExistingWorkspaceFileAtomic };
