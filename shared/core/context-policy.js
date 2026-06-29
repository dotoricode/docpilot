const CONTEXT_MODES = Object.freeze(['minimal', 'selection', 'conversation', 'document', 'project', 'full']);

const DEFAULT_CONTEXT_BUDGETS = Object.freeze({
  recentTranscriptTurns: 4,
  recentTranscriptChars: 8000,
  messageChars: 2500,
  attachments: 8,
  attachmentChars: 5000,
  targetContentChars: 14000,
  summaryChars: 2000,
});

const CONTEXT_MODE_BUDGETS = Object.freeze({
  minimal: {
    recentTranscriptTurns: 0,
    recentTranscriptChars: 0,
    attachments: 0,
    attachmentChars: 0,
    targetContentChars: 0,
    summaryChars: 600,
  },
  selection: {
    recentTranscriptTurns: 1,
    recentTranscriptChars: 1500,
    attachments: 4,
    attachmentChars: 2500,
    targetContentChars: 0,
    summaryChars: 800,
  },
  conversation: {
    recentTranscriptTurns: 3,
    recentTranscriptChars: 5000,
    attachments: 0,
    attachmentChars: 0,
    targetContentChars: 0,
    summaryChars: 1200,
  },
  document: {
    recentTranscriptTurns: 1,
    recentTranscriptChars: 1500,
    attachments: 4,
    attachmentChars: 2500,
    targetContentChars: 14000,
    summaryChars: 1200,
  },
  project: {
    recentTranscriptTurns: 2,
    recentTranscriptChars: 4000,
    attachments: 8,
    attachmentChars: 5000,
    targetContentChars: 14000,
    summaryChars: 1600,
  },
  full: DEFAULT_CONTEXT_BUDGETS,
});

function normalizeContextMode(mode) {
  return CONTEXT_MODES.includes(mode) ? mode : 'minimal';
}

function budgetsForContextMode(mode, budgets = DEFAULT_CONTEXT_BUDGETS) {
  const normalized = normalizeContextMode(mode);
  return { ...budgets, ...(CONTEXT_MODE_BUDGETS[normalized] || {}) };
}

function contextModeLabel(mode = 'minimal') {
  const normalized = normalizeContextMode(mode);
  if (normalized === 'selection') return '선택 문맥';
  if (normalized === 'conversation') return '최근 대화';
  if (normalized === 'document') return '현재 문서';
  if (normalized === 'project') return '프로젝트';
  if (normalized === 'full') return '전체 문맥';
  return '최소';
}

function chooseContextMode({ message = '', attachments = [], explicitMode = '' } = {}) {
  if (explicitMode) return normalizeContextMode(explicitMode);
  if (Array.isArray(attachments) && attachments.length) return 'selection';
  const text = String(message || '');
  if (/방금|이전|위에서|위 내용|그거|그걸|계속|이어|앞서|아까|previous|above|continue|that/i.test(text)) {
    return 'conversation';
  }
  return 'minimal';
}

module.exports = {
  CONTEXT_MODES,
  DEFAULT_CONTEXT_BUDGETS,
  CONTEXT_MODE_BUDGETS,
  normalizeContextMode,
  budgetsForContextMode,
  contextModeLabel,
  chooseContextMode,
};
