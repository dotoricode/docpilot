import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type WheelEvent } from 'react';
import { Compartment, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, highlightActiveLine, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript as codeMirrorJavascript } from '@codemirror/lang-javascript';
import { json as codeMirrorJson } from '@codemirror/lang-json';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { closeSearchPanel, search, searchKeymap } from '@codemirror/search';
import { tags as syntaxTags } from '@lezer/highlight';
import MarkdownIt from 'markdown-it';
import type { RenderRule } from 'markdown-it/lib/renderer.mjs';
import Token from 'markdown-it/lib/token.mjs';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdownHighlight from 'highlight.js/lib/languages/markdown';
import objectivec from 'highlight.js/lib/languages/objectivec';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { DotsThreeVertical } from '@phosphor-icons/react';
import { markdownBlockDiffRows, markdownPreviewBlocks } from '../../../../shared/core/markdown-block-diff';
import { getMarkdownDocumentEligibility } from '../../../../shared/core/document-adapters';
import { convertAsciidoc, copyText, readWorkspaceFileBase, workspaceAssetUrl } from '../../shared/bridge-client';
import { sanitizeRenderedDocumentHtml } from '../../shared/sanitize-rendered-html';
import { copyTextWithActiveInstructions } from '../../shared/copy-with-instructions';
import { formatContextLocation } from '../../shared/context-format';
import { DocumentMarkdownEditor, type DocumentMarkdownEditorHandle } from './DocumentMarkdownEditor';
import { JsonTreeView } from './JsonTreeView';
import { hydrateMermaidDiagrams } from './mermaid-renderer';

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
  primaryFileTabs?: ReactNode;
  secondaryFileTabs?: ReactNode;
  reviewDiff?: { fileId: string; before: string; signal: number } | null;
  secondaryBuffer?: FileBuffer;
  activePreviewPane: 'primary' | 'secondary';
  splitOrientation: 'horizontal' | 'vertical';
  contextChips: ContextChipView[];
  onSelectionChange: (selection: { fileId: string; text: string; from: number; to: number; lineStart?: number; lineEnd?: number } | null) => void;
  onPreviewContextPick: (selection: { fileId: string; text: string; from: number; to: number; lineStart?: number; lineEnd?: number }) => void;
  onRemoveContextChip: (id: string) => void;
  onCopyContextChips: () => void;
  onClearContextChips: () => void;
  onChange: (content: string) => void;
  onApplySourceEdit: (request: { fileId: string; expectedContent: string; nextContent: string; saveAfter: boolean }) => Promise<boolean>;
  onSave: (contentOverride?: string) => void;
  suppressMarkdownDocumentReadonlyNotice: boolean;
  onSuppressMarkdownDocumentReadonlyNotice: () => void;
  onRegisterDocumentFlush: (flush: (() => string | null) | null) => void;
  onReloadConflict: () => void;
  onOverwriteConflict: () => void;
  onCloseSecondary: (activePane?: 'primary' | 'secondary') => void;
  onOpenCurrentInSplit: () => void;
  onActivePreviewPaneChange: (pane: 'primary' | 'secondary') => void;
  onSplitOrientationChange: (orientation: 'horizontal' | 'vertical') => void;
};

type ContextChipView = {
  id: string;
  fileId: string;
  text: string;
  from: number;
  to: number;
  lineStart?: number;
  lineEnd?: number;
};

type PreviewContext = Omit<ContextChipView, 'id'>;

type PreviewCopyTarget = PreviewContext & {
  pane: 'primary' | 'secondary';
  x: number;
  y: number;
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

type SemanticType = 'contract' | 'observed' | 'meaning' | 'risk' | 'note';

type SemanticRule = {
  prefix: string;
  type: SemanticType;
  label: string;
};

type IndentMode = 'spaces' | 'tabs';
type CommandPaletteMode = 'commands' | 'tab-size';
type BodyMode = 'preview' | 'document' | 'tree' | 'edit';

type CopyFeedback = {
  text: string;
  x: number;
  y: number;
};

type PreviewSelectionBookmark = {
  pane: 'primary' | 'secondary';
  blockIndex: number;
  start: number;
  end: number;
};

type InlinePreviewEdit = {
  fileId: string;
  from: number;
  to: number;
  lineStart: number;
  lineEnd: number;
  originalDocument: string;
  originalSlice: string;
  value: string;
  top: number;
  left: number;
  width: number;
  error: string;
};

type CommandItem = {
  id: string;
  label: string;
  detail?: string;
  run: () => void;
};

const SEMANTIC_RULES: SemanticRule[] = [
  { prefix: '관련 계약:', type: 'contract', label: '관련 계약' },
  { prefix: '관찰된 선택:', type: 'observed', label: '관찰된 선택' },
  { prefix: '의미:', type: 'meaning', label: '의미' },
  { prefix: '주의:', type: 'risk', label: '주의' },
  { prefix: '위험:', type: 'risk', label: '위험' },
  { prefix: '참고:', type: 'note', label: '참고' },
];

const RISK_KEYWORDS = [
  'Admin Console credential',
  'credential',
  'secret',
  'password',
  '보안 탐지 알고리즘',
  '기록하지 않는다',
];

const emptyDocument = `# DocPilot

왼쪽에서 Markdown 파일을 선택하세요.
`;

function conflictStateLabel(state: string) {
  switch (state) {
    case 'agent-change': return '에이전트 변경';
    case 'external-change': return '외부 변경';
    case 'agent-conflict': return '에이전트 변경 충돌';
    case 'external-conflict': return '외부 변경 충돌';
    case 'dirty-conflict': return '저장 충돌';
    default: return state;
  }
}

const PREVIEW_WIDTH_MIN = 480;
const PREVIEW_WIDTH_MAX = 2400;
const PREVIEW_WIDTH_STEP = 20;
const PREVIEW_WIDTH_STORAGE_KEY = 'docpilot:preview-width';
const PREVIEW_WIDTH_EXPLICIT_STORAGE_KEY = 'docpilot:preview-width-explicit-v1';
const TRANSIENT_COPY_UI_MS = 1600;
const PREVIEW_LINE_NUMBERS_STORAGE_KEY = 'docpilot:preview-line-numbers-v2';

const RenderedPreviewHtml = memo(function RenderedPreviewHtml({ html }: { html: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (rootRef.current) hydrateMermaidDiagrams(rootRef.current);
  }, [html]);
  return <div ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />;
});

function readStoredPreviewWidth() {
  if (window.localStorage.getItem(PREVIEW_WIDTH_EXPLICIT_STORAGE_KEY) !== '1') return null;
  const raw = window.localStorage.getItem(PREVIEW_WIDTH_STORAGE_KEY);
  if (raw === null) return null;
  const stored = Number(raw);
  return Number.isFinite(stored) && stored > 0
    ? clampNumber(stored, PREVIEW_WIDTH_MIN, PREVIEW_WIDTH_MAX)
    : null;
}

registerHighlightLanguages();

const markdownRenderer = new MarkdownIt({
  html: false,
  highlight: (code, language) => renderHighlightedCode(code, language),
  linkify: true,
  typographer: false,
});

// AsciiDoc conversion runs in bridge.js (Node/CommonJS), not in this
// renderer: @asciidoctor/core's Opal runtime assumes sloppy-mode execution
// (it reassigns Function#length and relies on unbound `this`), both of which
// throw under the strict mode that ES modules force. safe: 'secure' is
// hardcoded bridge-side — see bridge.js's /adoc-convert handler.
const ASCIIDOC_PREVIEW_PENDING_HTML = `
  <div class="docpilot-preview-loading">
    <p class="docpilot-preview-loading-label">AsciiDoc 미리보기 준비 중…</p>
    <div class="docpilot-preview-loading-track"><div class="docpilot-preview-loading-bar"></div></div>
  </div>
`;
const ASCIIDOC_PREVIEW_ERROR_HTML = '<p class="docpilot-preview-error">AsciiDoc 렌더링 중 오류가 발생했습니다.</p>';
const ASCIIDOC_RENDER_CACHE_LIMIT = 8;
const asciidocRenderCache = new Map<string, string>();

function isAsciidocBackpressureError(error: unknown) {
  return error instanceof Error && /HTTP 429\b/.test(error.message);
}

function asciidocPreviewCacheKey(filePath: string, source: string) {
  return `${filePath}:${source.length}:${fastHashString(source)}`;
}

function fastHashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getCachedAsciidocHtml(key: string) {
  const html = asciidocRenderCache.get(key);
  if (html === undefined) return undefined;
  asciidocRenderCache.delete(key);
  asciidocRenderCache.set(key, html);
  return html;
}

function setCachedAsciidocHtml(key: string, html: string) {
  asciidocRenderCache.set(key, html);
  if (asciidocRenderCache.size > ASCIIDOC_RENDER_CACHE_LIMIT) {
    const oldestKey = asciidocRenderCache.keys().next().value;
    if (oldestKey) asciidocRenderCache.delete(oldestKey);
  }
}

function normalizeRelativePath(value: string) {
  const stack: string[] = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

// Markdown image sources are written relative to the document's own file,
// same as plain (non-Antora) AsciiDoc — resolve them against a
// /workspace-asset URL so they load from the actual workspace path instead
// of the renderer page's own origin.
function resolveWorkspaceAssetSrc(rawSrc: string, docId: string) {
  if (/^(https?:|data:|\/\/)/i.test(rawSrc)) return rawSrc;
  const docDir = docId.includes('/') ? docId.slice(0, docId.lastIndexOf('/')) : '';
  const resolved = normalizeRelativePath(docDir ? `${docDir}/${rawSrc}` : rawSrc);
  return workspaceAssetUrl(resolved);
}

const defaultImageRule = markdownRenderer.renderer.rules.image
  || markdownRenderer.renderer.renderToken.bind(markdownRenderer.renderer);
markdownRenderer.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const src = token.attrGet('src');
  const docId = (env as { docId?: string } | undefined)?.docId || '';
  if (src) token.attrSet('src', resolveWorkspaceAssetSrc(src, docId));
  return defaultImageRule(tokens, index, options, env, self);
};

markdownRenderer.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const lineStart = Array.isArray(token.map) ? token.map[0] + 2 : undefined;
  const lineEnd = Array.isArray(token.map) ? Math.max(lineStart || 0, token.map[1] - 1) : undefined;
  if (normalizeHighlightLanguage(token.info) === 'mermaid') {
    return `<figure class="mermaid-diagram preview-mermaid-diagram" data-mermaid-pending="true"><pre class="mermaid-source">${escapeHtml(token.content)}</pre><div class="mermaid-render-target" role="img" aria-label="Mermaid diagram">다이어그램 렌더링 중…</div></figure>\n`;
  }
  return `${renderHighlightedCode(token.content, token.info, lineStart, lineEnd)}\n`;
};

markdownRenderer.renderer.rules.code_block = (tokens, index) => {
  const token = tokens[index];
  const lineStart = Array.isArray(token.map) ? token.map[0] + 1 : undefined;
  const lineEnd = Array.isArray(token.map) ? Math.max(lineStart || 0, token.map[1]) : undefined;
  return `${renderCodeBlock(escapeHtml(token.content), 'text', false, lineStart, lineEnd)}\n`;
};

// `html: false` above blocks all raw HTML (previewHtml goes straight into
// dangerouslySetInnerHTML with no sanitizer, and the renderer exposes
// window.docpilot to page script — arbitrary HTML would be a real XSS-to-IPC
// hole). This rule whitelists exactly the `<details><summary>...</summary>` /
// `</details>` collapsible-section pattern instead of flipping that option.
markdownRenderer.block.ruler.before('fence', 'docpilot_details', (state, startLine, endLine, silent) => {
  const startText = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim();
  if (startText !== '<details>') return false;

  let summaryLine = -1;
  let summaryText = '';
  let closeLine = -1;
  for (let line = startLine + 1; line < endLine; line += 1) {
    const lineText = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
    if (summaryLine === -1) {
      if (lineText.length === 0) continue;
      const match = /^<summary>([\s\S]*)<\/summary>$/.exec(lineText);
      if (!match) return false;
      summaryLine = line;
      summaryText = match[1];
      continue;
    }
    if (lineText === '</details>') {
      closeLine = line;
      break;
    }
  }
  if (closeLine === -1) return false;
  if (silent) return true;

  const openToken = state.push('docpilot_details_open', 'details', 1);
  openToken.map = [startLine, closeLine + 1];

  const summaryToken = state.push('html_block', '', 0);
  summaryToken.content = `<summary>${renderDetailsSummary(summaryText)}</summary>\n`;
  summaryToken.map = [summaryLine, summaryLine + 1];

  state.md.block.tokenize(state, summaryLine + 1, closeLine);

  state.push('docpilot_details_close', 'details', -1);
  state.line = closeLine + 1;
  return true;
});

markdownRenderer.renderer.rules.docpilot_details_open = () => '<details>\n';
markdownRenderer.renderer.rules.docpilot_details_close = () => '</details>\n';

/** Escapes everything in a `<summary>` line except whitelisted `<code>...</code>` spans. */
function renderDetailsSummary(text: string) {
  const codeSpan = /<code>([\s\S]*?)<\/code>/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = codeSpan.exec(text))) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    result += `<code>${escapeHtml(match[1])}</code>`;
    lastIndex = codeSpan.lastIndex;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

const lineLabeledOpenRule: RenderRule = (tokens, index, options, _env, self) => {
  addTokenLineAttrs(tokens[index]);
  return self.renderToken(tokens, index, options);
};

for (const ruleName of ['heading_open', 'paragraph_open', 'list_item_open', 'table_open', 'blockquote_open'] as const) {
  markdownRenderer.renderer.rules[ruleName] = lineLabeledOpenRule;
}

markdownRenderer.core.ruler.after('inline', 'docpilot_semantic_paragraphs', state => {
  for (let index = 0; index < state.tokens.length - 2; index += 1) {
    const open = state.tokens[index];
    const inline = state.tokens[index + 1];
    const close = state.tokens[index + 2];
    if (open.type !== 'paragraph_open' || inline.type !== 'inline' || close.type !== 'paragraph_close') continue;
    const plainText = inline.content.trim();
    const rule = SEMANTIC_RULES.find(item => plainText.startsWith(item.prefix));
    if (rule) {
      const childrenWithoutPrefix = removePrefixFromInlineTokens(inline.children || [], rule.prefix);
      open.attrJoin('class', `md-semantic-line md-semantic-line--${rule.type}`);
      inline.children = [
        makeHtmlInline(`<span class="md-semantic-label">${escapeHtml(rule.label)}</span><span class="md-semantic-content">`),
        ...(rule.type === 'risk' ? highlightRiskKeywordsInInlineTokens(childrenWithoutPrefix) : childrenWithoutPrefix),
        makeHtmlInline('</span>'),
      ];
    }
  }
});

const editorCursorTheme = EditorView.theme({
  '&.cm-editor': {
    caretColor: 'var(--cm-editor-cursor)',
  },
  '.cm-content': {
    caretColor: 'var(--cm-editor-cursor)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--cm-editor-cursor)',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--cm-editor-line-highlight)',
  },
  '.cm-focused .cm-activeLine': {
    backgroundColor: 'var(--cm-editor-line-highlight)',
  },
});

const editorSyntaxHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [syntaxTags.heading, syntaxTags.heading1, syntaxTags.heading2, syntaxTags.heading3, syntaxTags.heading4, syntaxTags.heading5, syntaxTags.heading6], color: 'var(--cm-syntax-heading)', fontWeight: '780' },
  { tag: syntaxTags.strong, color: 'var(--cm-syntax-strong)', fontWeight: '780' },
  { tag: syntaxTags.emphasis, color: 'var(--cm-syntax-emphasis)', fontStyle: 'italic' },
  { tag: [syntaxTags.link, syntaxTags.url], color: 'var(--cm-syntax-link)' },
  { tag: syntaxTags.monospace, color: 'var(--cm-syntax-inline-code)' },
  { tag: syntaxTags.quote, color: 'var(--cm-syntax-quote)' },
  { tag: syntaxTags.list, color: 'var(--cm-syntax-list)' },
  { tag: syntaxTags.contentSeparator, color: 'var(--cm-syntax-punctuation)' },
  { tag: [syntaxTags.keyword, syntaxTags.operatorKeyword, syntaxTags.modifier], color: 'var(--cm-syntax-keyword)' },
  { tag: [syntaxTags.atom, syntaxTags.bool, syntaxTags.null, syntaxTags.number, syntaxTags.integer, syntaxTags.float], color: 'var(--cm-syntax-constant)' },
  { tag: [syntaxTags.string, syntaxTags.special(syntaxTags.string), syntaxTags.regexp], color: 'var(--cm-syntax-string)' },
  { tag: [syntaxTags.comment, syntaxTags.lineComment, syntaxTags.blockComment], color: 'var(--cm-syntax-comment)', fontStyle: 'italic' },
  { tag: [syntaxTags.definition(syntaxTags.variableName), syntaxTags.function(syntaxTags.variableName), syntaxTags.function(syntaxTags.propertyName)], color: 'var(--cm-syntax-function)' },
  { tag: [syntaxTags.variableName, syntaxTags.self, syntaxTags.standard(syntaxTags.variableName)], color: 'var(--cm-syntax-variable)' },
  { tag: [syntaxTags.propertyName, syntaxTags.attributeName, syntaxTags.labelName], color: 'var(--cm-syntax-property)' },
  { tag: [syntaxTags.typeName, syntaxTags.className, syntaxTags.namespace, syntaxTags.definition(syntaxTags.typeName)], color: 'var(--cm-syntax-type)' },
  { tag: [syntaxTags.operator, syntaxTags.punctuation, syntaxTags.separator, syntaxTags.bracket], color: 'var(--cm-syntax-punctuation)' },
  { tag: syntaxTags.invalid, color: 'var(--cm-syntax-invalid)', textDecoration: 'underline wavy var(--cm-syntax-invalid)' },
]), { fallback: true });

