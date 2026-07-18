const fs = require('fs');

function targetExistsError() {
  const error = new Error('target already exists');
  error.code = 'EEXIST';
  return error;
}

function renamePathNoClobber(sourcePath, targetPath, sourceStat = fs.lstatSync(sourcePath)) {
  if (sourceStat.isSymbolicLink()) throw new Error('cannot rename symlink');
  if (sourceStat.isFile()) {
    // Hard-link creation is an atomic no-replace operation on the same
    // filesystem. Removing the old name afterwards preserves the inode,
    // permissions, xattrs, and content without a clobber race.
    fs.linkSync(sourcePath, targetPath);
    fs.unlinkSync(sourcePath);
    return;
  }
  if (fs.existsSync(targetPath)) throw targetExistsError();
  // Node does not expose renameat2(RENAME_NOREPLACE)/renamex_np. Keep the
  // immediate recheck for directories; regular document files use the
  // strictly no-clobber path above.
  fs.renameSync(sourcePath, targetPath);
}

module.exports = { renamePathNoClobber };
