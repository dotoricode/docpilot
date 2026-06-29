function createFileBuffer({ path = '', content = '' } = {}) {
  const text = String(content || '');
  return {
    path: String(path || ''),
    editorContent: text,
    diskContentAtOpen: text,
    lastKnownDiskContent: text,
    lastSavedContent: text,
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

function markSaved(buffer, savedContent = buffer.editorContent) {
  const text = String(savedContent || '');
  return {
    ...buffer,
    editorContent: text,
    lastKnownDiskContent: text,
    lastSavedContent: text,
    dirtyByUser: false,
    changedByAgent: false,
    conflictState: 'clean',
  };
}

function applyDiskChange(buffer, diskContent, source = 'external') {
  const text = String(diskContent || '');
  if (text === buffer.lastKnownDiskContent) return buffer;
  const changedByAgent = source === 'agent' || buffer.changedByAgent;
  if (!buffer.dirtyByUser) {
    return {
      ...buffer,
      editorContent: text,
      lastKnownDiskContent: text,
      lastSavedContent: text,
      dirtyByUser: false,
      changedByAgent,
      conflictState: changedByAgent ? 'agent-change' : 'external-change',
    };
  }
  return {
    ...buffer,
    lastKnownDiskContent: text,
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
  applyDiskChange,
  canAutoApplyDiskChange,
};