export function EditorPane({
  buffer,
  error,
  saving,
  primaryFileTabs,
  secondaryFileTabs,
  reviewDiff,
  secondaryBuffer,
  activePreviewPane,
  splitOrientation,
  contextChips,
  onSelectionChange,
  onPreviewContextPick,
  onRemoveContextChip,
  onCopyContextChips,
  onClearContextChips,
  onChange,
  onApplySourceEdit,
  onSave,
  suppressMarkdownDocumentReadonlyNotice,
  onSuppressMarkdownDocumentReadonlyNotice,
  onRegisterDocumentFlush,
  onReloadConflict,
  onOverwriteConflict,
  onCloseSecondary,
  onOpenCurrentInSplit,
  onActivePreviewPaneChange,
  onSplitOrientationChange,
}: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const secondaryPreviewRef = useRef<HTMLElement | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const documentShellRef = useRef<HTMLDivElement | null>(null);
  const documentEditorRef = useRef<DocumentMarkdownEditorHandle | null>(null);
  const tocRef = useRef<HTMLElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activePreviewPaneRef = useRef<'primary' | 'secondary'>(activePreviewPane);
  const activeHeadingFrameRef = useRef<number | null>(null);
  const activeHeadingScrollFrameRef = useRef<number | null>(null);
  const activeHeadingScrollIdleRef = useRef<number | null>(null);
  const previewScrollbarIdleTimersRef = useRef(new Map<HTMLElement, number>());
  const activeHeadingLastUpdateRef = useRef(0);
  const shouldScrollTocActiveRef = useRef(false);
  const headingOffsetsRef = useRef<number[]>([]);
  const rangeSelectionHandledRef = useRef(false);
  const previewSelectionBookmarkRef = useRef<PreviewSelectionBookmark | null>(null);
  const readonlyNoticeShownRef = useRef(new Set<string>());
  const lastExternalDocRef = useRef('');
  const pathRef = useRef(buffer.path);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const editorMoreMenuRef = useRef<HTMLDetailsElement | null>(null);
  const previewFindShouldScrollRef = useRef(false);
  const pendingModeLineRef = useRef<number | null>(null);
  const languageCompartment = useMemo(() => new Compartment(), []);
  const indentCompartment = useMemo(() => new Compartment(), []);
  const [indentMode, setIndentMode] = useState<IndentMode>(() => readIndentSettings(buffer.path).mode);
  const [tabSize, setTabSize] = useState(() => readIndentSettings(buffer.path).tabSize);
  const [pendingIndentMode, setPendingIndentMode] = useState<IndentMode>('spaces');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteMode, setCommandPaletteMode] = useState<CommandPaletteMode>('commands');
  const [commandQuery, setCommandQuery] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [mode, setMode] = useState<BodyMode>(() => defaultBodyModeForPath(buffer.path));
  const [diffOn, setDiffOn] = useState(false);
  const [diffSplit, setDiffSplit] = useState(false);
  const [baseContent, setBaseContent] = useState('');
  const [storedPreviewWidth] = useState(readStoredPreviewWidth);
  const [previewWidth, setPreviewWidth] = useState(() => storedPreviewWidth ?? PREVIEW_WIDTH_MAX);
  const previewWidthExplicitRef = useRef(storedPreviewWidth !== null);
  const [previewMaxWidth, setPreviewMaxWidth] = useState(PREVIEW_WIDTH_MAX);
  const effectivePreviewWidth = Math.min(previewWidth, previewMaxWidth);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number | null>(null);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState(0);
  const [wholeDocumentSelected, setWholeDocumentSelected] = useState(false);
  const [showPreviewLineNumbers, setShowPreviewLineNumbers] = useState(
    () => window.localStorage.getItem(PREVIEW_LINE_NUMBERS_STORAGE_KEY) === '1',
  );
  const [previewCopyTarget, setPreviewCopyTarget] = useState<PreviewCopyTarget | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const [contextRailVisible, setContextRailVisible] = useState(false);
  const [agentCopyEnabled, setAgentCopyEnabled] = useState(false);
  const [documentSafetyFailure, setDocumentSafetyFailure] = useState('');
  const [documentCommitPending, setDocumentCommitPending] = useState(false);
  const [readonlyNotice, setReadonlyNotice] = useState<{ path: string; reason: string; suppress: boolean } | null>(null);
  const [inlinePreviewEdit, setInlinePreviewEdit] = useState<InlinePreviewEdit | null>(null);
  const [previewFindOpen, setPreviewFindOpen] = useState(false);
  const [previewFindQuery, setPreviewFindQuery] = useState('');
  const [previewFindIndex, setPreviewFindIndex] = useState(0);
  const [previewFindMatchCount, setPreviewFindMatchCount] = useState(0);
  const [previewFindScrollVersion, setPreviewFindScrollVersion] = useState(0);
  const [previewSplitRatio, setPreviewSplitRatio] = useState(0.5);
  const [asciidocResult, setAsciidocResult] = useState<{ key: string; html: string } | null>(null);
  const [secondaryAsciidocResult, setSecondaryAsciidocResult] = useState<{ key: string; html: string } | null>(null);

  useEffect(() => {
    if (!previewWidthExplicitRef.current) return;
    window.localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, String(previewWidth));
    window.localStorage.setItem(PREVIEW_WIDTH_EXPLICIT_STORAGE_KEY, '1');
  }, [previewWidth]);

  const visibleContent = buffer.path ? buffer.editorContent : emptyDocument;
  const secondaryVisibleContent = secondaryBuffer?.path ? secondaryBuffer.editorContent : '';
  const canPreviewBody = isPreviewableFile(buffer.path);
  const canPreviewSecondaryBody = isPreviewableFile(secondaryBuffer?.path || '');
  const markdownPreviewBody = isMarkdownPreviewFile(buffer.path);
  const jsonDocument = /\.json$/i.test(buffer.path);
  const primaryIsAsciidoc = isAsciidocPreviewFile(buffer.path);
  const secondaryIsAsciidoc = isAsciidocPreviewFile(secondaryBuffer?.path || '');
  const previewAsSource = isSourcePreviewFile(buffer.path);
  const secondaryPreviewAsSource = isSourcePreviewFile(secondaryBuffer?.path || '');

  const frontmatter = useMemo(() => markdownPreviewBody ? parseFrontmatter(visibleContent) : { entries: [], body: visibleContent }, [markdownPreviewBody, visibleContent]);
  const frontmatterPrefix = visibleContent.slice(0, Math.max(0, visibleContent.length - frontmatter.body.length));
  const documentEligibility = useMemo(() => getMarkdownDocumentEligibility(frontmatter.body), [frontmatter.body]);
  const secondaryFrontmatter = useMemo(
    () => isMarkdownPreviewFile(secondaryBuffer?.path || '') ? parseFrontmatter(secondaryVisibleContent) : { entries: [], body: secondaryVisibleContent },
    [secondaryBuffer?.path, secondaryVisibleContent],
  );
  const previewSource = previewAsSource ? visibleContent : frontmatter.body || visibleContent;
  const secondaryPreviewSource = secondaryPreviewAsSource ? secondaryVisibleContent : secondaryFrontmatter.body || secondaryVisibleContent;

  useEffect(() => {
    if (!primaryIsAsciidoc) return;
    const key = asciidocPreviewCacheKey(buffer.path, previewSource);
    if (asciidocResult?.key === key) return;
    const cachedHtml = getCachedAsciidocHtml(key);
    if (cachedHtml !== undefined) {
      setAsciidocResult({ key, html: cachedHtml });
      return;
    }
    let cancelled = false;
    let retryTimer = 0;
    const render = () => {
      convertAsciidoc(previewSource, buffer.path)
        .then(result => {
          const html = sanitizeRenderedDocumentHtml(result.html);
          setCachedAsciidocHtml(key, html);
          if (!cancelled) setAsciidocResult({ key, html });
        })
        .catch(error => {
          if (cancelled) return;
          if (isAsciidocBackpressureError(error)) {
            retryTimer = window.setTimeout(render, 250);
            return;
          }
          console.error('AsciiDoc render failed', error);
          setAsciidocResult({ key, html: ASCIIDOC_PREVIEW_ERROR_HTML });
        });
    };
    const timer = window.setTimeout(render, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [primaryIsAsciidoc, buffer.path, previewSource, asciidocResult]);

  useEffect(() => {
    if (!secondaryIsAsciidoc) return;
    const key = asciidocPreviewCacheKey(secondaryBuffer?.path || '', secondaryPreviewSource);
    if (secondaryAsciidocResult?.key === key) return;
    const cachedHtml = getCachedAsciidocHtml(key);
    if (cachedHtml !== undefined) {
      setSecondaryAsciidocResult({ key, html: cachedHtml });
      return;
    }
    let cancelled = false;
    let retryTimer = 0;
    const render = () => {
      convertAsciidoc(secondaryPreviewSource, secondaryBuffer?.path || '')
        .then(result => {
          const html = sanitizeRenderedDocumentHtml(result.html);
          setCachedAsciidocHtml(key, html);
          if (!cancelled) setSecondaryAsciidocResult({ key, html });
        })
        .catch(error => {
          if (cancelled) return;
          if (isAsciidocBackpressureError(error)) {
            retryTimer = window.setTimeout(render, 250);
            return;
          }
          console.error('AsciiDoc render failed', error);
          setSecondaryAsciidocResult({ key, html: ASCIIDOC_PREVIEW_ERROR_HTML });
        });
    };
    const timer = window.setTimeout(render, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [secondaryIsAsciidoc, secondaryBuffer?.path, secondaryPreviewSource, secondaryAsciidocResult]);

  const previewHtml = useMemo(() => {
    if (primaryIsAsciidoc) {
      const key = asciidocPreviewCacheKey(buffer.path, previewSource);
      return asciidocResult?.key === key
        ? asciidocResult.html
        : getCachedAsciidocHtml(key) ?? ASCIIDOC_PREVIEW_PENDING_HTML;
    }
    return renderPreviewHtml(previewSource, buffer.path);
  }, [primaryIsAsciidoc, asciidocResult, previewSource, buffer.path]);
  const secondaryPreviewHtml = useMemo(() => {
    if (secondaryIsAsciidoc) {
      const key = asciidocPreviewCacheKey(secondaryBuffer?.path || '', secondaryPreviewSource);
      return secondaryAsciidocResult?.key === key
        ? secondaryAsciidocResult.html
        : getCachedAsciidocHtml(key) ?? ASCIIDOC_PREVIEW_PENDING_HTML;
    }
    return renderPreviewHtml(secondaryPreviewSource, secondaryBuffer?.path || '');
  }, [secondaryIsAsciidoc, secondaryAsciidocResult, secondaryPreviewSource, secondaryBuffer?.path]);
  const headings = useMemo(() => {
    if (markdownPreviewBody) return parseHeadings(previewSource);
    if (primaryIsAsciidoc) return parseHeadingsFromHtml(previewHtml, previewSource);
    return [];
  }, [markdownPreviewBody, previewSource, primaryIsAsciidoc, previewHtml]);
  const diffRows = useMemo(() => markdownBlockDiffRows(baseContent, visibleContent), [baseContent, visibleContent]);
  const compareOn = Boolean(secondaryBuffer?.path)
    && canPreviewBody
    && canPreviewSecondaryBody
    && !diffOn
    && (mode === 'preview' || mode === 'document');
  const documentEditable = mode === 'document'
    && markdownPreviewBody
    && documentEligibility.editable
    && !documentSafetyFailure
    && !agentCopyEnabled
    && !diffOn
    && !secondaryBuffer?.path;

  useEffect(() => {
    const shell = previewShellRef.current || documentShellRef.current;
    if (!shell || compareOn || diffOn || (mode !== 'preview' && mode !== 'document')) return;

    let frame = 0;
    const updateMaximum = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const shellRect = shell.getBoundingClientRect();
        const outlineRect = tocRef.current?.getBoundingClientRect();
        const availableRight = outlineRect && outlineRect.left > shellRect.left
          ? outlineRect.left
          : shellRect.right;
        const nextMaximum = clampNumber(
          Math.floor(availableRight - shellRect.left - 48),
          PREVIEW_WIDTH_MIN,
          PREVIEW_WIDTH_MAX,
        );
        setPreviewMaxWidth(nextMaximum);
      });
    };

    const observer = new ResizeObserver(updateMaximum);
    observer.observe(shell);
    if (tocRef.current) observer.observe(tocRef.current);
    updateMaximum();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [agentCopyEnabled, compareOn, diffOn, headings.length, contextChips.length, mode, documentEditable]);

  const previewCompareStyle = {
    '--preview-split-primary-size': `${Math.round(previewSplitRatio * 100)}%`,
  } as CSSProperties;
  const commandItems = commandPaletteMode === 'tab-size'
    ? tabSizeCommandItems(pendingIndentMode, tabSize, size => {
      setIndentMode(pendingIndentMode);
      setTabSize(size);
    }, closeCommandPalette)
    : editorCommandItems({
      indentMode,
      tabSize,
      setIndentMode,
      setCommandPaletteMode,
      setPendingIndentMode,
      setCommandQuery,
      setCommandIndex,
      closeCommandPalette,
      convertIndentation,
    });
  const commandResults = useMemo(
    () => filterCommandItems(commandItems, commandQuery),
    [commandItems, commandQuery],
  );

  useEffect(() => {
    activePreviewPaneRef.current = activePreviewPane;
  }, [activePreviewPane]);

  useEffect(() => {
    pathRef.current = buffer.path;
  }, [buffer.path]);

  useEffect(() => {
    const settings = readIndentSettings(buffer.path);
    setIndentMode(settings.mode);
    setTabSize(settings.tabSize);
  }, [buffer.path]);

  useEffect(() => {
    setMode(defaultBodyModeForPath(buffer.path));
    setDocumentSafetyFailure('');
    setDocumentCommitPending(false);
    setPreviewFindOpen(false);
    setPreviewFindQuery('');
    if (!canPreviewBody) setDiffOn(false);
  }, [canPreviewBody, jsonDocument, buffer.path]);

  useEffect(() => {
    if (
      mode !== 'document'
      || !markdownPreviewBody
      || documentEligibility.editable
      || suppressMarkdownDocumentReadonlyNotice
      || !buffer.path
      || readonlyNoticeShownRef.current.has(buffer.path)
    ) return;
    readonlyNoticeShownRef.current.add(buffer.path);
    setReadonlyNotice({ path: buffer.path, reason: String(documentEligibility.reason), suppress: false });
  }, [buffer.path, markdownPreviewBody, mode, suppressMarkdownDocumentReadonlyNotice, documentEligibility.editable, documentEligibility.reason]);

  useEffect(() => {
    window.localStorage.setItem(PREVIEW_LINE_NUMBERS_STORAGE_KEY, showPreviewLineNumbers ? '1' : '0');
  }, [showPreviewLineNumbers]);

  useEffect(() => {
    if (!copyFeedback) return undefined;
    const timer = window.setTimeout(() => setCopyFeedback(null), TRANSIENT_COPY_UI_MS);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  useEffect(() => {
    if (!contextChips.length) {
      setContextRailVisible(false);
      return undefined;
    }
    setContextRailVisible(true);
    const timer = window.setTimeout(() => setContextRailVisible(false), TRANSIENT_COPY_UI_MS);
    return () => window.clearTimeout(timer);
  }, [contextChips]);

  useEffect(() => {
    if (selectedPreviewIndex === null) return undefined;
    const timer = window.setTimeout(() => setSelectedPreviewIndex(null), TRANSIENT_COPY_UI_MS);
    return () => window.clearTimeout(timer);
  }, [selectedPreviewIndex]);

  useEffect(() => {
    const closeEditorMenuOnOutsideClick = (event: PointerEvent) => {
      const menu = editorMoreMenuRef.current;
      if (!menu?.open || menu.contains(event.target as Node)) return;
      menu.open = false;
    };
    document.addEventListener('pointerdown', closeEditorMenuOnOutsideClick, true);
    return () => document.removeEventListener('pointerdown', closeEditorMenuOnOutsideClick, true);
  }, []);

  useEffect(() => {
    if (!previewCopyTarget) return undefined;
    const copySelectedPreviewText = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') return;
      const selection = window.getSelection();
      const selectedText = selection?.toString() || '';
      if (!selectedText.trim()) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
      void copyText(selectedText).then(() => {
        setCopyFeedback(feedbackNearRect('복사됨', rect));
      });
    };
    window.addEventListener('keydown', copySelectedPreviewText, true);
    return () => window.removeEventListener('keydown', copySelectedPreviewText, true);
  }, [previewCopyTarget]);

  useEffect(() => {
    return () => {
      if (activeHeadingFrameRef.current !== null) {
        window.cancelAnimationFrame(activeHeadingFrameRef.current);
        activeHeadingFrameRef.current = null;
      }
      if (activeHeadingScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(activeHeadingScrollFrameRef.current);
        activeHeadingScrollFrameRef.current = null;
      }
      if (activeHeadingScrollIdleRef.current !== null) {
        window.clearTimeout(activeHeadingScrollIdleRef.current);
        activeHeadingScrollIdleRef.current = null;
      }
      for (const timer of previewScrollbarIdleTimersRef.current.values()) window.clearTimeout(timer);
      previewScrollbarIdleTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (activeHeadingFrameRef.current !== null) window.cancelAnimationFrame(activeHeadingFrameRef.current);
      activeHeadingFrameRef.current = window.requestAnimationFrame(() => {
        activeHeadingFrameRef.current = null;
        cachePreviewHeadingOffsets();
        updateActiveHeading();
      });
    };
    scheduleRefresh();
    const scrollContainer = activeHeadingScrollContainer();
    scrollContainer?.addEventListener('load', scheduleRefresh, true);
    window.addEventListener('resize', scheduleRefresh);
    return () => {
      scrollContainer?.removeEventListener('load', scheduleRefresh, true);
      window.removeEventListener('resize', scheduleRefresh);
      if (activeHeadingFrameRef.current !== null) {
        window.cancelAnimationFrame(activeHeadingFrameRef.current);
        activeHeadingFrameRef.current = null;
      }
    };
  }, [previewHtml, headings.length, previewWidth, documentEditable]);

  useEffect(() => {
    if (!previewFindOpen) return undefined;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.preview-find-bar')) return;
      closePreviewFind();
    };
    window.addEventListener('pointerdown', closeOnPointer, true);
    return () => window.removeEventListener('pointerdown', closeOnPointer, true);
  }, [previewFindOpen]);

  useEffect(() => {
    let disposed = false;
    if (!diffOn || !buffer.path) {
      setBaseContent('');
      return undefined;
    }
    if (reviewDiff?.fileId === buffer.path) {
      setBaseContent(reviewDiff.before);
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
  }, [buffer.path, diffOn, reviewDiff?.fileId, reviewDiff?.before, reviewDiff?.signal]);

  useEffect(() => {
    if (!reviewDiff || reviewDiff.fileId !== buffer.path) return;
    setMode(isPreviewableFile(buffer.path) ? 'preview' : 'edit');
    setDiffOn(true);
    setBaseContent(reviewDiff.before);
  }, [buffer.path, reviewDiff?.fileId, reviewDiff?.before, reviewDiff?.signal]);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: visibleContent,
        extensions: [
          languageCompartment.of(editorLanguageExtension(buffer.path)),
          history(),
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          editorCursorTheme,
          editorSyntaxHighlighting,
          indentCompartment.of(editorIndentExtensions(indentMode, tabSize)),
          search({ top: true }),
          keymap.of([indentWithTab, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of(update => {
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
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.reconfigure(editorLanguageExtension(buffer.path)),
    });
  }, [buffer.path, languageCompartment]);

  useEffect(() => {
    writeIndentSettings(buffer.path, indentMode, tabSize);
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: indentCompartment.reconfigure(editorIndentExtensions(indentMode, tabSize)),
    });
  }, [indentCompartment, indentMode, tabSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || visibleContent === lastExternalDocRef.current) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: visibleContent },
    });
    lastExternalDocRef.current = visibleContent;
  }, [visibleContent]);

  useLayoutEffect(() => {
    const targetLine = pendingModeLineRef.current;
    if (!targetLine) return;
    pendingModeLineRef.current = null;
    window.requestAnimationFrame(() => {
      if (mode === 'edit') {
        scrollEditorToLine(targetLine);
      } else {
        scrollPreviewToLine(targetLine);
      }
    });
  }, [mode, previewHtml, visibleContent]);

  useLayoutEffect(() => {
    const bookmark = previewSelectionBookmarkRef.current;
    if (!bookmark || !previewCopyTarget) return;
    const preview = bookmark.pane === 'secondary' ? secondaryPreviewRef.current : previewRef.current;
    const block = preview ? previewBlocks(preview)[bookmark.blockIndex] : null;
    if (!(block instanceof HTMLElement)) return;
    restoreTextSelection(block, bookmark.start, bookmark.end);
  }, [contextChips, copyFeedback, previewCopyTarget, previewHtml, secondaryPreviewHtml]);

  useEffect(() => {
    const saveWithShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      if ((mode !== 'edit' && mode !== 'document') || !buffer.path || saving) return;
      if (mode === 'edit' && !buffer.dirtyByUser) return;
      if (mode === 'document' && !buffer.dirtyByUser && !documentCommitPending) return;
      event.preventDefault();
      saveCurrentDocument();
    };
    window.addEventListener('keydown', saveWithShortcut);
    return () => window.removeEventListener('keydown', saveWithShortcut);
  }, [buffer.dirtyByUser, buffer.path, mode, onSave, saving, documentCommitPending]);

  useEffect(() => {
    const openFindWithShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
      if (mode === 'edit') return;
      event.preventDefault();
      event.stopPropagation();
      setDiffOn(false);
      setPreviewFindOpen(true);
      window.requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
    };
    window.addEventListener('keydown', openFindWithShortcut);
    return () => window.removeEventListener('keydown', openFindWithShortcut);
  }, [mode]);

  useEffect(() => {
    const openCommandsWithShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'p') return;
      event.preventDefault();
      event.stopPropagation();
      setCommandPaletteMode('commands');
      setCommandPaletteOpen(true);
      setCommandQuery('>');
      setCommandIndex(0);
    };
    window.addEventListener('keydown', openCommandsWithShortcut, true);
    return () => window.removeEventListener('keydown', openCommandsWithShortcut, true);
  }, []);

  useEffect(() => {
    setCommandIndex(current => clampNumber(current, 0, Math.max(commandResults.length - 1, 0)));
  }, [commandResults.length]);

  useEffect(() => {
    if (mode !== 'edit') return undefined;
    const closeEditorFindOnOutsideClick = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const view = viewRef.current;
      if (!target || !view || !hostRef.current?.querySelector('.cm-search')) return;
      if (target.closest('.cm-search')) return;
      closeSearchPanel(view);
    };
    document.addEventListener('pointerdown', closeEditorFindOnOutsideClick, true);
    return () => document.removeEventListener('pointerdown', closeEditorFindOnOutsideClick, true);
  }, [mode]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    preview.querySelectorAll('.preview-picked').forEach(node => node.classList.remove('preview-picked'));
    if (!agentCopyEnabled || selectedPreviewIndex === null) return;
    const block = preview.querySelectorAll('p,li,table,pre,blockquote,h1,h2,h3,h4,h5,h6')[selectedPreviewIndex];
    block?.classList.add('preview-picked');
  }, [agentCopyEnabled, previewHtml, selectedPreviewIndex]);

  useEffect(() => {
    return schedulePreviewLineNumbers(previewRef.current, previewSource);
  }, [previewHtml, previewSource, compareOn]);

  useEffect(() => {
    return schedulePreviewLineNumbers(secondaryPreviewRef.current, secondaryPreviewSource);
  }, [secondaryPreviewHtml, secondaryPreviewSource, compareOn]);

  useLayoutEffect(() => {
    const targetPane = compareOn ? activePreviewPane : 'primary';
    const preview = targetPane === 'secondary' ? secondaryPreviewRef.current : previewRef.current;
    const count = previewFindOpen
      ? applyPreviewFindHighlights(preview, {
        query: previewFindQuery,
        index: previewFindIndex,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        scrollToActive: previewFindShouldScrollRef.current,
      })
      : clearPreviewFindHighlights(preview);
    previewFindShouldScrollRef.current = false;
    setPreviewFindMatchCount(current => current === count ? current : count);
  });

  useEffect(() => {
    if (!previewFindMatchCount) {
      setPreviewFindIndex(0);
      return;
    }
    setPreviewFindIndex(current => current >= previewFindMatchCount ? 0 : current);
  }, [previewFindMatchCount]);

  useEffect(() => {
    setActiveHeadingIndex(0);
    setWholeDocumentSelected(false);
    setPreviewCopyTarget(null);
  }, [buffer.path, previewHtml]);

  useEffect(() => {
    setInlinePreviewEdit(null);
  }, [buffer.path]);

  useEffect(() => {
    const handleAgentCopyShortcut = (event: KeyboardEvent) => {
      const documentTarget = event.target instanceof HTMLElement && Boolean(event.target.closest('.document-markdown-content'));
      if (
        (mode !== 'preview' && mode !== 'document')
        || diffOn
        || (!markdownPreviewBody && !primaryIsAsciidoc)
        || !(event.metaKey || event.ctrlKey)
        || !event.shiftKey
        || event.key.toLowerCase() !== 'c'
        || (isEditableShortcutTarget(event.target) && !documentTarget)
      ) return;
      event.preventDefault();
      event.stopPropagation();
      if (!agentCopyEnabled) flushDocumentContent();
      setInlinePreviewEdit(null);
      setAgentCopyEnabled(current => !current);
      setCopyFeedback(feedbackNearRect(agentCopyEnabled ? 'Agent Copy 꺼짐' : 'Agent Copy 켜짐', null));
    };
    window.addEventListener('keydown', handleAgentCopyShortcut, true);
    return () => window.removeEventListener('keydown', handleAgentCopyShortcut, true);
  }, [agentCopyEnabled, diffOn, markdownPreviewBody, mode, primaryIsAsciidoc]);

  useEffect(() => {
    if (!shouldScrollTocActiveRef.current) return;
    shouldScrollTocActiveRef.current = false;
    const activeItem = tocRef.current?.querySelector<HTMLElement>('.toc-item[data-active="true"]');
    activeItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeHeadingIndex]);

  useEffect(() => {
    if (!previewCopyTarget) return undefined;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewCopyTarget(null);
    };
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('.preview-copy-popover')) return;
      setPreviewCopyTarget(null);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', closeOnPointer, true);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', closeOnPointer, true);
    };
  }, [previewCopyTarget]);

  function selectWholeDocument() {
    if (!buffer.path || !visibleContent.trim()) return;
    const lines = lineRangeForOffsets(previewSource, 0, previewSource.length);
    setWholeDocumentSelected(true);
    onSelectionChange({
      fileId: buffer.path,
      text: previewSource,
      from: 0,
      to: previewSource.length,
      lineStart: lines.start,
      lineEnd: lines.end,
    });
  }

  async function copyWholeDocument() {
    if (!buffer.path) return;
    const lines = lineRangeForOffsets(previewSource, 0, previewSource.length);
    const text = [
      `File: ${buffer.path}`,
      formatContextLocation({ from: 0, to: previewSource.length, lineStart: lines.start, lineEnd: lines.end }),
      previewSource,
    ].join('\n');
    copyTextImmediately(text);
    await copyTextWithActiveInstructions(text);
  }

  function scrollToHeading(index: number) {
    const scrollContainer = activeHeadingScrollContainer();
    const heading = activeHeadingElements(scrollContainer)[index];
    if (scrollContainer && heading) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const headingTop = heading.getBoundingClientRect().top - containerRect.top + scrollContainer.scrollTop;
      const topOffset = documentEditable ? 56 : 28;
      scrollContainer.scrollTo({ top: Math.max(0, headingTop - topOffset), behavior: 'smooth' });
    }
    shouldScrollTocActiveRef.current = index !== activeHeadingIndex;
    setActiveHeadingIndex(index);
  }

  function syncActiveHeading() {
    if (diffOn) return;
    const scrollContainer = activeHeadingScrollContainer();
    if (scrollContainer) markPreviewScrollbarActive(scrollContainer);
    if (activeHeadingScrollIdleRef.current !== null) {
      window.clearTimeout(activeHeadingScrollIdleRef.current);
    }
    activeHeadingScrollIdleRef.current = window.setTimeout(() => {
      activeHeadingScrollIdleRef.current = null;
      activeHeadingLastUpdateRef.current = performance.now();
      updateActiveHeading();
    }, 120);
    if (activeHeadingScrollFrameRef.current !== null) return;
    activeHeadingScrollFrameRef.current = window.requestAnimationFrame(() => {
      activeHeadingScrollFrameRef.current = null;
      const now = performance.now();
      if (now - activeHeadingLastUpdateRef.current < 120) return;
      activeHeadingLastUpdateRef.current = now;
      updateActiveHeading();
    });
  }

  function markPreviewScrollbarActive(preview: HTMLElement) {
    preview.classList.add('is-scrolling');
    const previous = previewScrollbarIdleTimersRef.current.get(preview);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      preview.classList.remove('is-scrolling');
      previewScrollbarIdleTimersRef.current.delete(preview);
    }, 420);
    previewScrollbarIdleTimersRef.current.set(preview, timer);
  }

  function cachePreviewHeadingOffsets() {
    const scrollContainer = activeHeadingScrollContainer();
    if (!scrollContainer) {
      headingOffsetsRef.current = [];
      return;
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    headingOffsetsRef.current = activeHeadingElements(scrollContainer)
      .map(heading => heading.getBoundingClientRect().top - containerRect.top + scrollContainer.scrollTop);
  }

  function updateActiveHeading() {
    const scrollContainer = activeHeadingScrollContainer();
    if (!scrollContainer) return;
    let headingOffsets = headingOffsetsRef.current;
    if (!headingOffsets.length && headings.length) {
      cachePreviewHeadingOffsets();
      headingOffsets = headingOffsetsRef.current;
    }
    if (!headingOffsets.length) {
      setActiveHeadingIndex(0);
      return;
    }
    const threshold = scrollContainer.scrollTop + 96;
    const nextIndex = headingIndexForScrollTop(headingOffsets, threshold);
    setActiveHeadingIndex(current => current === nextIndex ? current : nextIndex);
  }

  function activeHeadingScrollContainer() {
    return documentEditable ? documentShellRef.current : previewRef.current;
  }

  function activeHeadingElements(scrollContainer: HTMLElement | null) {
    if (!scrollContainer) return [];
    const selector = documentEditable
      ? '.document-markdown-content h1, .document-markdown-content h2, .document-markdown-content h3, .document-markdown-content h4, .document-markdown-content h5, .document-markdown-content h6'
      : 'h1,h2,h3,h4,h5,h6';
    return Array.from(scrollContainer.querySelectorAll(selector))
      .filter((heading): heading is HTMLElement => heading instanceof HTMLElement);
  }

  function renderTocRail() {
    return (
      <nav ref={tocRef} className={`toc-rail ${headings.length ? '' : 'empty'}`} aria-label="문서 목차">
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
    );
  }

  function handlePreviewShellWheel(event: WheelEvent<HTMLDivElement>) {
    if (shouldLeaveWheelToCodeBlock(event)) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const primary = previewRef.current;
    const secondary = secondaryPreviewRef.current;
    if (!primary) return;
    const targetPreview = target?.closest('.markdown-preview');
    const scrollAmount = event.deltaY;
    if (!scrollAmount) return;

    if (compareOn && secondary) {
      if (targetPreview === primary) {
        return;
      }
      if (targetPreview === secondary) {
        return;
      }
      const targetPane = target?.closest('.preview-compare-pane');
      const panePreview = targetPane?.querySelector('.markdown-preview');
      if (panePreview instanceof HTMLElement) {
        event.preventDefault();
        panePreview.scrollTop += scrollAmount;
        return;
      }
      event.preventDefault();
      const fallback = activePreviewPane === 'secondary' ? secondary : primary;
      fallback.scrollTop += scrollAmount;
      return;
    }

    if (targetPreview === primary) return;
    if (target?.closest('.toc-rail, .document-context-rail, .preview-find-bar, .preview-copy-popover')) return;
    event.preventDefault();
    primary.scrollTop += scrollAmount;
  }

  function shouldLeaveWheelToCodeBlock(event: WheelEvent<HTMLElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const codeBlock = target?.closest('.markdown-preview pre');
    if (!(codeBlock instanceof HTMLElement)) return false;
    const hasHorizontalOverflow = codeBlock.scrollWidth > codeBlock.clientWidth + 2;
    return hasHorizontalOverflow && (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey);
  }

  function selectPreviewBlock(event: MouseEvent<HTMLElement>, pane: 'primary' | 'secondary' = 'primary') {
    onActivePreviewPaneChange(pane);
    if (rangeSelectionHandledRef.current) {
      rangeSelectionHandledRef.current = false;
      return;
    }
    const paneState = previewPaneState(pane);
    if (!paneState.path) return;
    if (diffOn) return;
    if (isNativePreviewControl(event.target)) return;
    const target = event.target instanceof HTMLElement
      ? event.target.closest('p,li,table,pre,blockquote,h1,h2,h3,h4,h5,h6')
      : null;
    if (!(target instanceof HTMLElement) || !paneState.preview?.contains(target)) return;
    const blocks = previewBlocks(paneState.preview);
    const index = blocks.indexOf(target);
    const renderedText = target.innerText.trim();
    if (!renderedText) return;
    const fallbackRange = previewTextRangeForElement(paneState.source, renderedText, target, blocks, index);
    const fallbackLines = lineRangeForOffsets(paneState.source, fallbackRange.from, fallbackRange.to);
    const renderedLines = renderedSourceLineRange(target);
    const relativeLineStart = renderedLines?.start ?? positiveLineNumber(target.dataset.lineStart) ?? fallbackLines.start;
    const relativeLineEnd = Math.max(relativeLineStart, renderedLines?.end ?? positiveLineNumber(target.dataset.lineEnd) ?? fallbackLines.end);
    const relativeRange = sourceRangeForLines(paneState.source, relativeLineStart, relativeLineEnd);
    const from = paneState.prefixLength + relativeRange.from;
    const to = paneState.prefixLength + relativeRange.to;
    const lines = lineRangeForOffsets(paneState.fullSource, from, to);
    const sourceText = paneState.fullSource.slice(from, to);
    const context = {
      fileId: paneState.path,
      text: sourceText,
      from,
      to,
      lineStart: lines.start,
      lineEnd: lines.end,
    };
    setSelectedPreviewIndex(agentCopyEnabled && pane === 'primary' ? index : null);
    setWholeDocumentSelected(false);
    onSelectionChange(null);
    if (agentCopyEnabled) {
      setInlinePreviewEdit(null);
      onPreviewContextPick(context);
      void copyPreviewContext(context, 'Agent Copy');
      return;
    }
    // Markdown Document is either directly contenteditable or deliberately
    // read-only (Agent Copy, Diff, Split, or an unsafe source). It must never
    // fall back to the old line-scoped Source overlay. AsciiDoc Preview keeps
    // that existing block-edit path.
    if (markdownPreviewBody) return;
    if (pane !== 'primary') return;
    const previewRect = paneState.preview.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const left = Math.max(12, targetRect.left - previewRect.left + paneState.preview.scrollLeft - 8);
    const availableWidth = Math.max(260, paneState.preview.clientWidth - left - 12);
    setPreviewCopyTarget(null);
    setInlinePreviewEdit({
      fileId: paneState.path,
      from,
      to,
      lineStart: lines.start,
      lineEnd: lines.end,
      originalDocument: paneState.fullSource,
      originalSlice: sourceText,
      value: sourceText,
      top: targetRect.top - previewRect.top + paneState.preview.scrollTop - 8,
      left,
      width: Math.min(Math.max(targetRect.width + 16, 320), availableWidth),
      error: '',
    });
  }

  async function applyInlinePreviewEdit(saveAfter: boolean) {
    const edit = inlinePreviewEdit;
    if (!edit) return;
    if (
      buffer.path !== edit.fileId
      || visibleContent !== edit.originalDocument
      || visibleContent.slice(edit.from, edit.to) !== edit.originalSlice
    ) {
      setInlinePreviewEdit(current => current ? {
        ...current,
        error: '원문이 바뀌어 이 편집을 적용하지 않았습니다. 다시 블록을 선택하세요.',
      } : current);
      return;
    }
    const nextContent = `${visibleContent.slice(0, edit.from)}${edit.value}${visibleContent.slice(edit.to)}`;
    const applied = await onApplySourceEdit({
      fileId: edit.fileId,
      expectedContent: edit.originalDocument,
      nextContent,
      saveAfter,
    });
    if (applied) {
      setInlinePreviewEdit(null);
      setCopyFeedback(feedbackNearRect(saveAfter ? '블록 적용 및 저장됨' : '블록 적용됨', null));
    } else {
      setInlinePreviewEdit(current => current ? {
        ...current,
        error: '편집 상태가 바뀌어 적용하지 않았습니다. 현재 내용을 확인한 뒤 다시 시도하세요.',
      } : current);
    }
  }

  function handleInlinePreviewEditKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setInlinePreviewEdit(null);
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void applyInlinePreviewEdit(false);
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      void applyInlinePreviewEdit(true);
    }
  }

  function selectPreviewRange(event: MouseEvent<HTMLElement>, pane: 'primary' | 'secondary' = 'primary') {
    onActivePreviewPaneChange(pane);
    const paneState = previewPaneState(pane);
    if (!paneState.path || diffOn) return;
    const preview = paneState.preview;
    const selection = window.getSelection();
    if (!preview || !selection || selection.isCollapsed || !selection.rangeCount) return;
    if (!selection.anchorNode || !selection.focusNode) return;
    if (!preview.contains(selection.anchorNode) || !preview.contains(selection.focusNode)) return;
    const text = selection.toString().trim();
    if (!text) return;
    const target = event.target instanceof HTMLElement
      ? event.target.closest('p,li,table,pre,blockquote,h1,h2,h3,h4,h5,h6')
      : null;
    const blocks = previewBlocks(preview);
    const index = target instanceof HTMLElement ? blocks.indexOf(target) : -1;
    if (target instanceof HTMLElement && index >= 0) {
      const offsets = selectionOffsetsWithin(target, selection.getRangeAt(0));
      if (offsets) {
        previewSelectionBookmarkRef.current = { pane, blockIndex: index, ...offsets };
      }
    }
    const range = target instanceof HTMLElement
      ? previewTextRangeForElement(paneState.source, text, target, blocks, index)
      : findTextRange(paneState.source, text);
    const lines = lineRangeForOffsets(paneState.source, range.from, range.to);
    const context = {
      fileId: paneState.path,
      text,
      from: range.from,
      to: range.to,
      lineStart: lines.start,
      lineEnd: lines.end,
    };
    rangeSelectionHandledRef.current = true;
    window.setTimeout(() => {
      rangeSelectionHandledRef.current = false;
    }, 0);
    setSelectedPreviewIndex(pane === 'primary' && index >= 0 ? index : null);
    setWholeDocumentSelected(false);
    onSelectionChange(null);
    onPreviewContextPick(context);
    showPreviewCopyTarget(event, pane, context);
  }

  function showPreviewCopyTarget(event: MouseEvent<HTMLElement>, pane: 'primary' | 'secondary', context: PreviewContext) {
    const viewportMargin = 12;
    const estimatedWidth = 300;
    const x = Math.min(
      Math.max(event.clientX + 6, viewportMargin),
      Math.max(viewportMargin, window.innerWidth - estimatedWidth - viewportMargin),
    );
    const y = Math.min(
      Math.max(event.clientY - 46, viewportMargin),
      Math.max(viewportMargin, window.innerHeight - 54),
    );
    setPreviewCopyTarget({
      ...context,
      pane,
      x,
      y,
    });
  }

  async function copyPreviewTarget() {
    if (!previewCopyTarget) return;
    await copyPreviewContext(previewCopyTarget, '복사됨');
    setPreviewCopyTarget(null);
  }

  async function copyPreviewContext(context: PreviewContext, feedback: string) {
    await copyTextWithActiveInstructions([
      `File: ${context.fileId}`,
      formatContextLocation(context),
      '',
      context.text,
    ].join('\n'));
    const activePreview = previewPaneState(activePreviewPaneRef.current).preview;
    const target = (activePreview ? previewBlocks(activePreview) : [])
      .find(block => block.textContent?.includes(context.text));
    setCopyFeedback(feedbackNearRect(feedback, target?.getBoundingClientRect() || null));
  }

  async function copyAllSelectedContext() {
    await onCopyContextChips();
    setCopyFeedback(feedbackNearRect('선택 내용 복사됨', previewCopyTarget ? pointRect(previewCopyTarget.x, previewCopyTarget.y) : null));
    setPreviewCopyTarget(null);
  }

  async function copyContextChipsFromRail() {
    await onCopyContextChips();
    setCopyFeedback(feedbackNearRect('참고 내용 복사됨', null));
  }

  function renderDocumentContextRail() {
    if (mode === 'edit' || !contextChips.length || !contextRailVisible) return null;
    return (
      <aside className="document-context-rail" aria-label="다음 요청 참고 내용">
        <header>
          <strong>참고</strong>
          <span>{contextChips.length}개</span>
        </header>
        <div className="document-context-list">
          {contextChips.map(chip => (
            <span className="context-chip document-context-chip" key={chip.id} title={chip.text}>
              <strong>{chip.fileId}</strong>
              <small>{chip.text.length.toLocaleString()}자</small>
              <button type="button" aria-label="참고 내용 제거" onClick={() => onRemoveContextChip(chip.id)}>×</button>
            </span>
          ))}
        </div>
        <div className="document-context-actions">
          <button type="button" onClick={copyContextChipsFromRail}>복사</button>
          <button type="button" onClick={onClearContextChips}>모두 제거</button>
        </div>
      </aside>
    );
  }

  function renderInlinePreviewEditor() {
    if (!inlinePreviewEdit) return null;
    return (
      <section
        className="preview-inline-editor"
        aria-label={`원문 ${inlinePreviewEdit.lineStart}-${inlinePreviewEdit.lineEnd}줄 편집`}
        style={{
          top: inlinePreviewEdit.top,
          left: inlinePreviewEdit.left,
          width: inlinePreviewEdit.width,
        } as CSSProperties}
        onClick={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
        onMouseUp={event => event.stopPropagation()}
      >
        <header>
          <span>Source · {inlinePreviewEdit.lineStart === inlinePreviewEdit.lineEnd
            ? `L${inlinePreviewEdit.lineStart}`
            : `L${inlinePreviewEdit.lineStart}–${inlinePreviewEdit.lineEnd}`}</span>
          <div>
            <button type="button" aria-label="블록 편집 취소" onClick={() => setInlinePreviewEdit(null)}>취소</button>
            <button type="button" aria-label="블록 편집 적용" onClick={() => void applyInlinePreviewEdit(false)}>적용</button>
          </div>
        </header>
        <textarea
          autoFocus
          spellCheck={false}
          value={inlinePreviewEdit.value}
          onChange={event => setInlinePreviewEdit(current => current ? { ...current, value: event.currentTarget.value, error: '' } : current)}
          onKeyDown={handleInlinePreviewEditKeyDown}
        />
        <footer>
          {inlinePreviewEdit.error
            ? <span role="alert">{inlinePreviewEdit.error}</span>
            : <span>⌘/Ctrl+Enter 적용 · ⌘/Ctrl+S 적용 후 저장 · Esc 취소</span>}
        </footer>
      </section>
    );
  }

  function previewPaneState(pane: 'primary' | 'secondary') {
    if (pane === 'secondary') {
      return {
        path: secondaryBuffer?.path || '',
        source: secondaryPreviewSource,
        fullSource: secondaryVisibleContent,
        prefixLength: Math.max(0, secondaryVisibleContent.length - secondaryPreviewSource.length),
        preview: secondaryPreviewRef.current,
      };
    }
    return {
      path: buffer.path,
      source: previewSource,
      fullSource: visibleContent,
      prefixLength: Math.max(0, visibleContent.length - previewSource.length),
      preview: previewRef.current,
    };
  }

  function toggleDiff(next: boolean) {
    if (next) flushDocumentContent();
    setDiffOn(next);
  }

  function activatePreviewPane(pane: 'primary' | 'secondary') {
    activePreviewPaneRef.current = pane;
    onActivePreviewPaneChange(pane);
  }

  function togglePreviewSplit(next: boolean) {
    if (!canPreviewBody) return;
    if (next) {
      flushDocumentContent();
      setDiffOn(false);
      if (!secondaryBuffer?.path) onOpenCurrentInSplit();
      return;
    }
    onCloseSecondary(activePreviewPaneRef.current);
  }

  function movePreviewFind(delta: number) {
    if (!previewFindMatchCount) return;
    previewFindShouldScrollRef.current = true;
    setPreviewFindScrollVersion(current => current + 1);
    setPreviewFindIndex(current => (current + delta + previewFindMatchCount) % previewFindMatchCount);
  }

  function closePreviewFind() {
    setPreviewFindOpen(false);
    setPreviewFindQuery('');
    setPreviewFindIndex(0);
  }

  function switchBodyMode(nextMode: BodyMode) {
    if (nextMode === 'preview' && !canPreviewBody) return;
    if (nextMode === 'document' && !markdownPreviewBody) return;
    if (nextMode === 'tree' && !jsonDocument) return;
    if (nextMode === mode) return;
    if (mode === 'document') flushDocumentContent();
    pendingModeLineRef.current = mode === 'edit' ? currentEditorLine() : currentPreviewLine();
    setMode(nextMode);
  }

  function flushDocumentContent() {
    if (mode !== 'document' || !markdownPreviewBody) return null;
    const body = documentEditorRef.current?.flush();
    if (body === undefined || body === null) return null;
    const fullSource = `${frontmatterPrefix}${body}`;
    if (fullSource !== visibleContent) onChange(fullSource);
    return fullSource;
  }

  function saveCurrentDocument() {
    const flushed = flushDocumentContent();
    onSave(flushed ?? undefined);
  }

  function toggleAgentCopy() {
    if (!agentCopyEnabled) flushDocumentContent();
    setInlinePreviewEdit(null);
    setAgentCopyEnabled(current => !current);
  }

  useEffect(() => {
    if (mode !== 'document') {
      onRegisterDocumentFlush(null);
      return;
    }
    onRegisterDocumentFlush(flushDocumentContent);
    return () => onRegisterDocumentFlush(null);
  }, [buffer.path, frontmatterPrefix, markdownPreviewBody, mode, onRegisterDocumentFlush, visibleContent]);

  function formatJsonDocument() {
    if (!jsonDocument) return;
    try {
      const formatted = `${JSON.stringify(JSON.parse(visibleContent), null, tabSize)}\n`;
      onChange(formatted);
    } catch {
      setMode('tree');
    }
  }

  function currentEditorLine() {
    const view = viewRef.current;
    if (!view) return 1;
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  }

  function currentPreviewLine() {
    const preview = previewRef.current;
    if (!preview) return 1;
    const blocks = Array.from(preview.querySelectorAll<HTMLElement>('[data-line-start]'));
    const previewTop = preview.getBoundingClientRect().top;
    if (!blocks.length) return currentPreviewHeadingLine(preview, previewTop);
    let bestLine = Number(blocks[0].dataset.lineStart || 1);
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const block of blocks) {
      const distance = Math.abs(block.getBoundingClientRect().top - previewTop - 24);
      if (distance >= bestDistance) continue;
      const line = Number(block.dataset.lineStart || 1);
      if (Number.isFinite(line) && line > 0) {
        bestLine = line;
        bestDistance = distance;
      }
    }
    return bestLine;
  }

  function currentPreviewHeadingLine(preview: HTMLElement, previewTop: number) {
    const renderedHeadings = Array.from(preview.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
    if (!renderedHeadings.length || !headings.length) return 1;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    renderedHeadings.forEach((heading, index) => {
      const distance = Math.abs(heading.getBoundingClientRect().top - previewTop - 24);
      if (distance >= bestDistance) return;
      bestIndex = index;
      bestDistance = distance;
    });
    return Math.max(1, (headings[bestIndex]?.line ?? 0) + 1);
  }

  function scrollEditorToLine(lineNumber: number) {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(1, lineNumber), view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  }

  function scrollPreviewToLine(lineNumber: number) {
    const preview = previewRef.current;
    if (!preview) return;
    const blocks = Array.from(preview.querySelectorAll<HTMLElement>('[data-line-start]'));
    const target = blocks.find(block => {
      const start = Number(block.dataset.lineStart || 0);
      const end = Number(block.dataset.lineEnd || start);
      return start <= lineNumber && end >= lineNumber;
    }) || blocks.find(block => Number(block.dataset.lineStart || 0) >= lineNumber) || blocks[0];
    if (!target) {
      scrollPreviewToHeadingLine(lineNumber);
      return;
    }
    preview.scrollTo({ top: Math.max(0, target.offsetTop - 28), behavior: 'auto' });
  }

  function scrollPreviewToHeadingLine(lineNumber: number) {
    const preview = previewRef.current;
    if (!preview || !headings.length) return;
    let targetIndex = 0;
    for (let index = 0; index < headings.length; index += 1) {
      if (headings[index].line + 1 > lineNumber) break;
      targetIndex = index;
    }
    const heading = preview.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')[targetIndex];
    if (!heading) return;
    preview.scrollTo({ top: Math.max(0, heading.offsetTop - 28), behavior: 'auto' });
  }

  function startPreviewSplitResize(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const target = event.currentTarget.parentElement;
    if (!target) return;
    document.body.classList.add('resizing-panels');
    const move = (moveEvent: globalThis.MouseEvent) => {
      const rect = target.getBoundingClientRect();
      const rawRatio = splitOrientation === 'horizontal'
        ? (moveEvent.clientX - rect.left) / Math.max(rect.width, 1)
        : (moveEvent.clientY - rect.top) / Math.max(rect.height, 1);
      setPreviewSplitRatio(clampNumber(rawRatio, 0.22, 0.78));
    };
    const stop = () => {
      document.body.classList.remove('resizing-panels');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop, { once: true });
  }

  function setPreviewWidthFromPointer(event: MouseEvent<HTMLInputElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clampNumber((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    const rawWidth = PREVIEW_WIDTH_MIN + ratio * (previewMaxWidth - PREVIEW_WIDTH_MIN);
    const steppedWidth = Math.round(rawWidth / PREVIEW_WIDTH_STEP) * PREVIEW_WIDTH_STEP;
    setPreviewWidthExplicitly(clampNumber(steppedWidth, PREVIEW_WIDTH_MIN, previewMaxWidth));
  }

  function setPreviewWidthExplicitly(nextWidth: number) {
    previewWidthExplicitRef.current = true;
    window.localStorage.setItem(PREVIEW_WIDTH_EXPLICIT_STORAGE_KEY, '1');
    setPreviewWidth(clampNumber(nextWidth, PREVIEW_WIDTH_MIN, PREVIEW_WIDTH_MAX));
  }

  function startPreviewWidthResize(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const resizer = event.currentTarget;
    const stage = resizer.parentElement;
    if (!stage) return;
    const startX = event.clientX;
    const startWidth = stage.getBoundingClientRect().width;
    let pendingWidth = Math.round(startWidth);
    let frame = 0;

    const renderPendingWidth = () => {
      frame = 0;
      stage.style.setProperty('--preview-width', `${pendingWidth}px`);
      resizer.setAttribute('aria-valuenow', String(pendingWidth));
    };
    document.body.classList.add('resizing-preview-width');
    const move = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = clampNumber(startWidth + (moveEvent.clientX - startX) * 2, PREVIEW_WIDTH_MIN, previewMaxWidth);
      pendingWidth = Math.round(nextWidth);
      if (!frame) frame = window.requestAnimationFrame(renderPendingWidth);
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      renderPendingWidth();
      setPreviewWidthExplicitly(pendingWidth);
      document.body.classList.remove('resizing-preview-width');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop, { once: true });
  }

  function adjustPreviewWidthFromKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const delta = event.key === 'ArrowLeft' ? -PREVIEW_WIDTH_STEP : event.key === 'ArrowRight' ? PREVIEW_WIDTH_STEP : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (event.key === 'Home') setPreviewWidthExplicitly(PREVIEW_WIDTH_MIN);
    else if (event.key === 'End') setPreviewWidthExplicitly(previewMaxWidth);
    else setPreviewWidthExplicitly(clampNumber(effectivePreviewWidth + delta, PREVIEW_WIDTH_MIN, previewMaxWidth));
  }

  function closeCommandPalette() {
    setCommandPaletteOpen(false);
    setCommandPaletteMode('commands');
    setCommandQuery('');
    setCommandIndex(0);
    setPendingIndentMode(indentMode);
  }

  function runCommandItem(index = commandIndex) {
    const item = commandResults[index] || commandResults[0];
    if (!item) return;
    item.run();
  }

  function convertIndentation(targetMode: IndentMode) {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const next = convertLeadingIndentation(current, targetMode, tabSize);
    if (next === current) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
  }

  return (
    <section className="editor-pane">
      {readonlyNotice ? (
        <div
          className="document-readonly-dialog-overlay"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setReadonlyNotice(null);
          }}
        >
          <section
            className="document-readonly-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-readonly-title"
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setReadonlyNotice(null);
              }
            }}
          >
            <h2 id="document-readonly-title">Document에서 읽기 전용으로 열었습니다</h2>
            <p>“{readonlyNotice.path}”에는 {documentEligibilityMessage(readonlyNotice.reason)}이(가) 있어 소스를 안전하게 보존하려면 Document 편집을 사용할 수 없습니다.</p>
            <label>
              <input
                type="checkbox"
                checked={readonlyNotice.suppress}
                onChange={event => setReadonlyNotice(current => current ? { ...current, suppress: event.currentTarget.checked } : current)}
              />
              <span>다시 알리지 않음</span>
            </label>
            <footer>
              <button
                type="button"
                onClick={() => {
                  if (readonlyNotice.suppress) onSuppressMarkdownDocumentReadonlyNotice();
                  setReadonlyNotice(null);
                }}
              >
                계속 보기
              </button>
              <button
                autoFocus
                type="button"
                onClick={() => {
                  if (readonlyNotice.suppress) onSuppressMarkdownDocumentReadonlyNotice();
                  setReadonlyNotice(null);
                  switchBodyMode('edit');
                }}
              >
                Source에서 편집
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {commandPaletteOpen ? (
        <div className="command-palette-overlay" role="dialog" aria-modal="true" aria-label="명령 팔레트" onClick={closeCommandPalette}>
          <div className="command-palette-panel" onClick={event => event.stopPropagation()}>
            <input
              autoFocus
              value={commandQuery}
              placeholder={commandPaletteMode === 'tab-size' ? `Select Tab Size for ${pendingIndentMode === 'tabs' ? 'Tabs' : 'Spaces'}` : '명령 입력'}
              onChange={event => {
                setCommandQuery(event.currentTarget.value);
                setCommandIndex(0);
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeCommandPalette();
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setCommandIndex(current => Math.min(current + 1, Math.max(commandResults.length - 1, 0)));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setCommandIndex(current => Math.max(current - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  runCommandItem();
                }
              }}
            />
            <div className="command-palette-results" role="listbox" aria-label="명령 결과">
              {commandResults.length ? commandResults.map((item, index) => (
                <button
                  className={`command-palette-row ${index === commandIndex ? 'active' : ''}`}
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === commandIndex}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => item.run()}
                >
                  <span>{highlightCommandName(item.label, commandQuery)}</span>
                  {item.detail ? <small>{item.detail}</small> : null}
                </button>
              )) : (
                <div className="command-palette-empty">No commands</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {!compareOn && primaryFileTabs ? <div className="editor-pane-tabs">{primaryFileTabs}</div> : null}
      <div className="panel-title editor-title">
        <span>{buffer.path || 'Editor'}</span>
        <span>{markdownPreviewBlocks(visibleContent).length} blocks</span>
        {buffer.dirtyByUser ? <span className="dirty-pill">수정됨</span> : null}
        {buffer.conflictState !== 'clean' ? <span className="conflict-pill">{conflictStateLabel(buffer.conflictState)}</span> : null}
        {canPreviewBody ? (
          <div className="editor-mode-toggle" aria-label="본문 모드">
            <button className={mode === 'edit' ? 'active' : ''} type="button" onClick={() => switchBodyMode('edit')}>Source</button>
            {jsonDocument ? (
              <button className={mode === 'tree' ? 'active' : ''} type="button" onClick={() => switchBodyMode('tree')}>Tree</button>
            ) : markdownPreviewBody ? (
              <button className={mode === 'document' ? 'active' : ''} type="button" onClick={() => switchBodyMode('document')}>Document</button>
            ) : (
              <button className={mode === 'preview' ? 'active' : ''} type="button" onClick={() => switchBodyMode('preview')}>Preview</button>
            )}
            {(mode === 'preview' || mode === 'document') && !jsonDocument ? (
              <button
                className={`agent-copy-toggle ${agentCopyEnabled ? 'active' : ''}`}
                type="button"
                aria-pressed={agentCopyEnabled}
                aria-keyshortcuts="Meta+Shift+C Control+Shift+C"
                title="Agent Copy · ⌘/Ctrl+Shift+C"
                onClick={toggleAgentCopy}
              >
                Agent Copy
              </button>
            ) : null}
          </div>
        ) : null}
        {jsonDocument ? <button className="editor-action" type="button" onClick={formatJsonDocument}>Format JSON</button> : null}
        <label className={`diff-toggle ${diffOn ? 'active' : ''}`}>
          <span>Diff</span>
          <input type="checkbox" checked={diffOn} onChange={event => toggleDiff(event.currentTarget.checked)} />
        </label>
        {!diffOn && canPreviewBody ? (
          <label className={`preview-split-toggle ${secondaryBuffer?.path ? 'active' : ''}`}>
            <span>Split</span>
            <input
              type="checkbox"
              checked={Boolean(secondaryBuffer?.path)}
              disabled={!buffer.path}
              onChange={event => togglePreviewSplit(event.currentTarget.checked)}
            />
          </label>
        ) : null}
        {diffOn ? (
          <label className={`diff-toggle ${diffSplit ? 'active' : ''}`}>
            <span>좌우 비교</span>
            <input type="checkbox" checked={diffSplit} onChange={event => setDiffSplit(event.currentTarget.checked)} />
          </label>
        ) : null}
        {secondaryBuffer?.path && !diffOn ? (
          <div className="split-preview-controls" aria-label="문서 분할 방향">
            <button
              className={splitOrientation === 'horizontal' ? 'active' : ''}
              type="button"
              onClick={() => onSplitOrientationChange('horizontal')}
            >
              좌우
            </button>
            <button
              className={splitOrientation === 'vertical' ? 'active' : ''}
              type="button"
              onClick={() => onSplitOrientationChange('vertical')}
            >
              상하
            </button>
            <button type="button" onClick={() => onCloseSecondary(activePreviewPaneRef.current)}>문서 분할 닫기</button>
          </div>
        ) : null}
        {canPreviewBody && !documentEditable ? (
          <label
            className={`line-number-toggle diff-toggle ${showPreviewLineNumbers ? 'active' : ''}`}
            title="Preview line numbers"
          >
            <span>Line numbers</span>
            <input
              type="checkbox"
              checked={showPreviewLineNumbers}
              onChange={event => setShowPreviewLineNumbers(event.currentTarget.checked)}
            />
          </label>
        ) : null}
        <details className="editor-more-menu" ref={editorMoreMenuRef}>
          <summary aria-label="More editor actions" title="More editor actions"><DotsThreeVertical size={17} weight="bold" /></summary>
          <div className="editor-more-popover">
            <label className="indent-mode-control" title="Tab input mode">
              <span>Indentation</span>
              <select
                value={`${indentMode}:${tabSize === 4 ? 4 : 2}`}
                onChange={event => {
                  const [nextMode, nextSize] = event.currentTarget.value.split(':');
                  setIndentMode(nextMode === 'tabs' ? 'tabs' : 'spaces');
                  setTabSize(nextSize === '4' ? 4 : 2);
                }}
              >
                <option value="spaces:2">Spaces 2</option>
                <option value="spaces:4">Spaces 4</option>
                <option value="tabs:2">Tab 2</option>
                <option value="tabs:4">Tab 4</option>
              </select>
            </label>
            <button className="editor-action" type="button" disabled={!buffer.path} onClick={selectWholeDocument}>Select all</button>
            <button
              className="editor-action"
              type="button"
              disabled={!buffer.path}
              onMouseDown={copyWholeDocument}
              onClick={copyWholeDocument}
            >
              Copy all
            </button>
            <label className="preview-width-control" title="Preview width">
              <input
                type="range"
                min={PREVIEW_WIDTH_MIN}
                max={previewMaxWidth}
                step={PREVIEW_WIDTH_STEP}
                value={effectivePreviewWidth}
                onInput={event => setPreviewWidthExplicitly(clampNumber(Number(event.currentTarget.value), PREVIEW_WIDTH_MIN, previewMaxWidth))}
                onChange={event => setPreviewWidthExplicitly(clampNumber(Number(event.currentTarget.value), PREVIEW_WIDTH_MIN, previewMaxWidth))}
                onPointerDown={setPreviewWidthFromPointer}
              />
              <span>Width {effectivePreviewWidth}</span>
            </label>
          </div>
        </details>
        <button className="save-button" type="button" disabled={!buffer.path || (!buffer.dirtyByUser && !documentCommitPending) || saving} onClick={saveCurrentDocument}>
          {saving ? '저장 중' : '저장'}
        </button>
      </div>
      {error ? <div className="editor-error">{error}</div> : null}
      {buffer.conflictState.includes('conflict') ? (
        <div className="editor-conflict-bar" role="alert">
          <span>디스크의 변경과 현재 편집 내용이 충돌합니다. 내용을 확인한 뒤 어느 버전을 유지할지 선택하세요.</span>
          <div>
            <button type="button" onClick={onReloadConflict}>디스크 버전 사용</button>
            <button type="button" onClick={onOverwriteConflict} disabled={saving}>내 버전으로 덮어쓰기</button>
          </div>
        </div>
      ) : null}
      <div
        className={`editor-workspace ${mode} ${documentEditable ? 'document-editable' : 'document-readonly'} ${diffOn ? 'diffing' : ''}`}
        data-document-safety-reason={documentSafetyFailure || undefined}
      >
        <div className="editor-host" ref={hostRef} />
        {mode === 'document' && documentEditable ? (
          <div
            ref={documentShellRef}
            className="document-editor-shell"
            style={{ '--preview-width': `${effectivePreviewWidth}px` } as CSSProperties}
            onScroll={syncActiveHeading}
          >
            {frontmatter.entries.length ? <FrontmatterCard entries={frontmatter.entries} /> : null}
            <DocumentMarkdownEditor
              key={buffer.path}
              ref={documentEditorRef}
              filePath={buffer.path}
              source={frontmatter.body}
              editable
              onChange={source => onChange(`${frontmatterPrefix}${source}`)}
              onSelectionContextChange={onSelectionChange}
              onSafetyFailure={setDocumentSafetyFailure}
              onPendingChange={setDocumentCommitPending}
            />
          </div>
        ) : null}
        {mode === 'document' && documentEditable ? renderTocRail() : null}
        {mode === 'tree' ? (
          <div className="json-tree-shell">
            <JsonTreeView source={visibleContent} />
          </div>
        ) : null}
        {!documentEditable ? <div
          ref={previewShellRef}
          className={`preview-shell ${showPreviewLineNumbers ? 'show-line-numbers' : 'hide-line-numbers'} ${mode !== 'edit' && contextChips.length && contextRailVisible ? 'with-context-rail' : ''} ${compareOn ? `preview-compare-active split-${splitOrientation}` : ''} ${diffOn ? 'diff-review-shell' : ''}`}
          onWheel={handlePreviewShellWheel}
        >
          {previewFindOpen ? (
            <div className="preview-find-bar" role="search" aria-label="프리뷰 본문 찾기">
              <input
                ref={findInputRef}
                value={previewFindQuery}
                placeholder="Find"
                onChange={event => {
                  setPreviewFindQuery(event.currentTarget.value);
                  setPreviewFindIndex(0);
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closePreviewFind();
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    movePreviewFind(event.shiftKey ? -1 : 1);
                  }
                }}
              />
              <span className="preview-find-count">
                {previewFindQuery ? (previewFindMatchCount ? `${previewFindIndex + 1} of ${previewFindMatchCount}` : 'No results') : ''}
              </span>
              <button type="button" title="이전 결과" disabled={!previewFindMatchCount} onClick={() => movePreviewFind(-1)}>↑</button>
              <button type="button" title="다음 결과" disabled={!previewFindMatchCount} onClick={() => movePreviewFind(1)}>↓</button>
              <button type="button" title="찾기 닫기" onClick={closePreviewFind}>×</button>
            </div>
          ) : null}
          {compareOn ? (
            <>
              <div
                className={`preview-compare preview-compare-${splitOrientation}`}
                style={previewCompareStyle}
              >
                <section
                  className={`preview-compare-pane primary ${activePreviewPane === 'primary' ? 'active-pane' : ''}`}
                  aria-label="주 파일 프리뷰"
                  onMouseDown={() => activatePreviewPane('primary')}
                >
                  {primaryFileTabs}
                  <header>
                    <strong>{buffer.path || '주 파일'}</strong>
                    <span>주 파일</span>
                  </header>
                  <article
                    className={`markdown-preview split-preview-document ${primaryIsAsciidoc ? 'adoc-preview' : ''} ${agentCopyEnabled ? 'agent-copy-active' : ''}`}
                    ref={previewRef}
                    style={{ '--preview-width': `${effectivePreviewWidth}px` } as CSSProperties}
                    onClick={event => selectPreviewBlock(event, 'primary')}
                    onMouseUp={event => selectPreviewRange(event, 'primary')}
                    onScroll={syncActiveHeading}
                  >
                    {!previewAsSource && frontmatter.entries.length ? <FrontmatterCard entries={frontmatter.entries} /> : null}
                    <RenderedPreviewHtml html={previewHtml} />
                    {renderInlinePreviewEditor()}
                  </article>
                </section>
                <button
                  className={`preview-split-resizer preview-split-resizer-${splitOrientation}`}
                  type="button"
                  aria-label={splitOrientation === 'horizontal' ? '분할 폭 조절' : '분할 높이 조절'}
                  onMouseDown={startPreviewSplitResize}
                />
                <section
                  className={`preview-compare-pane secondary ${activePreviewPane === 'secondary' ? 'active-pane' : ''}`}
                  aria-label="보조 파일 프리뷰"
                  onMouseDown={() => activatePreviewPane('secondary')}
                >
                  {secondaryFileTabs}
                  <header>
                    <strong>{secondaryBuffer?.path || '보조 파일'}</strong>
                    <span>읽기 전용</span>
                  </header>
                  <article
                    className={`markdown-preview split-preview-document secondary-document ${secondaryIsAsciidoc ? 'adoc-preview' : ''} ${agentCopyEnabled ? 'agent-copy-active' : ''}`}
                    ref={secondaryPreviewRef}
                    style={{ '--preview-width': `${effectivePreviewWidth}px` } as CSSProperties}
                    onClick={event => selectPreviewBlock(event, 'secondary')}
                    onMouseUp={event => selectPreviewRange(event, 'secondary')}
                    onScroll={event => markPreviewScrollbarActive(event.currentTarget)}
                  >
                    {!secondaryPreviewAsSource && secondaryFrontmatter.entries.length ? <FrontmatterCard entries={secondaryFrontmatter.entries} /> : null}
                    <RenderedPreviewHtml html={secondaryPreviewHtml} />
                  </article>
                </section>
              </div>
              {renderDocumentContextRail()}
            </>
          ) : (
            <>
              {mode !== 'edit' && !diffOn ? renderTocRail() : null}
              <div className="preview-document-stage" style={{ '--preview-width': `${effectivePreviewWidth}px` } as CSSProperties}>
                {mode === 'document' && (!documentEligibility.editable || documentSafetyFailure) ? (
                  <div className="document-readonly-banner" role="status">
                    {documentSafetyFailure
                      ? '안전한 소스 보존을 확인할 수 없어 Document 편집을 중지했습니다.'
                      : `이 문서는 ${documentEligibilityMessage(String(documentEligibility.reason))} 때문에 Document에서 읽기 전용입니다.`}
                    <button type="button" onClick={() => switchBodyMode('edit')}>Source에서 편집</button>
                  </div>
                ) : null}
                <article
                  className={`markdown-preview ${primaryIsAsciidoc ? 'adoc-preview' : ''} ${diffOn ? 'diff-preview-mode' : ''} ${agentCopyEnabled ? 'agent-copy-active' : ''}`}
                  ref={previewRef}
                  onClick={event => selectPreviewBlock(event, 'primary')}
                  onMouseUp={event => selectPreviewRange(event, 'primary')}
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
                      <RenderedPreviewHtml html={previewHtml} />
                      {renderInlinePreviewEditor()}
                    </>
                  )}
                </article>
                <button
                  className="preview-width-resizer"
                  type="button"
                  role="separator"
                  aria-label="본문 가로 폭 조절"
                  aria-orientation="vertical"
                  aria-valuemin={PREVIEW_WIDTH_MIN}
                  aria-valuemax={previewMaxWidth}
                  aria-valuenow={effectivePreviewWidth}
                  onMouseDown={startPreviewWidthResize}
                  onKeyDown={adjustPreviewWidthFromKeyboard}
                />
              </div>
              {diffOn ? (
                <DiffChangesRail
                  rows={diffRows as DiffRow[]}
                  onAccept={() => saveCurrentDocument()}
                  onExit={() => setDiffOn(false)}
                />
              ) : renderDocumentContextRail()}
            </>
          )}
          {selectedPreviewIndex !== null ? <span className="preview-selection-note">참고 내용에 추가됨</span> : null}
          {copyFeedback ? (
            <span
              className="preview-copy-feedback"
              style={{ left: copyFeedback.x, top: copyFeedback.y } as CSSProperties}
            >
              {copyFeedback.text}
            </span>
          ) : null}
          {previewCopyTarget ? (
            <div
              className="preview-copy-popover"
              style={{ left: previewCopyTarget.x, top: previewCopyTarget.y } as CSSProperties}
              role="toolbar"
              aria-label="프리뷰 복사"
              onClick={event => event.stopPropagation()}
              onMouseDown={event => event.stopPropagation()}
            >
              <button type="button" onClick={copyPreviewTarget}>복사</button>
              <button type="button" onClick={copyAllSelectedContext}>선택 내용 전체 복사</button>
            </div>
          ) : null}
        </div> : null}
      </div>
    </section>
  );
}

