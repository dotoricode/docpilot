const {
  applyPatches,
  cleanupEfficiency,
  cleanupSemantic,
  makeDiff,
  makePatches,
} = require('@sanity/diff-match-patch');

const RECONCILE_SIZE_CAP_CODE_UNITS = 50_000;
const RECONCILE_DIFF_TIMEOUT_SECONDS = 0.01;

function reconcileSerializedMarkdown({ originalSource, baseCanonical, edited, roundTrip }) {
  if (edited === baseCanonical) return { ok: true, markdown: originalSource, reason: '' };
  if (Math.max(originalSource.length, baseCanonical.length, edited.length) > RECONCILE_SIZE_CAP_CODE_UNITS) {
    return { ok: false, markdown: originalSource, reason: 'document-too-large' };
  }

  const eol = detectDominantEol(originalSource);
  const originalLf = toLf(originalSource);
  const baseLf = toLf(baseCanonical);
  const editedLf = toLf(edited);
  let diffs = makeDiff(baseLf, editedLf, { checkLines: true, timeout: RECONCILE_DIFF_TIMEOUT_SECONDS });
  if (diffs.length > 2) {
    diffs = cleanupSemantic(diffs);
    diffs = cleanupEfficiency(diffs);
  }
  const [reconciledLf, results] = applyPatches(makePatches(baseLf, diffs), originalLf);
  if (results.some(applied => !applied)) {
    return { ok: false, markdown: originalSource, reason: 'patch-failed' };
  }

  let reparsed = null;
  try {
    reparsed = roundTrip(reconciledLf);
  } catch {
    reparsed = null;
  }
  if (reparsed === null || toLf(reparsed) !== editedLf) {
    return { ok: false, markdown: originalSource, reason: 'round-trip-mismatch' };
  }
  return { ok: true, markdown: restoreEol(reconciledLf, eol), reason: '' };
}

function detectDominantEol(text) {
  const totalLf = (text.match(/\n/g) || []).length;
  const crlf = (text.match(/\r\n/g) || []).length;
  return crlf > 0 && crlf >= totalLf - crlf ? '\r\n' : '\n';
}

function toLf(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function restoreEol(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

module.exports = {
  RECONCILE_SIZE_CAP_CODE_UNITS,
  reconcileSerializedMarkdown,
};
