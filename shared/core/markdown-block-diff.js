function markDiffGroups(rows) {
  let lastType = '';
  return rows.map(row => {
    const grouped = (row.type === 'add' || row.type === 'del') && row.type === lastType;
    lastType = row.type === 'add' || row.type === 'del' ? row.type : '';
    return { ...row, grouped };
  });
}

function markdownPreviewBlocks(src) {
  const lines = String(src || '').split('\n');
  const blocks = [];
  let i = 0;
  const push = items => {
    const raw = items.join('\n').trim();
    if (raw) blocks.push(raw);
  };
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    if (/^```/.test(lines[i])) {
      const part = [lines[i++]];
      while (i < lines.length) {
        part.push(lines[i]);
        if (/^```/.test(lines[i++])) break;
      }
      push(part); continue;
    }
    if (/^#{1,6}\s+/.test(lines[i]) || /^---\s*$/.test(lines[i])) { push([lines[i++]]); continue; }
    if (/^>\s?/.test(lines[i])) {
      const part = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) part.push(lines[i++]);
      push(part); continue;
    }
    if (/^\s*[-*]\s+/.test(lines[i])) {
      const part = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) part.push(lines[i++]);
      part.forEach(line => push([line]));
      continue;
    }
    if (/^\s*\d+\.\s+/.test(lines[i])) {
      const part = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) part.push(lines[i++]);
      part.forEach(line => push([line]));
      continue;
    }
    if (/^\|.+\|\s*$/.test(lines[i])) {
      const part = [];
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i])) part.push(lines[i++]);
      const hasSeparator = part.length > 1 && /^(\s*\|?\s*:?-{3,}:?\s*)+\|\s*$/.test(part[1]);
      if (hasSeparator) {
        push(part.slice(0, 2));
        part.slice(2).forEach(line => push([line]));
      } else {
        part.forEach(line => push([line]));
      }
      continue;
    }
    const part = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^---\s*$/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\|.+\|\s*$/.test(lines[i])
    ) {
      part.push(lines[i++]);
    }
    push(part);
  }
  return blocks;
}

function markdownLineSig(line) {
  if (/^```/.test(line)) return 'fence';
  if (/^#{1,6}\s+/.test(line)) return `heading:${line.match(/^#{1,6}/)[0].length}`;
  if (/^>\s?/.test(line)) return 'quote';
  if (/^\s*[-*]\s+/.test(line)) return 'ul';
  if (/^\s*\d+\.\s+/.test(line)) return 'ol';
  if (/^\|.+\|\s*$/.test(line)) return 'table';
  return 'text';
}

function textSimilarity(a, b) {
  a = String(a || '');
  b = String(b || '');
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf + pre < a.length && suf + pre < b.length && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return (pre + suf) / max;
}

function changedBlocksComparable(oldBlock, newBlock) {
  const oldLines = String(oldBlock || '').split('\n');
  const newLines = String(newBlock || '').split('\n');
  if (oldLines.length !== newLines.length || oldLines.length > 80) return false;
  if (oldLines.some(line => markdownLineSig(line) === 'fence') || newLines.some(line => markdownLineSig(line) === 'fence')) return false;
  for (let i = 0; i < oldLines.length; i++) {
    if (markdownLineSig(oldLines[i]) !== markdownLineSig(newLines[i])) return false;
  }
  return textSimilarity(oldBlock, newBlock) >= 0.25;
}

function sequenceDiffRows(oldItems, newItems) {
  const n = oldItems.length;
  const m = newItems.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldItems[i] === newItems[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldItems[i] === newItems[j]) {
      rows.push({ type: 'same', oldBlock: oldItems[i++], newBlock: newItems[j++] });
    } else if (j < m && (i === n || dp[i][j + 1] > dp[i + 1]?.[j])) {
      rows.push({ type: 'add', oldBlock: '', newBlock: newItems[j++] });
    } else if (i < n) {
      rows.push({ type: 'del', oldBlock: oldItems[i++], newBlock: '' });
    }
  }
  return markDiffGroups(rows);
}

function pairChangedPreviewRows(rows) {
  const paired = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const next = rows[i + 1];
    if (next && row.type === 'del' && next.type === 'add' && changedBlocksComparable(row.oldBlock, next.newBlock)) {
      paired.push({ type: 'change', oldBlock: row.oldBlock, newBlock: next.newBlock });
      i++; continue;
    }
    if (next && row.type === 'add' && next.type === 'del' && changedBlocksComparable(next.oldBlock, row.newBlock)) {
      paired.push({ type: 'change', oldBlock: next.oldBlock, newBlock: row.newBlock });
      i++; continue;
    }
    paired.push(row);
  }
  return markDiffGroups(paired);
}

function markdownBlockDiffRows(oldText, newText) {
  return pairChangedPreviewRows(sequenceDiffRows(markdownPreviewBlocks(oldText), markdownPreviewBlocks(newText)));
}

module.exports = {
  markDiffGroups,
  markdownPreviewBlocks,
  markdownLineSig,
  textSimilarity,
  changedBlocksComparable,
  sequenceDiffRows,
  pairChangedPreviewRows,
  markdownBlockDiffRows,
};