function feedbackNearRect(text: string, rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'> | null): CopyFeedback {
  const anchorX = rect ? rect.right : window.innerWidth - 28;
  const anchorY = rect ? rect.top : window.innerHeight - 28;
  return {
    text,
    x: clampNumber(anchorX + 8, 12, Math.max(12, window.innerWidth - 94)),
    y: clampNumber(anchorY - 34, 12, Math.max(12, window.innerHeight - 40)),
  };
}

function pointRect(x: number, y: number) {
  return { left: x, right: x, top: y, bottom: y };
}

function selectionOffsetsWithin(container: HTMLElement, range: Range) {
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(container);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const selectedLength = range.toString().length;
  return { start, end: start + selectedLength };
}

function restoreTextSelection(container: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let startSet = false;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length || 0;
    if (!startSet && start <= offset + length) {
      range.setStart(node, Math.max(0, start - offset));
      startSet = true;
    }
    if (startSet && end <= offset + length) {
      range.setEnd(node, Math.max(0, end - offset));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    offset += length;
    node = walker.nextNode();
  }
}

function previewTextRangeForElement(
  source: string,
  text: string,
  target: HTMLElement,
  blocks: Element[],
  index: number,
  knownOccurrence?: number,
) {
  const blockText = target.textContent?.trim() ?? '';
  const sourceLines = renderedSourceLineRange(target);
  if (sourceLines) {
    const annotatedRange = sourceRangeForLines(source, sourceLines.start, sourceLines.end);
    if (text === blockText) return annotatedRange;
    const localRange = findTextRange(source, text, 0, annotatedRange.from, annotatedRange.to);
    if (localRange.from >= annotatedRange.from && localRange.to <= annotatedRange.to) return localRange;
  }
  const occurrence = knownOccurrence ?? blocks.slice(0, Math.max(index, 0))
    .filter(block => block instanceof HTMLElement && block.textContent?.trim() === blockText)
    .length;
  const blockRange = findTextRange(source, blockText, occurrence);
  if (text === blockText) return blockRange;
  const localRange = findTextRange(source, text, 0, blockRange.from, blockRange.to);
  if (localRange.from !== blockRange.from || localRange.to !== Math.min(blockRange.to, blockRange.from + text.length)) {
    return localRange;
  }
  return findTextRange(source, text);
}

