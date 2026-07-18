function createFileBuffer({ path = '', content = '', revision = '' } = {}) {
  const text = String(content || '');
  const diskRevision = String(revision || '');
  return {
    path: String(path || ''),
    editorContent: text,
    diskContentAtOpen: text,
    lastKnownDiskContent: text,
    lastSavedContent: text,
    lastKnownDiskRevision: diskRevision,
    lastSavedRevision: diskRevision,
    dirtyByUser: false,
    changedByAgent: false,
    conflictState: 'clean',
  };
}

function updateEditorContent(buffer, nextContent) {
  const editorContent = String(nextContent || '');
  return {
    ...buffer,
    editorContent,
    dirtyByUser: editorContent !== buffer.lastSavedContent,
    conflictState: buffer.lastKnownDiskContent !== buffer.lastSavedContent && editorContent !== buffer.lastKnownDiskContent
      ? 'dirty-conflict'
      : buffer.conflictState,
  };
}

function markSaved(buffer, savedContent = buffer.editorContent, revision = buffer.lastKnownDiskRevision) {
  const text = String(savedContent || '');
  const diskRevision = String(revision || '');
  return {
    ...buffer,
    editorContent: text,
    lastKnownDiskContent: text,
    lastSavedContent: text,
    lastKnownDiskRevision: diskRevision,
    lastSavedRevision: diskRevision,
    dirtyByUser: false,
    changedByAgent: false,
    conflictState: 'clean',
  };
}

function applySaveResult(buffer, filePath, savedContent, revision = '') {
  if (!buffer || buffer.path !== filePath) return buffer;
  const text = String(savedContent || '');
  const diskRevision = String(revision || buffer.lastKnownDiskRevision || '');
  if (buffer.editorContent === text) return markSaved(buffer, text, diskRevision);
  return {
    ...buffer,
    lastKnownDiskContent: text,
    lastSavedContent: text,
    lastKnownDiskRevision: diskRevision,
    lastSavedRevision: diskRevision,
    dirtyByUser: true,
    changedByAgent: false,
    conflictState: 'clean',
  };
}

function applyPeerSaveResult(buffer, filePath, savedContent, revision = '') {
  if (!buffer || buffer.path !== filePath) return buffer;
  if (!buffer.dirtyByUser) return markSaved(buffer, savedContent, revision);
  return applySaveResult(buffer, filePath, savedContent, revision);
}

function applyDiskChange(buffer, diskContent, source = 'external', revision = '') {
  const text = String(diskContent || '');
  const diskRevision = String(revision || buffer.lastKnownDiskRevision || '');
  if (text === buffer.lastKnownDiskContent) {
    if (!diskRevision || diskRevision === buffer.lastKnownDiskRevision) return buffer;
    return {
      ...buffer,
      lastKnownDiskRevision: diskRevision,
      ...(!buffer.dirtyByUser ? { lastSavedRevision: diskRevision } : {}),
    };
  }
  const changedByAgent = source === 'agent' || buffer.changedByAgent;
  if (!buffer.dirtyByUser) {
    return {
      ...buffer,
      editorContent: text,
      lastKnownDiskContent: text,
      lastSavedContent: text,
      lastKnownDiskRevision: diskRevision,
      lastSavedRevision: diskRevision,
      dirtyByUser: false,
      changedByAgent,
      conflictState: changedByAgent ? 'agent-change' : 'external-change',
    };
  }
  return {
    ...buffer,
    lastKnownDiskContent: text,
    lastKnownDiskRevision: diskRevision,
    changedByAgent,
    conflictState: changedByAgent ? 'agent-conflict' : 'external-conflict',
  };
}

function canAutoApplyDiskChange(buffer) {
  return !buffer.dirtyByUser && ['clean', 'agent-change', 'external-change'].includes(buffer.conflictState);
}

module.exports = {
  createFileBuffer,
  updateEditorContent,
  markSaved,
  applySaveResult,
  applyPeerSaveResult,
  applyDiskChange,
  canAutoApplyDiskChange,
};
