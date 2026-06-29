import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import MarkdownIt from 'markdown-it';
import { markdownBlockDiffRows, markdownPreviewBlocks } from '../../../../shared/core/markdown-block-diff';
import { readWorkspaceFileBase } from '../../shared/bridge-client';

type FileBuffer = {
  path: string;
  editorContent: string;
  dirtyByUser: boolean;
  conflictState: string;
};

type EditorPaneProps = {
  buffer: FileBuffer;
  error: string;
  saving: boolean;
  onSelectionChange: (selection: { fileId: string; text: string; from: number; to: number } | null) => void;
  onChange: (content: string) => void;
  onSave: () => void;
};

type DiffRow = {
  type: 'same' | 'add' | 'del' | 'change';
  oldBlock?: string;
  newBlock?: string;
};

type LineDiffRow = {
  type: 'same' | 'add' | 'del';
  oldNo?: number;
  newNo?: number;
  oldText?: string;
  newText?: string;
};

const emptyDocument = `# DocPilot

왼쪽에서 Markdown 파일을 선택하세요.
`;

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

export function EditorPane({ buffer, error, saving, onSelectionChange, onChange, onSave }: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastExternalDocRef = useRef('');
  const pathRef = useRef(buffer.path);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [diffOn, setDiffOn] = useState(false);
  const [diffSplit, setDiffSplit] = useState(false);
  const [baseContent, setBaseContent] = useState('');
  const [previewWidth, setPreviewWidth] = useState(820);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number | null>(null);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState(0);

  const visibleContent = buffer.path ? buffer.editorContent : emptyDocument;
  const frontmatter = useMemo(() => parseFrontmatter(visibleContent), [visibleContent]);
  const previewSource = frontmatter.body || visibleContent;
  const previewHtml = useMemo(() => markdownRenderer.render(previewSource), [previewSource]);
  const headings = useMemo(() => parseHeadings(previewSource), [previewSource]);
  const diffRows = useMemo(() => markdownBlockDiffRows(baseContent, visibleContent), [baseContent, visibleContent]);

  useEffect(() => {
    pathRef.current = buffer.path;
  }, [buffer.path]);

  useEffect(() => {
    let disposed = false;
    if (!diffOn || !buffer.path) {
      setBaseContent('');
      return undefined;
    }
    readWorkspaceFileBase(buffer.path)
      .then(file => {
        if (!disposed) setBaseContent(file.content || '');
      })
      .catch(() => {
        if (!disposed) setBaseContent('');
      });
    return () => {
      disposed = true;
    };
  }, [buffer.path, diffOn]);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: visibleContent,
        extensions: [
          markdown(),
          keymap.of(defaultKeymap),
          EditorView.lineWrapping,
          EditorView.updateListener.of(update => {
            const selection = update.state.selection.main;
            const activePath = pathRef.current;
            if (!selection.empty && activePath) {
              onSelectionChange({
                fileId: activePath,
                text: update.state.sliceDoc(selection.from, selection.to),
                from: selection.from,
                to: selection.to,
              });
            } else if (update.selectionSet) {
              onSelectionChange(null);
            }

            if (update.docChanged) {
              const next = update.state.doc.toString();
              lastExternalDocRef.current = next;
              onChange(next);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    lastExternalDocRef.current = visibleContent;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || visibleContent === lastExternalDocRef.current) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: visibleContent },
    });
    lastExternalDocRef.current = visibleContent;
  }, [visibleContent]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    preview.querySelectorAll('.preview-picked').forEach(node => node.classList.remove('preview-picked'));
    if (selectedPreviewIndex === null) return;
    const block = preview.querySelectorAll('p,li,table,pre,blockquote,h1,h2,h3,h4,h5,h6')[selectedPreviewIndex];
    block?.classList.add('preview-picked');
  }, [previewHtml, selectedPreviewIndex]);

  useEffect(() => {
    setActiveHeadingIndex(0);
  }, [buffer.path, previewHtml]);

  function selectWholeDocument() {
    if (!buffer.path || !visibleContent.trim()) return;
    onSelectionChange({
      fileId: buffer.path,
      text: previewSource,
      from: 0,
      to: previewSource.length,
    });
  }

  function scrollToHeading(index: number) {
    const heading = previewRef.current?.querySelectorAll('h1,h2,h3')[index];
    heading?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setActiveHeadingIndex(index);
  }

  function syncActiveHeading() {
    if (diffOn) return;
    const preview = previewRef.current;
    if (!preview) return;
    const headingNodes = Array.from(preview.querySelectorAll('h1,h2,h3'));
    if (!headingNodes.length) {
      setActiveHeadingIndex(0);
      return;
    }
    const previewTop = preview.getBoundingClientRect().top;
    let nextIndex = 0;
    headingNodes.forEach((heading, index) => {
      if (heading.getBoundingClientRect().top - previewTop <= 96) nextIndex = index;
    });
    setActiveHeadingIndex(current => current === nextIndex ? current : nextIndex);
  }

  function selectPreviewBlock(event: MouseEvent<HTMLElement>) {
    if (!buffer.path) return;
    if (diffOn) return;
    const target = event.target instanceof HTMLElement
      ? event.target.closest('p,li,table,pre,blockquote,h1,h2,h3,h4,h5,h6')
      : null;
    if (!(target instanceof HTMLElement) || !previewRef.current?.contains(target)) return;
    const blocks = Array.from(previewRef.current.querySelectorAll('p,li,table,pre,blockquote,h1,h2,h3,h4,h5,h6'));
    const index = blocks.indexOf(target);
    const text = target.innerText.trim();
    if (!text) return;
    const from = Math.max(0, previewSource.indexOf(text));
    setSelectedPreviewIndex(index);
    onSelectionChange({
      fileId: buffer.path,
      text,
      from,
      to: from + text.length,
    });
  }

  function toggleDiff(next: boolean) {
    setDiffOn(next);
  }

  return (
    <section className="editor-pane">
      <div className="panel-title editor-title">
        <span>{buffer.path || 'Editor'}</span>
        <span>{markdownPreviewBlocks(visibleContent).length} blocks</span>
        {buffer.dirtyByUser ? <span className="dirty-pill">수정됨</span> : null}
        {buffer.conflictState !== 'clean' ? <span className="conflict-pill">{buffer.conflictState}</span> : null}
        <div className="editor-mode-toggle" aria-label="본문 모드">
          <button className={mode === 'preview' ? 'active' : ''} type="button" onClick={() => setMode('preview')}>프리뷰</button>
          <button className={mode === 'edit' ? 'active' : ''} type="button" onClick={() => setMode('edit')}>편집</button>
        </div>
        <label className={`diff-toggle ${diffOn ? 'active' : ''}`}>
          <span>Diff</span>
          <input type="checkbox" checked={diffOn} onChange={event => toggleDiff(event.currentTarget.checked)} />
        </label>
        {diffOn ? (
          <label className={`diff-toggle ${diffSplit ? 'active' : ''}`}>
            <span>분할</span>
            <input type="checkbox" checked={diffSplit} onChange={event => setDiffSplit(event.currentTarget.checked)} />
          </label>
        ) : null}
        <button className="editor-action" type="button" disabled={!buffer.path} onClick={selectWholeDocument}>전체 선택</button>
        <label className="preview-width-control" title="본문 너비">
          <input
            type="range"
            min="480"
            max="1200"
            step="20"
            value={previewWidth}
            onChange={event => setPreviewWidth(Number(event.currentTarget.value))}
          />
          <span>{previewWidth}</span>
        </label>
        <button className="save-button" type="button" disabled={!buffer.path || !buffer.dirtyByUser || saving} onClick={onSave}>
          {saving ? '저장 중' : '저장'}
        </button>
      </div>
      {error ? <div className="editor-error">{error}</div> : null}
      <div className={`editor-workspace ${mode} ${diffOn ? 'diffing' : ''}`}>
        <div className="editor-host" ref={hostRef} />
        <div className="preview-shell">
          {mode !== 'edit' ? (
            <nav className={`toc-rail ${headings.length ? '' : 'empty'}`} aria-label="문서 목차">
              {headings.length ? headings.map((heading, index) => (
                <button
                  className={`toc-item toc-h${heading.level}`}
                  data-active={index === activeHeadingIndex ? 'true' : 'false'}
                  key={`${heading.line}-${heading.text}`}
                  type="button"
                  onClick={() => scrollToHeading(index)}
                >
                  {heading.text}
                </button>
              )) : <span>목차 없음</span>}
            </nav>
          ) : null}
          <article
            className={`markdown-preview ${diffOn ? 'diff-preview-mode' : ''}`}
            ref={previewRef}
            style={{ '--preview-width': `${previewWidth}px` } as CSSProperties}
            onClick={selectPreviewBlock}
            onScroll={syncActiveHeading}
          >
            {diffOn ? (
              <DiffViewer
                oldText={baseContent}
                newText={visibleContent}
                rows={diffRows as DiffRow[]}
                view={mode === 'edit' ? 'raw' : 'preview'}
                split={diffSplit}
              />
            ) : (
              <>
                {frontmatter.entries.length ? <FrontmatterCard entries={frontmatter.entries} /> : null}
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </>
            )}
          </article>
          {selectedPreviewIndex !== null ? <span className="preview-selection-note">선택한 블록을 AI 컨텍스트로 사용할 수 있습니다.</span> : null}
        </div>
      </div>
    </section>
  );
}