type PreviewLineAnnotationState = {
  source: string;
  lineStarts: number[];
  sourceIndex: ReturnType<typeof buildSearchIndex>;
  occurrenceCounts: Map<string, number>;
  cursor: number;
};

function schedulePreviewLineNumbers(preview: HTMLElement | null, source: string) {
  if (!preview || !source) return undefined;
  if (preview.querySelector('.docpilot-preview-loading')) return undefined;
  const blocks = previewBlocks(preview);
  if (!blocks.length) return undefined;

  let cancelled = false;
  let timer = 0;
  let idleHandle = 0;
  let index = 0;
  const state: PreviewLineAnnotationState = {
    source,
    lineStarts: buildLineStartOffsets(source),
    sourceIndex: buildSearchIndex(source, 0),
    occurrenceCounts: new Map<string, number>(),
    cursor: 0,
  };

  const schedule = () => {
    const idleScheduler = window as typeof window & {
      requestIdleCallback?: (callback: (deadline: { timeRemaining: () => number }) => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleScheduler.requestIdleCallback) {
      idleHandle = idleScheduler.requestIdleCallback(runChunk, { timeout: 80 });
      return;
    }
    timer = window.setTimeout(() => runChunk(), 0);
  };

  const runChunk = (deadline?: { timeRemaining: () => number }) => {
    if (cancelled) return;
    const startedAt = performance.now();
    while (index < blocks.length && !cancelled) {
      annotatePreviewLineNumberBlock(blocks[index], state);
      index += 1;
      const spent = performance.now() - startedAt;
      const timeRemaining = deadline?.timeRemaining() ?? 0;
      if (index < blocks.length && spent >= 8 && (!deadline || timeRemaining < 4)) break;
    }
    if (index < blocks.length && !cancelled) schedule();
  };

  const frame = window.requestAnimationFrame(schedule);
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    if (timer) window.clearTimeout(timer);
    if (idleHandle) {
      const idleScheduler = window as typeof window & { cancelIdleCallback?: (handle: number) => void };
      idleScheduler.cancelIdleCallback?.(idleHandle);
    }
  };
}

