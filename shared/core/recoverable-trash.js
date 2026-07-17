const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensurePrivateDirectory } = require('./atomic-file');

function copyForCrossDeviceMove(sourcePath, stagingPath, stat) {
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, stagingPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      dereference: false,
    });
    return;
  }
  if (!stat.isFile()) throw new Error('trash source must be a regular file or directory');
  fs.copyFileSync(sourcePath, stagingPath, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(stagingPath, stat.mode & 0o777); } catch {}
}

/**
 * Move a workspace path to private recoverable storage. A plain rename is
 * atomic. When state and workspace live on different volumes, copy to a
 * hidden staging path first so an interrupted copy is never exposed as a
 * complete trash entry, then remove the original only after the copy lands.
 */
function movePathToRecoverableTrash(sourcePath, targetPath, options = {}) {
  const renameSync = options.renameSync || fs.renameSync;
  ensurePrivateDirectory(path.dirname(targetPath));

  try {
    renameSync(sourcePath, targetPath);
    return { crossDevice: false };
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
  }

  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink()) throw new Error('cannot move symlink to recoverable trash');
  const stagingPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.copying`,
  );
  try {
    copyForCrossDeviceMove(sourcePath, stagingPath, stat);
    renameSync(stagingPath, targetPath);
    fs.rmSync(sourcePath, { recursive: stat.isDirectory(), force: false });
    return { crossDevice: true };
  } catch (error) {
    try { fs.rmSync(stagingPath, { recursive: true, force: true }); } catch {}
    throw error;
  }
}

async function copyForCrossDeviceMoveAsync(sourcePath, stagingPath, stat) {
  if (stat.isDirectory()) {
    await fs.promises.cp(sourcePath, stagingPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      dereference: false,
    });
    return;
  }
  if (!stat.isFile()) throw new Error('trash source must be a regular file or directory');
  await fs.promises.copyFile(sourcePath, stagingPath, fs.constants.COPYFILE_EXCL);
  try { await fs.promises.chmod(stagingPath, stat.mode & 0o777); } catch {}
}

async function movePathToRecoverableTrashAsync(sourcePath, targetPath, options = {}) {
  const rename = options.rename || fs.promises.rename.bind(fs.promises);
  ensurePrivateDirectory(path.dirname(targetPath));
  try {
    await rename(sourcePath, targetPath);
    return { crossDevice: false };
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
  }

  const stat = await fs.promises.lstat(sourcePath);
  if (stat.isSymbolicLink()) throw new Error('cannot move symlink to recoverable trash');
  const stagingPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.copying`,
  );
  try {
    await copyForCrossDeviceMoveAsync(sourcePath, stagingPath, stat);
    await rename(stagingPath, targetPath);
    await fs.promises.rm(sourcePath, { recursive: stat.isDirectory(), force: false });
    return { crossDevice: true };
  } catch (error) {
    try { await fs.promises.rm(stagingPath, { recursive: true, force: true }); } catch {}
    throw error;
  }
}

module.exports = { movePathToRecoverableTrash, movePathToRecoverableTrashAsync };