function parseHeadings(markdownText: string) {
  return markdownText
    .split(/\r?\n/)
    .map((line, index) => {
      const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
      if (!match) return null;
      return {
        level: match[1].length,
        text: match[2].replace(/[#*_`[\]]/g, '').trim(),
        line: index,
      };
    })
    .filter((item): item is { level: number; text: string; line: number } => Boolean(item));
}

function parseFrontmatter(markdownText: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdownText);
  if (!match) return { entries: [] as Array<{ key: string; value: string }>, body: markdownText };
  const entries = match[1]
    .split(/\r?\n/)
    .map(line => {
      const item = /^([^:#]+):\s*(.*)$/.exec(line);
      if (!item) return null;
      return { key: item[1].trim(), value: item[2].trim() };
    })
    .filter((item): item is { key: string; value: string } => Boolean(item));
  return { entries, body: markdownText.slice(match[0].length) };
}

function FrontmatterCard({ entries }: { entries: Array<{ key: string; value: string }> }) {
  return (
    <section className="frontmatter-card" aria-label="문서 메타데이터">
      {entries.map(entry => (
        <div className="frontmatter-item" key={entry.key}>
          <span>{entry.key}</span>
          <strong>{entry.value || '-'}</strong>
        </div>
      ))}
    </section>
  );
}

function DiffViewer({
  oldText,
  newText,
  rows,
  view,
  split,
}: {
  oldText: string;
  newText: string;
  rows: DiffRow[];
  view: 'preview' | 'raw';
  split: boolean;
}) {
  if (view === 'raw') {
    return split
      ? <RawSplitDiff rows={lineDiffRows(oldText, newText)} />
      : <RawUnifiedDiff rows={lineDiffRows(oldText, newText)} />;
  }
  return split ? <PreviewSplitDiff rows={rows} /> : <PreviewUnifiedDiff rows={rows} />;
}

function PreviewUnifiedDiff({ rows }: { rows: DiffRow[] }) {
  if (!rows.some(row => row.type !== 'same')) return <div className="preview-diff-empty">변경 사항 없음</div>;
  return (
    <div className="preview-diff-page">
      <div className="diff-head">프리뷰 Diff</div>
      <div className="preview-diff-list">
        {rows.flatMap((row, index) => {
          if (row.type === 'change') {
            return [
              <PreviewDiffBlock key={`old-${index}`} row={row} side="old" />,
              <PreviewDiffBlock key={`new-${index}`} row={row} side="new" />,
            ];
          }
          return [<PreviewDiffBlock key={`${row.type}-${index}`} row={row} side={row.type === 'del' ? 'old' : 'new'} />];
        })}
      </div>
    </div>
  );
}

function PreviewSplitDiff({ rows }: { rows: DiffRow[] }) {
  if (!rows.some(row => row.type !== 'same')) return <div className="preview-diff-empty">변경 사항 없음</div>;
  return (
    <div className="preview-diff-split">
      <section>
        <div className="diff-head">프리뷰 · 기존</div>
        <div className="preview-diff-list">
          {rows.map((row, index) => <PreviewDiffBlock key={`old-${index}`} row={row} side="old" split />)}
        </div>
      </section>
      <section>
        <div className="diff-head">프리뷰 · 변경</div>
        <div className="preview-diff-list">
          {rows.map((row, index) => <PreviewDiffBlock key={`new-${index}`} row={row} side="new" split />)}
        </div>
      </section>
    </div>
  );
}

function PreviewDiffBlock({ row, side, split = false }: { row: DiffRow; side: 'old' | 'new'; split?: boolean }) {
  const hidden = (row.type === 'add' && side === 'old') || (row.type === 'del' && side === 'new');
  const oldText = blockToDiffText(row.oldBlock);
  const newText = blockToDiffText(row.newBlock);
  const text = side === 'old' ? oldText : newText;
  const parts = row.type === 'change'
    ? inlineDiffParts(oldText, newText, side)
    : tokenizeInlineDiffText(text, row.type !== 'same');
  const mark = row.type === 'same' ? '' : side === 'old' ? '-' : '+';
  const sideClass = row.type === 'change' ? (side === 'old' ? 'change-old' : 'change-new') : '';
  return (
    <section className={`preview-diff-block ${row.type} ${sideClass} ${hidden ? 'hidden-placeholder' : ''} ${split ? 'split' : ''}`}>
      <span className="preview-diff-mark" aria-hidden="true">{mark}</span>
      <p className="preview-diff-rendered">
        {parts.length ? parts.map((part, index) => (
          <span
            className={`preview-diff-token ${part.code ? 'code' : ''} ${part.changed ? `changed ${side}` : ''}`}
            key={`${part.text}-${index}`}
          >
            {part.text}
          </span>
        )) : <span>&nbsp;</span>}
      </p>
    </section>
  );
}

type InlineDiffPart = {
  text: string;
  code: boolean;
  changed: boolean;
};

function blockToDiffText(block = '') {
  return String(block || '')
    .split(/\r?\n/)
    .map(line => line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '')
      .replace(/^\s*>\s?/, '')
      .trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function inlineDiffParts(oldText: string, newText: string, side: 'old' | 'new') {
  const text = side === 'old' ? oldText : newText;
  const compare = side === 'old' ? newText : oldText;
  if (!text) return [];
  let start = 0;
  while (start < text.length && start < compare.length && text[start] === compare[start]) {
    start += 1;
  }
  let textEnd = text.length - 1;
  let compareEnd = compare.length - 1;
  while (textEnd >= start && compareEnd >= start && text[textEnd] === compare[compareEnd]) {
    textEnd -= 1;
    compareEnd -= 1;
  }
  const segments = [
    { text: text.slice(0, start), changed: false },
    { text: text.slice(start, textEnd + 1), changed: true },
    { text: text.slice(textEnd + 1), changed: false },
  ].filter(segment => segment.text.length > 0);
  return segments.flatMap(segment => tokenizeInlineDiffText(segment.text, segment.changed));
}

function tokenizeInlineDiffText(text: string, changed: boolean): InlineDiffPart[] {
  const parts: InlineDiffPart[] = [];
  const pattern = /(`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), code: false, changed });
    }
    parts.push({ text: match[1].slice(1, -1), code: true, changed });
    lastIndex = match.index + match[1].length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), code: false, changed });
  }
  return parts;
}

function RawUnifiedDiff({ rows }: { rows: LineDiffRow[] }) {
  return (
    <div className="raw-diff-page">
      <div className="diff-head">편집 RAW DIFF</div>
      <div className="raw-diff-lines">
        {rows.map((row, index) => (
          <RawLine row={row} key={`${row.type}-${index}`} />
        ))}
      </div>
    </div>
  );
}

function RawSplitDiff({ rows }: { rows: LineDiffRow[] }) {
  return (
    <div className="raw-diff-split">
      <section>
        <div className="diff-head">편집 RAW · 기준</div>
        <div className="raw-diff-lines">
          {rows.map((row, index) => <RawLine row={row} side="old" key={`old-${index}`} />)}
        </div>
      </section>
      <section>
        <div className="diff-head">편집 RAW · 변경</div>
        <div className="raw-diff-lines">
          {rows.map((row, index) => <RawLine row={row} side="new" key={`new-${index}`} />)}
        </div>
      </section>
    </div>
  );
}

function RawLine({ row, side }: { row: LineDiffRow; side?: 'old' | 'new' }) {
  if (side === 'old' && row.type === 'add') return <div className="raw-diff-line placeholder"><span /><span /><span /></div>;
  if (side === 'new' && row.type === 'del') return <div className="raw-diff-line placeholder"><span /><span /><span /></div>;
  const text = side === 'old' ? row.oldText : side === 'new' ? row.newText : row.newText || row.oldText || '';
  const number = side === 'old' ? row.oldNo : side === 'new' ? row.newNo : row.newNo || row.oldNo;
  const mark = row.type === 'add' ? '+' : row.type === 'del' ? '-' : '';
  return (
    <div className={`raw-diff-line ${row.type}`}>
      <span className="raw-num">{number || ''}</span>
      {!side ? <span className="raw-num">{row.newNo || ''}</span> : null}
      <span className="raw-mark">{mark}</span>
      <code>{text}</code>
    </div>
  );
}

function lineDiffRows(oldText: string, newText: string): LineDiffRow[] {
  const oldLines = String(oldText || '').split('\n');
  const newLines = String(newText || '').split('\n');
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: LineDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldLines[i] === newLines[j]) {
      rows.push({ type: 'same', oldNo: i + 1, newNo: j + 1, oldText: oldLines[i], newText: newLines[j] });
      i += 1; j += 1;
    } else if (j < m && (i === n || dp[i][j + 1] > dp[i + 1]?.[j])) {
      rows.push({ type: 'add', newNo: j + 1, newText: newLines[j] });
      j += 1;
    } else if (i < n) {
      rows.push({ type: 'del', oldNo: i + 1, oldText: oldLines[i] });
      i += 1;
    }
  }
  return rows;
}