function annotatePreviewLineNumberBlock(block: Element | undefined, state: PreviewLineAnnotationState) {
  const element = block instanceof HTMLElement ? block : null;
  if (!element) return;
  const renderedRange = renderedSourceLineRange(element);
  if (renderedRange) {
    element.dataset.lineStart = String(renderedRange.start);
    element.dataset.lineEnd = String(renderedRange.end);
    element.dataset.lineLabel = renderedRange.start === renderedRange.end
      ? String(renderedRange.start)
      : `${renderedRange.start}-${renderedRange.end}`;
    return;
  }
  if (element.matches('pre.code-block') && element.dataset.lineStart && element.dataset.lineEnd) {
    const start = Number(element.dataset.lineStart);
    const end = Number(element.dataset.lineEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      element.dataset.lineLabel = start === end ? String(start) : `${start}-${end}`;
      return;
    }
  }

  const text = element.textContent?.trim() ?? '';
  if (!text) {
    delete element.dataset.lineLabel;
    delete element.dataset.lineStart;
    delete element.dataset.lineEnd;
    return;
  }

  const occurrence = state.occurrenceCounts.get(text) ?? 0;
  state.occurrenceCounts.set(text, occurrence + 1);
  const range = findTextRangeForLineAnnotation(state, text, occurrence);
  state.cursor = Math.max(state.cursor, range.to);
  const lines = lineRangeForOffsetsWithStarts(state.source, state.lineStarts, range.from, range.to);
  element.dataset.lineStart = String(lines.start);
  element.dataset.lineEnd = String(lines.end);
  element.dataset.lineLabel = lines.start === lines.end ? String(lines.start) : `${lines.start}-${lines.end}`;
}

