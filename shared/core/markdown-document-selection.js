function locateMarkdownDocumentSelection(input) {
  if (!input?.fileId || !input.text) return null;
  const source = String(input.source || '');
  const text = String(input.text);
  const matches = [];
  let cursor = 0;
  while (cursor <= source.length) {
    const found = source.indexOf(text, cursor);
    if (found < 0) break;
    matches.push(found);
    cursor = found + Math.max(1, text.length);
  }
  if (!matches.length) return null;

  const editorSpan = Math.max(1, Number(input.documentSize || 0) - 2);
  const expected = Math.round(Math.max(0, Number(input.editorFrom || 0) - 1) / editorSpan * source.length);
  const from = matches.reduce((best, candidate) => (
    Math.abs(candidate - expected) < Math.abs(best - expected) ? candidate : best
  ), matches[0]);
  const to = from + text.length;
  return {
    fileId: input.fileId,
    text,
    from,
    to,
    lineStart: lineNumberAt(source, from),
    lineEnd: lineNumberAt(source, to),
    blockType: String(input.blockType || 'paragraph'),
    editorFrom: Number(input.editorFrom || 0),
    editorTo: Number(input.editorTo || 0),
  };
}

function lineNumberAt(source, offset) {
  let line = 1;
  for (let index = 0; index < Math.min(offset, source.length); index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

module.exports = { locateMarkdownDocumentSelection };