function renderedSourceLineRange(element: HTMLElement) {
  let current: HTMLElement | null = element;
  while (current) {
    for (const className of current.classList) {
      const match = /^docpilot-source-lines-(\d+)-(\d+)$/.exec(className);
      if (!match) continue;
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) return { start, end };
    }
    if (current.classList.contains('markdown-preview')) break;
    current = current.parentElement;
  }
  return null;
}

function findTextRangeForLineAnnotation(state: PreviewLineAnnotationState, text: string, occurrence: number) {
  const needle = text.trim();
  if (!needle) return { from: state.cursor, to: state.cursor };

  const orderedExact = state.source.indexOf(needle, state.cursor);
  if (orderedExact !== -1) return { from: orderedExact, to: orderedExact + needle.length };

  const exact = nthIndexOf(state.source, needle, occurrence);
  if (exact !== -1) return { from: exact, to: exact + needle.length };

  const needleIndex = buildSearchIndex(needle, 0);
  if (!needleIndex.text) return { from: state.cursor, to: state.cursor };
  let from = 0;
  for (let count = 0; count <= occurrence; count += 1) {
    const found = state.sourceIndex.text.indexOf(needleIndex.text, from);
    if (found === -1) break;
    if (count === occurrence) {
      const rangeStart = state.sourceIndex.map[found] ?? state.cursor;
      const rangeEnd = (state.sourceIndex.map[found + needleIndex.text.length - 1] ?? rangeStart) + 1;
      return { from: rangeStart, to: rangeEnd };
    }
    from = found + needleIndex.text.length;
  }
  return { from: state.cursor, to: Math.min(state.source.length, state.cursor + needle.length) };
}

function buildLineStartOffsets(source: string) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineRangeForOffsetsWithStarts(source: string, lineStarts: number[], from: number, to: number) {
  const safeFrom = Math.max(0, Math.min(from, source.length));
  const safeTo = Math.max(safeFrom, Math.min(to, source.length));
  const adjustedEnd = safeTo > safeFrom && source[safeTo - 1] === '\n' ? safeTo - 1 : safeTo;
  const start = lineNumberForOffsetWithStarts(lineStarts, safeFrom);
  return {
    start,
    end: Math.max(start, lineNumberForOffsetWithStarts(lineStarts, adjustedEnd)),
  };
}

function lineNumberForOffsetWithStarts(lineStarts: number[], offset: number) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(1, high + 1);
}

function headingIndexForScrollTop(offsets: number[], threshold: number) {
  let low = 0;
  let high = offsets.length - 1;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] <= threshold) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function previewBlocks(preview: HTMLElement) {
  return Array.from(preview.querySelectorAll('p,li,table,pre,blockquote,h1,h2,h3,h4,h5,h6'));
}

type PreviewFindOptions = {
  query: string;
  index: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  scrollToActive?: boolean;
};

function clearPreviewFindHighlights(preview: HTMLElement | null) {
  if (!preview) return 0;
  const marks = Array.from(preview.querySelectorAll('mark.preview-find-mark'));
  marks.forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parent.normalize();
  });
  return 0;
}

function applyPreviewFindHighlights(preview: HTMLElement | null, options: PreviewFindOptions) {
  if (!preview) return 0;
  const previousScrollTop = preview.scrollTop;
  const previousScrollLeft = preview.scrollLeft;
  clearPreviewFindHighlights(preview);
  const matcher = buildPreviewFindMatcher(options);
  if (!matcher) {
    preview.scrollTop = previousScrollTop;
    preview.scrollLeft = previousScrollLeft;
    return 0;
  }
  const textNodes = previewTextNodes(preview);
  const matches: HTMLElement[] = [];

  for (const node of textNodes) {
    const text = node.nodeValue || '';
    const ranges = findPreviewTextRanges(text, matcher, options);
    if (!ranges.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      if (range.from > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, range.from)));
      const mark = document.createElement('mark');
      mark.className = 'preview-find-mark';
      mark.textContent = text.slice(range.from, range.to);
      fragment.appendChild(mark);
      matches.push(mark);
      cursor = range.to;
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }

  const active = matches[options.index % Math.max(matches.length, 1)];
  if (active) {
    active.classList.add('current');
    if (options.scrollToActive) {
      active.scrollIntoView({ block: 'center', inline: 'nearest' });
    } else {
      preview.scrollTop = previousScrollTop;
      preview.scrollLeft = previousScrollLeft;
    }
  } else {
    preview.scrollTop = previousScrollTop;
    preview.scrollLeft = previousScrollLeft;
  }
  return matches.length;
}

function previewTextNodes(root: HTMLElement) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.preview-find-bar, .preview-copy-popover, mark.preview-find-mark')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildPreviewFindMatcher(options: PreviewFindOptions) {
  const query = options.query.trim();
  if (!query) return null;
  try {
    if (options.regex) {
      return new RegExp(query, options.caseSensitive ? 'g' : 'gi');
    }
    return new RegExp(escapeRegExp(query), options.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

function findPreviewTextRanges(text: string, matcher: RegExp, options: PreviewFindOptions) {
  const ranges: Array<{ from: number; to: number }> = [];
  matcher.lastIndex = 0;
  let match = matcher.exec(text);
  while (match) {
    const from = match.index;
    const value = match[0];
    const to = from + value.length;
    if (value && (!options.wholeWord || isWholeWordMatch(text, from, to))) {
      ranges.push({ from, to });
    }
    matcher.lastIndex = value ? matcher.lastIndex : matcher.lastIndex + 1;
    match = matcher.exec(text);
  }
  return ranges;
}

function isWholeWordMatch(text: string, from: number, to: number) {
  const before = from > 0 ? text[from - 1] : '';
  const after = to < text.length ? text[to] : '';
  return !isWordCharacter(before) && !isWordCharacter(after);
}

function isWordCharacter(value: string) {
  return /[\p{L}\p{N}_]/u.test(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineRangeForOffsets(source: string, from: number, to: number) {
  const safeFrom = Math.max(0, Math.min(from, source.length));
  const safeTo = Math.max(safeFrom, Math.min(to, source.length));
  const start = lineNumberForOffset(source, safeFrom);
  const adjustedEnd = safeTo > safeFrom && source[safeTo - 1] === '\n' ? safeTo - 1 : safeTo;
  return {
    start,
    end: Math.max(start, lineNumberForOffset(source, adjustedEnd)),
  };
}

function positiveLineNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sourceRangeForLines(source: string, lineStart: number, lineEnd: number) {
  const starts = buildLineStartOffsets(source);
  const safeStart = clampNumber(Math.floor(lineStart), 1, starts.length);
  const safeEnd = clampNumber(Math.floor(lineEnd), safeStart, starts.length);
  return {
    from: starts[safeStart - 1] ?? 0,
    to: starts[safeEnd] ?? source.length,
  };
}

function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return Boolean(element.closest(
    'input, textarea, select, [contenteditable="true"], .cm-editor, .terminal-pane, .preview-inline-editor',
  ));
}

function isNativePreviewControl(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return Boolean(element.closest(
    'a, button, input, label, summary, details > summary, [role="button"], .preview-copy-popover, .preview-inline-editor',
  ));
}

function lineNumberForOffset(source: string, offset: number) {
  let line = 1;
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  for (let index = 0; index < safeOffset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function findTextRange(source: string, text: string, occurrence = 0, start = 0, end = source.length) {
  const needle = text.trim();
  if (!needle) return { from: start, to: start };
  const exact = nthIndexOf(source, needle, occurrence, start, end);
  if (exact !== -1) return { from: exact, to: exact + needle.length };

  const sourceIndex = buildSearchIndex(source.slice(start, end), start);
  const needleIndex = buildSearchIndex(needle, 0);
  if (!needleIndex.text) return { from: start, to: start };
  let from = 0;
  for (let count = 0; count <= occurrence; count += 1) {
    const found = sourceIndex.text.indexOf(needleIndex.text, from);
    if (found === -1) break;
    if (count === occurrence) {
      const rangeStart = sourceIndex.map[found] ?? start;
      const rangeEnd = (sourceIndex.map[found + needleIndex.text.length - 1] ?? rangeStart) + 1;
      return { from: rangeStart, to: rangeEnd };
    }
    from = found + needleIndex.text.length;
  }
  return { from: start, to: Math.min(end, start + needle.length) };
}

function nthIndexOf(source: string, needle: string, occurrence: number, start = 0, end = source.length) {
  let from = start;
  for (let index = 0; index <= occurrence; index += 1) {
    const found = source.indexOf(needle, from);
    if (found === -1 || found >= end) return -1;
    if (index === occurrence) return found;
    from = found + needle.length;
  }
  return -1;
}

function buildSearchIndex(source: string, offset: number) {
  let text = '';
  const map: number[] = [];
  let previousWasSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '*' || char === '_' || char === '`' || char === '#' || char === '>') continue;
    if (/\s/.test(char)) {
      if (!previousWasSpace && text) {
        text += ' ';
        map.push(offset + index);
        previousWasSpace = true;
      }
      continue;
    }
    text += char;
    map.push(offset + index);
    previousWasSpace = false;
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

function registerHighlightLanguages() {
  const registrations: Array<[string, Parameters<typeof hljs.registerLanguage>[1]]> = [
    ['bash', bash],
    ['c', c],
    ['cpp', cpp],
    ['css', css],
    ['dart', dart],
    ['go', go],
    ['java', java],
    ['javascript', javascript],
    ['json', json],
    ['kotlin', kotlin],
    ['markdown', markdownHighlight],
    ['objectivec', objectivec],
    ['python', python],
    ['ruby', ruby],
    ['rust', rust],
    ['sql', sql],
    ['swift', swift],
    ['typescript', typescript],
    ['xml', xml],
    ['yaml', yaml],
  ];
  for (const [name, language] of registrations) {
    if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
  }
  for (const [alias, target] of [
    ['c++', 'cpp'],
    ['cc', 'cpp'],
    ['console', 'bash'],
    ['cxx', 'cpp'],
    ['h', 'c'],
    ['hpp', 'cpp'],
    ['htm', 'xml'],
    ['html', 'xml'],
    ['javascriptreact', 'javascript'],
    ['js', 'javascript'],
    ['jsonc', 'json'],
    ['jsx', 'javascript'],
    ['kt', 'kotlin'],
    ['md', 'markdown'],
    ['mjs', 'javascript'],
    ['objc', 'objectivec'],
    ['objective-c', 'objectivec'],
    ['py', 'python'],
    ['rb', 'ruby'],
    ['sh', 'bash'],
    ['shell', 'bash'],
    ['shell-session', 'bash'],
    ['terminal', 'bash'],
    ['ts', 'typescript'],
    ['tsx', 'typescript'],
    ['typescriptreact', 'typescript'],
    ['xml', 'xml'],
    ['yml', 'yaml'],
    ['zsh', 'bash'],
  ] as Array<[string, string]>) {
    if (!hljs.getLanguage(alias)) hljs.registerAliases(alias, { languageName: target });
  }
}

function renderHighlightedCode(code: string, language: string, sourceLineStart?: number, sourceLineEnd?: number) {
  const normalizedLanguage = normalizeHighlightLanguage(language);
  const escaped = escapeHtml(code);
  if (normalizedLanguage && normalizedLanguage !== 'text' && hljs.getLanguage(normalizedLanguage)) {
    try {
      const highlighted = hljs.highlight(code, {
        language: normalizedLanguage,
        ignoreIllegals: true,
      }).value;
      return renderCodeBlock(highlighted, normalizedLanguage, true, sourceLineStart, sourceLineEnd);
    } catch {
      return renderCodeBlock(escaped, 'text', false, sourceLineStart, sourceLineEnd);
    }
  }
  return renderCodeBlock(escaped, 'text', false, sourceLineStart, sourceLineEnd);
}

function renderPreviewHtml(source: string, filePath: string) {
  if (isSourcePreviewFile(filePath)) {
    const language = sourcePreviewLanguage(filePath);
    const previewSource = formatSourcePreviewContent(source, language);
    return `${renderHighlightedCode(previewSource, language, 1, sourceLineCount(previewSource))}\n`;
  }
  if (isAsciidocPreviewFile(filePath)) {
    return ASCIIDOC_PREVIEW_PENDING_HTML;
  }
  return markdownRenderer.render(source, { docId: filePath });
}

function isSourcePreviewFile(filePath: string) {
  return /\.json$/i.test(String(filePath || ''));
}

function sourcePreviewLanguage(filePath: string) {
  const value = String(filePath || '');
  if (/\.json$/i.test(value)) return 'json';
  return 'text';
}

function isMarkdownPreviewFile(filePath: string) {
  return /\.(md|markdown|mdown)$/i.test(String(filePath || ''));
}

function isAsciidocPreviewFile(filePath: string) {
  return /\.(adoc|asciidoc|asc)$/i.test(String(filePath || ''));
}

function isPreviewableFile(filePath: string) {
  const value = String(filePath || '');
  return isMarkdownPreviewFile(value) || isAsciidocPreviewFile(value) || /\.json$/i.test(value);
}

function defaultBodyModeForPath(filePath: string): BodyMode {
  if (/\.json$/i.test(filePath)) return 'tree';
  if (isMarkdownPreviewFile(filePath)) return 'document';
  if (isAsciidocPreviewFile(filePath)) return 'preview';
  return 'edit';
}

function documentEligibilityMessage(reason: string) {
  switch (reason) {
    case 'document-too-large': return '50,000자를 넘는 문서';
    case 'mdx': return 'MDX import/export 구문';
    case 'raw-html': return '지원하지 않는 HTML 또는 JSX';
    case 'directive': return 'Markdown directive 구문';
    case 'footnote': return '각주 구문';
    case 'reference-definition': return '참조 링크 정의';
    case 'wiki-link': return '위키 링크 구문';
    case 'math': return '수학 블록';
    default: return '안전하게 변환할 수 없는 구문';
  }
}

function formatSourcePreviewContent(source: string, language: string) {
  if (language !== 'json') return source;
  const trimmed = String(source || '').trim();
  if (!trimmed) return source;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return source;
  }
}

function sourceLineCount(source: string) {
  const normalized = String(source || '').replace(/\r\n?/g, '\n');
  const withoutTrailingNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  if (!withoutTrailingNewline) return 1;
  return withoutTrailingNewline.split('\n').length;
}

function copyTextImmediately(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } catch {
    // The bridge-backed async copy remains the authoritative fallback.
  } finally {
    textarea.remove();
  }
}

function renderCodeBlock(highlightedCode: string, language: string, highlighted = true, sourceLineStart?: number, sourceLineEnd?: number) {
  const classLanguage = language === 'code' ? 'text' : language;
  const codeClass = highlighted
    ? ` class="hljs language-${classLanguage}" data-lang="${classLanguage}"`
    : ` data-lang="${classLanguage}"`;
  const label = escapeHtml(formatLanguageLabel(classLanguage));
  const safeStart = Number.isFinite(sourceLineStart) && sourceLineStart && sourceLineStart > 0 ? sourceLineStart : undefined;
  const safeEnd = Number.isFinite(sourceLineEnd) && sourceLineEnd && safeStart ? Math.max(safeStart, sourceLineEnd) : safeStart;
  const lineAttrs = safeStart && safeEnd
    ? ` data-line-start="${safeStart}" data-line-end="${safeEnd}" data-line-label="${safeStart === safeEnd ? safeStart : `${safeStart}-${safeEnd}`}"`
    : '';
  return `<pre class="code-block code-block-${classLanguage}" data-language-label="${label}"${lineAttrs}><code${codeClass}>${highlightedCode}</code></pre>`;
}

function addTokenLineAttrs(token: Token | undefined) {
  if (!token || !Array.isArray(token.map)) return;
  const start = token.map[0] + 1;
  const end = Math.max(start, token.map[1]);
  token.attrSet('data-line-start', String(start));
  token.attrSet('data-line-end', String(end));
  token.attrSet('data-line-label', start === end ? String(start) : `${start}-${end}`);
}

function makeHtmlInline(content: string) {
  const token = new Token('html_inline', '', 0);
  token.content = content;
  return token;
}

function removePrefixFromInlineTokens(tokens: Token[], prefix: string) {
  let removed = false;
  return tokens.map(token => removePrefixFromInlineToken(token, prefix, () => removed, value => {
    removed = value;
  }));
}

function removePrefixFromInlineToken(
  token: Token,
  prefix: string,
  getRemoved: () => boolean,
  setRemoved: (value: boolean) => void,
) {
  if (getRemoved()) return token;
  if (token.type === 'text') {
    const trimmedStart = token.content.trimStart();
    if (!trimmedStart.startsWith(prefix)) return token;
    const clone = cloneToken(token);
    const leadingSpaceLength = token.content.length - trimmedStart.length;
    const leadingSpace = token.content.slice(0, leadingSpaceLength);
    clone.content = leadingSpace + trimmedStart.slice(prefix.length).trimStart();
    setRemoved(true);
    return clone;
  }
  if (token.children?.length) {
    const clone = cloneToken(token);
    clone.children = token.children.map(child => removePrefixFromInlineToken(child, prefix, getRemoved, setRemoved));
    return clone;
  }
  return token;
}

function highlightRiskKeywordsInInlineTokens(tokens: Token[]) {
  return tokens.flatMap(token => highlightRiskKeywordsInInlineToken(token));
}

function highlightRiskKeywordsInInlineToken(token: Token): Token[] {
  if (token.type === 'code_inline' || token.type === 'html_inline') return [token];
  if (token.type === 'text') return splitRiskTextToken(token);
  if (token.children?.length) {
    const clone = cloneToken(token);
    clone.children = highlightRiskKeywordsInInlineTokens(token.children);
    return [clone];
  }
  return [token];
}

function splitRiskTextToken(token: Token): Token[] {
  const keyword = RISK_KEYWORDS.find(item => token.content.includes(item));
  if (!keyword) return [token];
  const result: Token[] = [];
  const parts = token.content.split(keyword);
  parts.forEach((part, index) => {
    if (part) {
      const textToken = cloneToken(token);
      textToken.content = part;
      result.push(textToken);
    }
    if (index < parts.length - 1) {
      result.push(makeHtmlInline(`<span class="md-risk-token">${escapeHtml(keyword)}</span>`));
    }
  });
  return result.flatMap(item => item.type === 'text' ? splitRiskTextToken(item) : [item]);
}

function cloneToken(token: Token) {
  const clone = new Token(token.type, token.tag, token.nesting);
  clone.attrs = token.attrs ? token.attrs.map(attr => [...attr] as [string, string]) : null;
  clone.map = token.map ? [...token.map] as [number, number] : null;
  clone.level = token.level;
  clone.children = token.children ? [...token.children] : null;
  clone.content = token.content;
  clone.markup = token.markup;
  clone.info = token.info;
  clone.meta = token.meta;
  clone.block = token.block;
  clone.hidden = token.hidden;
  return clone;
}

function formatLanguageLabel(language: string) {
  const labels: Record<string, string> = {
    bash: 'Shell',
    c: 'C',
    cpp: 'C++',
    css: 'CSS',
    dart: 'Dart',
    go: 'Go',
    java: 'Java',
    javascript: 'JavaScript',
    json: 'JSON',
    kotlin: 'Kotlin',
    markdown: 'Markdown',
    objectivec: 'Objective-C',
    text: 'Text',
    python: 'Python',
    ruby: 'Ruby',
    rust: 'Rust',
    sql: 'SQL',
    swift: 'Swift',
    typescript: 'TypeScript',
    xml: 'HTML/XML',
    yaml: 'YAML',
  };
  return labels[language] || language.toUpperCase();
}

function normalizeHighlightLanguage(language: string) {
  const value = String(language || '').trim().toLowerCase().split(/\s+/)[0] || '';
  const aliases: Record<string, string> = {
    'c++': 'cpp',
    cjs: 'javascript',
    cc: 'cpp',
    console: 'bash',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',
    htm: 'xml',
    html: 'xml',
    js: 'javascript',
    jsonc: 'json',
    jsx: 'javascript',
    kt: 'kotlin',
    md: 'markdown',
    mjs: 'javascript',
    objc: 'objectivec',
    'objective-c': 'objectivec',
    plain: 'text',
    plaintext: 'text',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    shell: 'bash',
    'shell-session': 'bash',
    terminal: 'bash',
    txt: 'text',
    ts: 'typescript',
    tsx: 'typescript',
    yml: 'yaml',
    zsh: 'bash',
  };
  return aliases[value] || value;
}

function editorLanguageExtension(filePath: string): Extension {
  const value = String(filePath || '');
  if (/\.(adoc|asciidoc|asc)$/i.test(value)) return [markdown(), asciidocEditorSyntaxHighlighting()];
  if (/\.json$/i.test(value)) return codeMirrorJson();
  if (/\.(js|mjs|cjs|jsx)$/i.test(value)) return codeMirrorJavascript({ jsx: true });
  if (/\.(ts|tsx)$/i.test(value)) return codeMirrorJavascript({ jsx: /\.tsx$/i.test(value), typescript: true });
  return markdown();
}

function editorIndentExtensions(mode: IndentMode, tabSize: number): Extension[] {
  return [
    indentUnit.of(mode === 'tabs' ? '\t' : ' '.repeat(tabSize)),
    EditorState.tabSize.of(tabSize),
    leadingIndentGuides(tabSize),
  ];
}

function leadingIndentGuides(tabSize: number): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLeadingIndentDecorations(view, tabSize);
    }

    update(update: ViewUpdate) {
      if (!update.docChanged && !update.viewportChanged) return;
      this.decorations = buildLeadingIndentDecorations(update.view, tabSize);
    }
  }, {
    decorations: plugin => plugin.decorations,
  });
}

function buildLeadingIndentDecorations(view: EditorView, tabSize: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    let position = range.from;
    while (position <= range.to) {
      const line = view.state.doc.lineAt(position);
      const leading = /^[ \t]+/.exec(line.text)?.[0] || '';
      let column = 0;
      for (let index = 0; index < leading.length; index += 1) {
        const char = leading[index];
        const width = char === '\t' ? tabSize - (column % tabSize || 0) : 1;
        const atIndentBoundary = column % tabSize === 0;
        builder.add(
          line.from + index,
          line.from + index + 1,
          Decoration.replace({
            widget: new IndentWhitespaceWidget(char === '\t' ? 'tab' : 'space', width, atIndentBoundary),
          }),
        );
        column += width;
      }
      position = line.to + 1;
    }
  }
  return builder.finish();
}

type EditorSyntaxRange = {
  from: number;
  to: number;
  className: string;
};

function asciidocEditorSyntaxHighlighting(): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildAsciiDocSyntaxDecorations(view);
    }

    update(update: ViewUpdate) {
      if (!update.docChanged && !update.viewportChanged) return;
      this.decorations = buildAsciiDocSyntaxDecorations(update.view);
    }
  }, {
    decorations: plugin => plugin.decorations,
  });
}

function buildAsciiDocSyntaxDecorations(view: EditorView): DecorationSet {
  const ranges: EditorSyntaxRange[] = [];
  for (const visible of view.visibleRanges) {
    let position = visible.from;
    while (position <= visible.to) {
      const line = view.state.doc.lineAt(position);
      collectAsciiDocLineSyntaxRanges(line.text, line.from, ranges);
      if (line.to >= view.state.doc.length) break;
      position = line.to + 1;
    }
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const range of ranges) {
    if (range.to <= range.from || range.from < lastTo) continue;
    builder.add(range.from, range.to, Decoration.mark({ class: range.className }));
    lastTo = range.to;
  }
  return builder.finish();
}

function collectAsciiDocLineSyntaxRanges(text: string, lineFrom: number, ranges: EditorSyntaxRange[]) {
  const trimmed = text.trim();
  if (!trimmed) return;

  const heading = /^(={1,6})\s+(.+)$/.exec(text);
  if (heading) {
    ranges.push({
      from: lineFrom,
      to: lineFrom + text.length,
      className: `cm-adoc-heading cm-adoc-heading-${Math.min(heading[1].length, 6)}`,
    });
    return;
  }

  if (/^\s*\[[^\]]+\]\s*$/.test(text)) {
    ranges.push({ from: lineFrom, to: lineFrom + text.length, className: 'cm-adoc-attribute' });
    return;
  }

  if (/^\s*(----+|====+|____+|\*\*\*\*+)\s*$/.test(text)) {
    ranges.push({ from: lineFrom, to: lineFrom + text.length, className: 'cm-adoc-delimiter' });
    return;
  }

  addAsciiDocMatchRange(text, lineFrom, ranges, /^(\s*(NOTE|TIP|WARNING|IMPORTANT|CAUTION):)/, 'cm-adoc-admonition');
  addAsciiDocMatchRange(text, lineFrom, ranges, /^(\s*[*.-]\s+)/, 'cm-adoc-list-marker');
  addAsciiDocMatchRange(text, lineFrom, ranges, /`[^`\n]+`/g, 'cm-adoc-inline-code');
  addAsciiDocMatchRange(text, lineFrom, ranges, /\*[^*\n]+\*/g, 'cm-adoc-strong');
  addAsciiDocMatchRange(text, lineFrom, ranges, /\b[A-Z][A-Z0-9_]{2,}\b/g, 'cm-adoc-constant');
}

function addAsciiDocMatchRange(
  text: string,
  lineFrom: number,
  ranges: EditorSyntaxRange[],
  expression: RegExp,
  className: string,
) {
  if (!expression.global) {
    const match = expression.exec(text);
    if (!match?.[0]) return;
    const index = match.index ?? 0;
    ranges.push({ from: lineFrom + index, to: lineFrom + index + match[0].length, className });
    return;
  }
  for (const match of text.matchAll(expression)) {
    if (!match[0]) continue;
    const index = match.index ?? 0;
    ranges.push({ from: lineFrom + index, to: lineFrom + index + match[0].length, className });
  }
}

class IndentWhitespaceWidget extends WidgetType {
  constructor(
    private readonly kind: 'space' | 'tab',
    private readonly width: number,
    private readonly indentBoundary: boolean,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = [
      'cm-indent-whitespace',
      this.kind === 'tab' ? 'cm-indent-tab' : 'cm-indent-space',
      this.indentBoundary ? 'cm-indent-boundary' : '',
    ].filter(Boolean).join(' ');
    span.textContent = this.kind === 'tab' ? '→' : '·';
    span.style.width = `${this.width}ch`;
    return span;
  }

  eq(other: IndentWhitespaceWidget) {
    return this.kind === other.kind && this.width === other.width && this.indentBoundary === other.indentBoundary;
  }

  ignoreEvent() {
    return true;
  }
}

function editorCommandItems(options: {
  indentMode: IndentMode;
  tabSize: number;
  setIndentMode: (mode: IndentMode) => void;
  setCommandPaletteMode: (mode: CommandPaletteMode) => void;
  setPendingIndentMode: (mode: IndentMode) => void;
  setCommandQuery: (query: string) => void;
  setCommandIndex: (index: number) => void;
  closeCommandPalette: () => void;
  convertIndentation: (mode: IndentMode) => void;
}): CommandItem[] {
  return [
    {
      id: 'indent-tabs',
      label: 'Indent Using Tabs',
      detail: options.indentMode === 'tabs' ? 'currently used' : undefined,
      run: () => {
        options.setPendingIndentMode('tabs');
        options.setCommandPaletteMode('tab-size');
        options.setCommandQuery('');
        options.setCommandIndex(0);
      },
    },
    {
      id: 'indent-spaces',
      label: 'Indent Using Spaces',
      detail: options.indentMode === 'spaces' ? 'currently used' : undefined,
      run: () => {
        options.setPendingIndentMode('spaces');
        options.setCommandPaletteMode('tab-size');
        options.setCommandQuery('');
        options.setCommandIndex(0);
      },
    },
    {
      id: 'convert-tabs',
      label: 'Convert Indentation to Tabs',
      run: () => {
        options.convertIndentation('tabs');
        options.setIndentMode('tabs');
        options.closeCommandPalette();
      },
    },
    {
      id: 'convert-spaces',
      label: 'Convert Indentation to Spaces',
      run: () => {
        options.convertIndentation('spaces');
        options.setIndentMode('spaces');
        options.closeCommandPalette();
      },
    },
  ];
}

function tabSizeCommandItems(pendingMode: IndentMode, currentTabSize: number, applySettings: (size: number) => void, closeCommandPalette: () => void): CommandItem[] {
  return [2, 4].map(size => {
    return {
      id: `tab-size-${size}`,
      label: String(size),
      detail: size === currentTabSize ? `Configured ${pendingMode === 'tabs' ? 'Tab' : 'Space'} Size` : undefined,
      run: () => {
        applySettings(size);
        closeCommandPalette();
      },
    };
  });
}

function readIndentSettings(filePath: string): { mode: IndentMode; tabSize: number } {
  const language = indentLanguageForPath(filePath);
  try {
    const stored = JSON.parse(window.localStorage.getItem(indentPreferenceKey(language)) || 'null') as { mode?: string; tabSize?: number } | null;
    if (stored?.mode === 'tabs' || stored?.mode === 'spaces') {
      return {
        mode: stored.mode,
        tabSize: sanitizeTabSize(stored.tabSize),
      };
    }
  } catch {
    // Fall back to language recommendations.
  }
  return recommendedIndentSettings(language);
}

function writeIndentSettings(filePath: string, mode: IndentMode, tabSize: number) {
  const language = indentLanguageForPath(filePath);
  window.localStorage.setItem(indentPreferenceKey(language), JSON.stringify({
    mode,
    tabSize: sanitizeTabSize(tabSize),
  }));
}

function indentPreferenceKey(language: string) {
  return `docpilot:editor-indent:${language}`;
}

function indentLanguageForPath(filePath: string) {
  const value = String(filePath || '').toLowerCase();
  if (/\.(md|markdown|mdown)$/i.test(value)) return 'markdown';
  if (/\.json$/i.test(value)) return 'json';
  if (/\.(js|mjs|cjs|jsx)$/i.test(value)) return 'javascript';
  if (/\.(ya?ml)$/i.test(value)) return 'yaml';
  if (/\.py$/i.test(value)) return 'python';
  if (/\.(java|kt|kts|swift|c|cc|cpp|h|hpp)$/i.test(value)) return 'c-family';
  if (/^makefile$|\.mk$/i.test(value.split('/').pop() || '')) return 'make';
  if (/\.(go)$/i.test(value)) return 'go';
  return 'text';
}

function recommendedIndentSettings(language: string): { mode: IndentMode; tabSize: number } {
  const recommendations: Record<string, { mode: IndentMode; tabSize: number }> = {
    markdown: { mode: 'spaces', tabSize: 2 },
    json: { mode: 'spaces', tabSize: 2 },
    javascript: { mode: 'spaces', tabSize: 2 },
    yaml: { mode: 'spaces', tabSize: 2 },
    python: { mode: 'spaces', tabSize: 4 },
    'c-family': { mode: 'spaces', tabSize: 4 },
    go: { mode: 'tabs', tabSize: 4 },
    make: { mode: 'tabs', tabSize: 4 },
    text: { mode: 'spaces', tabSize: 2 },
  };
  return recommendations[language] || recommendations.text;
}

function sanitizeTabSize(value: unknown) {
  const numberValue = Number(value || 2);
  return Number.isFinite(numberValue) ? Math.min(8, Math.max(1, Math.round(numberValue))) : 2;
}

function filterCommandItems(items: CommandItem[], query: string) {
  const normalizedQuery = query.replace(/^>\s*/, '').trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.filter(item => `${item.label} ${item.detail || ''}`.toLowerCase().includes(normalizedQuery));
}

function highlightCommandName(label: string, query: string) {
  const normalizedQuery = query.replace(/^>\s*/, '').trim().toLowerCase();
  if (!normalizedQuery) return label;
  const lower = label.toLowerCase();
  const start = lower.indexOf(normalizedQuery);
  if (start === -1) return label;
  return [
    label.slice(0, start),
    <mark key="match">{label.slice(start, start + normalizedQuery.length)}</mark>,
    label.slice(start + normalizedQuery.length),
  ];
}

function convertLeadingIndentation(source: string, targetMode: IndentMode, tabSize: number) {
  return source.split(/(\r?\n)/).map(part => {
    if (part === '\n' || part === '\r\n') return part;
    const match = /^([ \t]+)/.exec(part);
    if (!match) return part;
    const indent = match[1];
    const rest = part.slice(indent.length);
    const width = indentWidth(indent, tabSize);
    if (targetMode === 'spaces') return `${' '.repeat(width)}${rest}`;
    const tabs = Math.floor(width / tabSize);
    const spaces = width % tabSize;
    return `${'\t'.repeat(tabs)}${' '.repeat(spaces)}${rest}`;
  }).join('');
}

function indentWidth(indent: string, tabSize: number) {
  let width = 0;
  for (const char of indent) {
    width += char === '\t' ? tabSize - (width % tabSize || 0) : 1;
  }
  return width;
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseHeadings(markdownText: string) {
  const tokens = markdownRenderer.parse(markdownText, {});
  const headings: Array<{ level: number; text: string; line: number }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'heading_open') continue;
    const level = Number(token.tag.replace(/^h/, ''));
    if (!Number.isInteger(level) || level < 1 || level > 6) continue;
    const inline = tokens[index + 1];
    const text = inline?.type === 'inline'
      ? inline.content.replace(/[#*_`[\]]/g, '').trim()
      : '';
    if (!text) continue;
    headings.push({
      level,
      text,
      line: Array.isArray(token.map) ? token.map[0] : headings.length,
    });
  }
  return headings;
}

// AsciiDoc has no markdown-it token stream to walk, but scrollToHeading()
// only ever looks up rendered h1-h6 DOM nodes by index anyway — so parsing
// the converted HTML directly works the same way for both formats.
function parseHeadingsFromHtml(html: string, source = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const headings: Array<{ level: number; text: string; line: number }> = [];
  const sourceLines = source.split(/\r?\n/);
  let searchFromLine = 0;
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(node => {
    const text = node.textContent?.trim() || '';
    if (!text) return;
    const line = findHeadingLineInSource(sourceLines, text, searchFromLine);
    if (line !== -1) searchFromLine = line + 1;
    headings.push({ level: Number(node.tagName.slice(1)), text, line: line === -1 ? headings.length : line });
  });
  return headings;
}

function findHeadingLineInSource(lines: string[], headingText: string, startLine: number) {
  const normalizedHeading = normalizeHeadingText(headingText);
  if (!normalizedHeading) return -1;
  for (let index = Math.max(0, startLine); index < lines.length; index += 1) {
    if (normalizeHeadingText(lines[index]) === normalizedHeading) return index;
  }
  for (let index = 0; index < Math.max(0, startLine); index += 1) {
    if (normalizeHeadingText(lines[index]) === normalizedHeading) return index;
  }
  return -1;
}

function normalizeHeadingText(value: string) {
  return value
    .replace(/^[=\s#.\d]+/, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[#*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function DiffChangesRail({ rows, onAccept, onExit }: { rows: DiffRow[]; onAccept: () => void; onExit: () => void }) {
  const changed = rows
    .map((row, index) => ({ row, index }))
    .filter(item => item.row.type !== 'same');
  const groups = groupDiffChanges(rows);
  const additions = changed.filter(item => item.row.type === 'add' || item.row.type === 'change').length;
  const deletions = changed.filter(item => item.row.type === 'del' || item.row.type === 'change').length;
  return (
    <aside className="diff-changes-rail" aria-label="Document changes">
      <header>
        <div className="diff-rail-tabs" role="tablist" aria-label="Review rail">
          <button type="button" role="tab" aria-selected="false" onClick={onExit}>Outline</button>
          <button className="active" type="button" role="tab" aria-selected="true">Changes <span>{groups.length}</span></button>
        </div>
        <div className="diff-rail-summary">
          <strong>Summary</strong>
          <span>{groups.length} {groups.length === 1 ? 'change' : 'changes'}</span>
          <span className="add">+{additions}</span>
          <span className="del">−{deletions}</span>
        </div>
      </header>
      <div className="diff-change-list">
        {groups.map((group, changeIndex) => (
          <button
            key={`${group.startIndex}-${group.endIndex}`}
            type="button"
            onClick={() => scrollDiffChangeIntoView(group.startIndex)}
          >
            <span className="diff-change-index">{changeIndex + 1}</span>
            <span>
              <strong>{diffChangeGroupLabel(group.rows)}</strong>
              <small>{diffChangeGroupSummary(group.rows)}</small>
            </span>
          </button>
        ))}
      </div>
      <footer>
        <button className="diff-accept-button" type="button" onClick={onAccept}>Accept Changes</button>
        <button className="diff-return-button" type="button" onClick={onExit}>Return to Edit</button>
      </footer>
    </aside>
  );
}

function groupDiffChanges(rows: DiffRow[]) {
  const groups: Array<{ startIndex: number; endIndex: number; rows: DiffRow[] }> = [];
  rows.forEach((row, index) => {
    if (row.type === 'same') return;
    const current = groups.at(-1);
    if (current && current.endIndex === index - 1) {
      current.endIndex = index;
      current.rows.push(row);
      return;
    }
    groups.push({ startIndex: index, endIndex: index, rows: [row] });
  });
  return groups;
}

function diffChangeGroupLabel(rows: DiffRow[]) {
  const types = new Set(rows.map(row => row.type));
  if ([...types].every(type => type === 'add')) return 'Added';
  if ([...types].every(type => type === 'del')) return 'Deleted';
  return 'Changed';
}

function diffChangeGroupSummary(rows: DiffRow[]) {
  const summaries = rows.map(diffChangeSummary).filter(Boolean);
  const value = summaries.slice(0, 2).join(' · ');
  return summaries.length > 2 ? `${value}…` : value || 'Document block';
}

function scrollDiffChangeIntoView(index: number) {
  const target = document.querySelector<HTMLElement>(`[data-diff-index="${index}"]`);
  const scroller = target?.closest<HTMLElement>('.markdown-preview');
  if (!target || !scroller) return;
  const targetRect = target.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const centeredOffset = targetRect.top - scrollerRect.top - (scroller.clientHeight - targetRect.height) / 2;
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + centeredOffset), behavior: 'auto' });
}

function diffChangeSummary(row: DiffRow) {
  const value = blockToDiffText(row.newBlock || row.oldBlock).replace(/\s+/g, ' ').trim();
  return value.length > 88 ? `${value.slice(0, 85)}…` : value || 'Document block';
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
              <PreviewDiffBlock key={`old-${index}`} row={row} side="old" lineLabel={String(index + 1)} />,
              <PreviewDiffBlock key={`new-${index}`} row={row} side="new" lineLabel={String(index + 1)} />,
            ];
          }
          return [<PreviewDiffBlock key={`${row.type}-${index}`} row={row} side={row.type === 'del' ? 'old' : 'new'} lineLabel={String(index + 1)} />];
        })}
      </div>
      <DiffMinimap rows={rows} />
    </div>
  );
}

function PreviewSplitDiff({ rows }: { rows: DiffRow[] }) {
  const oldListRef = useRef<HTMLDivElement | null>(null);
  const newListRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef(false);
  if (!rows.some(row => row.type !== 'same')) return <div className="preview-diff-empty">변경 사항 없음</div>;
  return (
    <div className="preview-diff-split">
      <section>
        <div className="diff-head">프리뷰 · 기존</div>
        <div
          className="preview-diff-list"
          ref={oldListRef}
          onScroll={() => syncDiffScroll(oldListRef.current, newListRef.current, scrollLockRef)}
        >
          {rows.map((row, index) => <PreviewDiffBlock key={`old-${index}`} row={row} side="old" lineLabel={String(index + 1)} split />)}
        </div>
      </section>
      <section>
        <div className="diff-head">프리뷰 · 변경</div>
        <div
          className="preview-diff-list"
          ref={newListRef}
          onScroll={() => syncDiffScroll(newListRef.current, oldListRef.current, scrollLockRef)}
        >
          {rows.map((row, index) => <PreviewDiffBlock key={`new-${index}`} row={row} side="new" lineLabel={String(index + 1)} split />)}
        </div>
      </section>
      <DiffMinimap rows={rows} />
    </div>
  );
}

function DiffMinimap({ rows }: { rows: Array<{ type: string }> }) {
  const changed = rows
    .map((row, index) => ({ row, index }))
    .filter(item => item.row.type !== 'same');
  if (!changed.length) return null;
  const total = Math.max(rows.length - 1, 1);
  return (
    <div className="diff-minimap" aria-hidden="true">
      {changed.map(({ row, index }) => (
        <span
          className={`diff-minimap-marker ${row.type}`}
          key={`${row.type}-${index}`}
          style={{ top: `${(index / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

function PreviewDiffBlock({ row, side, lineLabel, split = false }: { row: DiffRow; side: 'old' | 'new'; lineLabel: string; split?: boolean }) {
  const hidden = (row.type === 'add' && side === 'old') || (row.type === 'del' && side === 'new');
  const oldText = blockToDiffText(row.oldBlock);
  const newText = blockToDiffText(row.newBlock);
  const text = side === 'old' ? oldText : newText;
  const block = side === 'old' ? row.oldBlock : row.newBlock;
  const changedRange = row.type === 'change'
    ? inlineDiffRange(oldText, newText, side)
    : row.type !== 'same'
      ? { start: 0, end: text.length }
      : null;
  const sideClass = row.type === 'change' ? (side === 'old' ? 'change-old' : 'change-new') : '';
  return (
    <section className={`preview-diff-block ${row.type} ${sideClass} ${hidden ? 'hidden-placeholder' : ''} ${split ? 'split' : ''}`} data-line-label={lineLabel} data-diff-index={Number(lineLabel) - 1}>
      <PreviewDiffRenderedBlock block={block || ''} fallbackText={text} changedRange={changedRange} side={side} />
    </section>
  );
}

function PreviewDiffRenderedBlock({
  block,
  fallbackText,
  changedRange,
  side,
}: {
  block: string;
  fallbackText: string;
  changedRange: InlineDiffRange;
  side: 'old' | 'new';
}) {
  const source = String(block || '').trim();
  if (!source) {
    return <div className="preview-diff-rendered preview-diff-empty-block">&nbsp;</div>;
  }

  if (canRenderDiffBlockWithMarkdownIt(source)) {
    return (
      <div
        className="preview-diff-rendered preview-diff-rendered-markdown"
        dangerouslySetInnerHTML={{ __html: markdownRenderer.render(source) }}
      />
    );
  }

  return (
    <div className="preview-diff-rendered">
      {renderPreviewDiffMarkdownBlock(block, fallbackText, changedRange, side)}
    </div>
  );
}

function canRenderDiffBlockWithMarkdownIt(block: string) {
  // The diff-aware renderer handles normal Markdown so it can preserve the
  // unchanged prefix/suffix and highlight only the edited token. Fall back to
  // markdown-it only for embedded media/interactive HTML it cannot model.
  return /<(?:img|details|summary|video|audio|iframe|figure)\b/i.test(String(block || ''));
}

type InlineDiffPart = {
  text: string;
  code: boolean;
  changed: boolean;
};

type InlineDiffRange = {
  start: number;
  end: number;
} | null;

function inlineDiffRange(oldText: string, newText: string, side: 'old' | 'new'): InlineDiffRange {
  const text = side === 'old' ? oldText : newText;
  const compare = side === 'old' ? newText : oldText;
  if (!text) return null;
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
  return textEnd >= start ? { start, end: textEnd + 1 } : null;
}

function renderPreviewDiffMarkdownBlock(block: string, fullText: string, changedRange: InlineDiffRange, side: 'old' | 'new') {
  const lines = String(block || '').split(/\r?\n/);
  const visibleLines = lines.filter(line => line.trim());
  const cursor = { current: 0 };
  if (!visibleLines.length) return <span>&nbsp;</span>;

  if (/^```/.test(visibleLines[0])) {
    const code = visibleLines
      .filter(line => !/^```/.test(line))
      .join('\n');
    return (
      <pre>
        <code>{renderPreviewDiffInline(code, fullText, cursor, changedRange, side)}</code>
      </pre>
    );
  }

  if (visibleLines.length === 1) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(visibleLines[0]);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const content = inlineDisplayText(heading[2]);
      const children = renderPreviewDiffInline(content, fullText, cursor, changedRange, side);
      if (level === 1) return <h1>{children}</h1>;
      if (level === 2) return <h2>{children}</h2>;
      if (level === 3) return <h3>{children}</h3>;
      if (level === 4) return <h4>{children}</h4>;
      if (level === 5) return <h5>{children}</h5>;
      return <h6>{children}</h6>;
    }
  }

  if (visibleLines.length > 1 && visibleLines.every(line => /^\|.+\|\s*$/.test(line))) {
    const rows = visibleLines.map(parseMarkdownTableRow);
    const hasSeparator = rows.length > 1 && rows[1].every(cell => /^:?-{3,}:?$/.test(cell.trim()));
    const header = rows[0] || [];
    const bodyRows = hasSeparator ? rows.slice(2) : rows.slice(1);
    return (
      <table>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={`h-${index}`}>{renderPreviewDiffInline(inlineDisplayText(cell), fullText, cursor, changedRange, side)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={`r-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{renderPreviewDiffInline(inlineDisplayText(cell), fullText, cursor, changedRange, side)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (visibleLines.length === 1 && /^\|.+\|\s*$/.test(visibleLines[0])) {
    const cells = parseMarkdownTableRow(visibleLines[0]);
    return (
      <div className="preview-diff-table-row">
        {cells.map((cell, index) => (
          <span key={index}>{renderPreviewDiffInline(inlineDisplayText(cell), fullText, cursor, changedRange, side)}</span>
        ))}
      </div>
    );
  }

  if (visibleLines.every(line => /^\s*[-*+]\s+/.test(line))) {
    return (
      <ul>
        {visibleLines.map((line, index) => (
          <li key={index}>{renderPreviewDiffInline(inlineDisplayText(line.replace(/^\s*[-*+]\s+/, '')), fullText, cursor, changedRange, side)}</li>
        ))}
      </ul>
    );
  }

  if (visibleLines.every(line => /^\s*\d+\.\s+/.test(line))) {
    return (
      <ol>
        {visibleLines.map((line, index) => (
          <li key={index}>{renderPreviewDiffInline(inlineDisplayText(line.replace(/^\s*\d+\.\s+/, '')), fullText, cursor, changedRange, side)}</li>
        ))}
      </ol>
    );
  }

  if (visibleLines.every(line => /^>\s?/.test(line))) {
    const text = visibleLines.map(line => inlineDisplayText(line.replace(/^>\s?/, ''))).join(' ');
    return <blockquote><p>{renderPreviewDiffInline(text, fullText, cursor, changedRange, side)}</p></blockquote>;
  }

  const text = visibleLines.map(line => inlineDisplayText(line)).join(' ');
  return <p>{renderPreviewDiffInline(text, fullText, cursor, changedRange, side)}</p>;
}

function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function inlineDisplayText(text: string) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .trim();
}

function renderPreviewDiffInline(
  segment: string,
  fullText: string,
  cursor: { current: number },
  changedRange: InlineDiffRange,
  side: 'old' | 'new',
): ReactNode[] {
  const text = String(segment || '');
  if (!text) return [];
  const found = fullText.indexOf(text, cursor.current);
  const start = found >= 0 ? found : cursor.current;
  const end = start + text.length;
  cursor.current = end;
  const localParts: Array<{ text: string; changed: boolean }> = [];

  if (!changedRange || changedRange.end <= start || changedRange.start >= end) {
    localParts.push({ text, changed: false });
  } else {
    const changedStart = Math.max(changedRange.start, start) - start;
    const changedEnd = Math.min(changedRange.end, end) - start;
    if (changedStart > 0) localParts.push({ text: text.slice(0, changedStart), changed: false });
    if (changedEnd > changedStart) localParts.push({ text: text.slice(changedStart, changedEnd), changed: true });
    if (changedEnd < text.length) localParts.push({ text: text.slice(changedEnd), changed: false });
  }

  return localParts.flatMap((part, index) => (
    tokenizeInlineDiffText(part.text, part.changed).map((token, tokenIndex) => (
      <span
        className={`preview-diff-token ${token.code ? 'code' : ''} ${token.changed ? `changed ${side}` : ''}`}
        key={`${start}-${index}-${tokenIndex}-${token.text}`}
      >
        {token.text}
      </span>
    ))
  ));
}

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
      <DiffMinimap rows={rows} />
    </div>
  );
}

function RawSplitDiff({ rows }: { rows: LineDiffRow[] }) {
  const oldLinesRef = useRef<HTMLDivElement | null>(null);
  const newLinesRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef(false);
  return (
    <div className="raw-diff-split">
      <section>
        <div className="diff-head">편집 RAW · 기준</div>
        <div
          className="raw-diff-lines"
          ref={oldLinesRef}
          onScroll={() => syncDiffScroll(oldLinesRef.current, newLinesRef.current, scrollLockRef)}
        >
          {rows.map((row, index) => <RawLine row={row} side="old" key={`old-${index}`} />)}
        </div>
      </section>
      <section>
        <div className="diff-head">편집 RAW · 변경</div>
        <div
          className="raw-diff-lines"
          ref={newLinesRef}
          onScroll={() => syncDiffScroll(newLinesRef.current, oldLinesRef.current, scrollLockRef)}
        >
          {rows.map((row, index) => <RawLine row={row} side="new" key={`new-${index}`} />)}
        </div>
      </section>
      <DiffMinimap rows={rows} />
    </div>
  );
}

function syncDiffScroll(source: HTMLElement | null, target: HTMLElement | null, lockRef: { current: boolean }) {
  if (!source || !target || lockRef.current) return;
  lockRef.current = true;
  target.scrollTop = source.scrollTop;
  target.scrollLeft = source.scrollLeft;
  window.requestAnimationFrame(() => {
    lockRef.current = false;
  });
}

function RawLine({ row, side }: { row: LineDiffRow; side?: 'old' | 'new' }) {
  if (side === 'old' && row.type === 'add') return <div className="raw-diff-line placeholder"><span /><span /><span /></div>;
  if (side === 'new' && row.type === 'del') return <div className="raw-diff-line placeholder"><span /><span /><span /></div>;
  const text = side === 'old' ? row.oldText : side === 'new' ? row.newText : row.newText || row.oldText || '';
  const number = side === 'old' ? row.oldNo : side === 'new' ? row.newNo : row.newNo || row.oldNo;
  const mark = row.type === 'add' ? '+' : row.type === 'del' ? '-' : '';
  return (
    <div className={`raw-diff-line ${row.type} ${side ? 'split-line' : 'unified-line'}`}>
      <span className="raw-num">{number || ''}</span>
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
  if ((n + 1) * (m + 1) > 750_000) {
    let prefix = 0;
    while (prefix < n && prefix < m && oldLines[prefix] === newLines[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < n - prefix
      && suffix < m - prefix
      && oldLines[n - 1 - suffix] === newLines[m - 1 - suffix]
    ) suffix += 1;
    const rows: LineDiffRow[] = [];
    for (let index = 0; index < prefix; index += 1) {
      rows.push({ type: 'same', oldNo: index + 1, newNo: index + 1, oldText: oldLines[index], newText: newLines[index] });
    }
    for (let index = prefix; index < n - suffix; index += 1) {
      rows.push({ type: 'del', oldNo: index + 1, oldText: oldLines[index] });
    }
    for (let index = prefix; index < m - suffix; index += 1) {
      rows.push({ type: 'add', newNo: index + 1, newText: newLines[index] });
    }
    for (let offset = suffix; offset > 0; offset -= 1) {
      const oldIndex = n - offset;
      const newIndex = m - offset;
      rows.push({
        type: 'same',
        oldNo: oldIndex + 1,
        newNo: newIndex + 1,
        oldText: oldLines[oldIndex],
        newText: newLines[newIndex],
      });
    }
    return rows;
  }
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
