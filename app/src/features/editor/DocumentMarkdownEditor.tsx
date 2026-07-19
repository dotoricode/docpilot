import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent } from 'react';
import { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { reconcileSerializedMarkdown } from '../../../../shared/core/markdown-source-reconcile';
import { MarkdownDocumentToolbar } from './MarkdownDocumentToolbar';
import {
  filterMarkdownDocumentCommands,
  type MarkdownDocumentCommand,
} from './markdown-document-commands';
import { createMarkdownDocumentExtensions } from './markdown-document-extensions';
import {
  locateMarkdownDocumentSelection,
  type MarkdownDocumentSelection,
} from './markdown-document-selection';

type DocumentMarkdownEditorProps = {
  filePath: string;
  source: string;
  editable: boolean;
  onChange: (source: string) => void;
  onSelectionContextChange?: (selection: MarkdownDocumentSelection | null) => void;
  onSafetyFailure?: (reason: string) => void;
  onPendingChange?: (pending: boolean) => void;
};

export type DocumentMarkdownEditorHandle = {
  flush: () => string | null;
};

type SlashMenuState = {
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
};

type InlineInputState = {
  kind: 'link' | 'image';
  value: string;
  error: string;
};

function roundTripMarkdown(markdown: string) {
  let detached: Editor | null = null;
  try {
    detached = new Editor({
      element: null,
      extensions: createMarkdownDocumentExtensions(),
      content: markdown,
      contentType: 'markdown',
    });
    return detached.getMarkdown();
  } catch {
    return null;
  } finally {
    detached?.destroy();
  }
}

function markdownDocumentEquivalent(left: string, right: string) {
  let leftEditor: Editor | null = null;
  let rightEditor: Editor | null = null;
  try {
    leftEditor = new Editor({
      element: null,
      extensions: createMarkdownDocumentExtensions(),
      content: left,
      contentType: 'markdown',
    });
    rightEditor = new Editor({
      element: null,
      extensions: createMarkdownDocumentExtensions(),
      content: right,
      contentType: 'markdown',
    });
    return JSON.stringify(leftEditor.getJSON()) === JSON.stringify(rightEditor.getJSON());
  } catch {
    return false;
  } finally {
    leftEditor?.destroy();
    rightEditor?.destroy();
  }
}

function serializeDocumentEditor(editor: Editor) {
  let markdown = editor.getMarkdown();
  const lastNode = editor.state.doc.lastChild;
  if (lastNode?.type.name === 'paragraph' && lastNode.content.size === 0) {
    markdown = markdown.replace(/(?:\n{2,}(?:&nbsp;)?\s*)+$/, '');
  }
  return roundTripMarkdown(markdown) ?? markdown;
}

export const DocumentMarkdownEditor = forwardRef<DocumentMarkdownEditorHandle, DocumentMarkdownEditorProps>(
  function DocumentMarkdownEditor({
    filePath,
    source,
    editable,
    onChange,
    onSelectionContextChange,
    onSafetyFailure,
    onPendingChange,
  }, forwardedRef) {
    const rootRef = useRef<HTMLElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const originalSourceRef = useRef(source);
    const baseCanonicalRef = useRef('');
    const lastCommittedRef = useRef(source);
    const readyRef = useRef(false);
    const safetyLockedRef = useRef(false);
    const pendingCommitTimerRef = useRef<number | null>(null);
    const slashMenuRef = useRef<SlashMenuState | null>(null);
    const filteredCommandsRef = useRef<MarkdownDocumentCommand[]>([]);
    const selectedCommandIndexRef = useRef(0);
    const runSlashCommandRef = useRef<(command: MarkdownDocumentCommand) => void>(() => {});
    const openLinkInputRef = useRef<() => void>(() => {});
    const [safetyReason, setSafetyReason] = useState('');
    const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
    const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
    const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null);
    const extensions = useMemo(() => createMarkdownDocumentExtensions(filePath), [filePath]);
    const onChangeRef = useRef(onChange);
    const onSelectionContextChangeRef = useRef(onSelectionContextChange);
    const onSafetyFailureRef = useRef(onSafetyFailure);
    const onPendingChangeRef = useRef(onPendingChange);
    onChangeRef.current = onChange;
    onSelectionContextChangeRef.current = onSelectionContextChange;
    onSafetyFailureRef.current = onSafetyFailure;
    onPendingChangeRef.current = onPendingChange;
    slashMenuRef.current = slashMenu;
    selectedCommandIndexRef.current = selectedCommandIndex;

    const filteredCommands = useMemo(
      () => filterMarkdownDocumentCommands(slashMenu?.query || ''),
      [slashMenu?.query],
    );
    filteredCommandsRef.current = filteredCommands;

    function commitEditor(currentEditor: Editor, publish: boolean) {
      if (safetyLockedRef.current || !readyRef.current) return lastCommittedRef.current;
      let edited = '';
      try {
        edited = serializeDocumentEditor(currentEditor);
      } catch {
        safetyLockedRef.current = true;
        currentEditor.setEditable(false);
        setSafetyReason('serializer-error');
        setSlashMenu(null);
        setInlineInput(null);
        onPendingChangeRef.current?.(false);
        onSafetyFailureRef.current?.('serializer-error');
        return null;
      }
      const result = reconcileSerializedMarkdown({
        originalSource: originalSourceRef.current,
        baseCanonical: baseCanonicalRef.current,
        edited,
        roundTrip: (markdown: string) => roundTripMarkdown(markdown),
        equivalent: markdownDocumentEquivalent,
      });
      if (!result.ok) {
        safetyLockedRef.current = true;
        currentEditor.setEditable(false);
        setSafetyReason(result.reason);
        setSlashMenu(null);
        setInlineInput(null);
        onPendingChangeRef.current?.(false);
        onSafetyFailureRef.current?.(result.reason);
        return null;
      }
      originalSourceRef.current = result.markdown;
      baseCanonicalRef.current = edited;
      lastCommittedRef.current = result.markdown;
      if (publish) onChangeRef.current(result.markdown);
      onPendingChangeRef.current?.(false);
      return result.markdown;
    }

    const editor = useEditor({
      extensions,
      content: source,
      contentType: 'markdown',
      editable,
      editorProps: {
        attributes: {
          class: 'document-markdown-content markdown-preview',
          spellcheck: 'true',
          'aria-label': 'Markdown Document editor',
        },
        handleKeyDown: (_view, event) => {
          const currentEditor = editorRef.current;
          if (currentEditor && convertBulletTaskShortcut(currentEditor, event)) return true;
          const menu = slashMenuRef.current;
          if (menu) {
            const commands = filteredCommandsRef.current;
            if (event.key === 'ArrowDown' && commands.length) {
              event.preventDefault();
              setSelectedCommandIndex(index => (index + 1) % commands.length);
              return true;
            }
            if (event.key === 'ArrowUp' && commands.length) {
              event.preventDefault();
              setSelectedCommandIndex(index => (index - 1 + commands.length) % commands.length);
              return true;
            }
            if ((event.key === 'Enter' || event.key === 'Tab') && commands.length) {
              event.preventDefault();
              runSlashCommandRef.current(commands[selectedCommandIndexRef.current] || commands[0]);
              return true;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setSlashMenu(null);
              return true;
            }
          }
          const modifier = event.metaKey || event.ctrlKey;
          if (modifier && event.key.toLocaleLowerCase() === 'k') {
            event.preventDefault();
            openLinkInputRef.current();
            return true;
          }
          if (modifier && event.shiftKey && event.key.toLocaleLowerCase() === 'x') {
            event.preventDefault();
            currentEditor?.chain().focus().toggleStrike().run();
            return true;
          }
          return false;
        },
      },
      onCreate: ({ editor: currentEditor }) => {
        baseCanonicalRef.current = serializeDocumentEditor(currentEditor);
        readyRef.current = true;
      },
      onUpdate: ({ editor: currentEditor }) => {
        syncSlashMenu(currentEditor);
        publishSelectionContext(currentEditor);
        if (safetyLockedRef.current || !readyRef.current) return;
        onPendingChangeRef.current?.(true);
        if (pendingCommitTimerRef.current !== null) window.clearTimeout(pendingCommitTimerRef.current);
        pendingCommitTimerRef.current = window.setTimeout(() => {
          pendingCommitTimerRef.current = null;
          commitEditor(currentEditor, true);
        }, 240);
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        syncSlashMenu(currentEditor);
        publishSelectionContext(currentEditor);
      },
      onBlur: () => setSlashMenu(null),
    });
    editorRef.current = editor;

    function flush() {
      if (!editor || safetyLockedRef.current) return lastCommittedRef.current;
      if (pendingCommitTimerRef.current !== null) {
        window.clearTimeout(pendingCommitTimerRef.current);
        pendingCommitTimerRef.current = null;
      }
      return commitEditor(editor, false);
    }

    useImperativeHandle(forwardedRef, () => ({ flush }), [editor]);

    useEffect(() => {
      if (!editor || source === lastCommittedRef.current) return;
      try {
        if (pendingCommitTimerRef.current !== null) {
          window.clearTimeout(pendingCommitTimerRef.current);
          pendingCommitTimerRef.current = null;
        }
        readyRef.current = false;
        editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false });
        originalSourceRef.current = source;
        baseCanonicalRef.current = serializeDocumentEditor(editor);
        lastCommittedRef.current = source;
        safetyLockedRef.current = false;
        readyRef.current = true;
        setSafetyReason('');
        setSlashMenu(null);
        setInlineInput(null);
        onPendingChangeRef.current?.(false);
        editor.setEditable(editable);
      } catch {
        safetyLockedRef.current = true;
        setSafetyReason('parser-error');
        onPendingChangeRef.current?.(false);
        editor.setEditable(false);
        onSafetyFailureRef.current?.('parser-error');
      }
    }, [editable, editor, source]);

    useEffect(() => {
      if (!editor || safetyLockedRef.current) return;
      editor.setEditable(editable);
      if (!editable) {
        setSlashMenu(null);
        setInlineInput(null);
      }
    }, [editable, editor]);

    useEffect(() => () => {
      if (pendingCommitTimerRef.current !== null) window.clearTimeout(pendingCommitTimerRef.current);
      onSelectionContextChangeRef.current?.(null);
    }, []);

    function syncSlashMenu(currentEditor: Editor) {
      if (!editable || safetyLockedRef.current || !currentEditor.isFocused) {
        setSlashMenu(current => current ? null : current);
        return;
      }
      const { selection } = currentEditor.state;
      if (!selection.empty || !selection.$from.parent.isTextblock) {
        setSlashMenu(current => current ? null : current);
        return;
      }
      const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\n');
      const match = /^\/([^\s/]*)$/.exec(before);
      if (!match) {
        setSlashMenu(current => current ? null : current);
        return;
      }
      const from = selection.$from.start();
      const to = selection.from;
      const coords = currentEditor.view.coordsAtPos(from);
      const rootRect = rootRef.current?.getBoundingClientRect();
      const next = {
        from,
        to,
        query: match[1],
        left: Math.max(12, coords.left - (rootRect?.left || 0)),
        top: coords.bottom - (rootRect?.top || 0) + 8,
      };
      setSlashMenu(current => current
        && current.from === next.from
        && current.to === next.to
        && current.query === next.query
        && current.left === next.left
        && current.top === next.top
        ? current
        : next);
      setSelectedCommandIndex(0);
    }

    function publishSelectionContext(currentEditor: Editor) {
      const callback = onSelectionContextChangeRef.current;
      if (!callback) return;
      const { from, to, empty, $from } = currentEditor.state.selection;
      if (empty) {
        callback(null);
        return;
      }
      const text = currentEditor.state.doc.textBetween(from, to, '\n', '\n');
      const blockType = selectionBlockType($from);
      callback(locateMarkdownDocumentSelection({
        fileId: filePath,
        source: originalSourceRef.current,
        text,
        blockType,
        editorFrom: from,
        editorTo: to,
        documentSize: currentEditor.state.doc.content.size,
      }));
    }

    function openLinkInput() {
      if (!editor) return;
      const href = String(editor.getAttributes('link').href || '');
      setInlineInput({ kind: 'link', value: href, error: '' });
      setSlashMenu(null);
    }
    openLinkInputRef.current = openLinkInput;

    function openImageInput() {
      setInlineInput({ kind: 'image', value: '', error: '' });
      setSlashMenu(null);
    }

    function runSlashCommand(command: MarkdownDocumentCommand) {
      if (!editor || !slashMenuRef.current) return;
      const range = slashMenuRef.current;
      editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
      setSlashMenu(null);
      command.run(editor, { openImageInput });
    }
    runSlashCommandRef.current = runSlashCommand;

    function applyInlineInput(event: FormEvent) {
      event.preventDefault();
      if (!editor || !inlineInput) return;
      const value = sanitizeDocumentTarget(inlineInput.value, inlineInput.kind);
      if (!value) {
        setInlineInput(current => current ? { ...current, error: '안전한 URL 또는 상대 경로를 입력하세요.' } : current);
        return;
      }
      if (inlineInput.kind === 'link') {
        editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
      } else {
        editor.chain().focus().setImage({ src: value }).run();
      }
      setInlineInput(null);
    }

    return (
      <section
        ref={rootRef}
        className="document-markdown-editor"
        data-editable={editable && !safetyReason ? 'true' : 'false'}
        data-safety-reason={safetyReason}
      >
        {editable && !safetyReason ? (
          <MarkdownDocumentToolbar editor={editor} onOpenLink={openLinkInput} onOpenImage={openImageInput} />
        ) : null}
        {inlineInput ? (
          <form className="document-inline-input" onSubmit={applyInlineInput}>
            <label>
              <span>{inlineInput.kind === 'link' ? '링크 URL' : '이미지 경로 또는 URL'}</span>
              <input
                autoFocus
                value={inlineInput.value}
                onChange={event => setInlineInput({ ...inlineInput, value: event.currentTarget.value, error: '' })}
                onKeyDown={event => { if (event.key === 'Escape') setInlineInput(null); }}
              />
            </label>
            {inlineInput.error ? <span role="alert">{inlineInput.error}</span> : null}
            <button type="button" onClick={() => setInlineInput(null)}>취소</button>
            <button type="submit">적용</button>
          </form>
        ) : null}
        {safetyReason ? (
          <div className="document-readonly-banner" role="alert">
            안전한 소스 보존을 확인할 수 없어 Document 편집을 중지했습니다. Source에서 계속 편집하세요.
          </div>
        ) : null}
        <EditorContent className="document-markdown-surface" editor={editor} />
        {slashMenu && editable && !safetyReason ? (
          <div className="document-slash-menu" role="listbox" aria-label="블록 추가" style={{ left: slashMenu.left, top: slashMenu.top }}>
            {filteredCommands.length ? filteredCommands.map((command, index) => (
              <button
                className={index === selectedCommandIndex ? 'active' : ''}
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === selectedCommandIndex}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setSelectedCommandIndex(index)}
                onClick={() => runSlashCommand(command)}
              >
                <strong>{command.label}</strong>
                <span>{command.description}</span>
              </button>
            )) : <p>일치하는 블록이 없습니다.</p>}
          </div>
        ) : null}
      </section>
    );
  },
);

function selectionBlockType($from: { depth: number; parent: { type: { name: string } }; node: (depth: number) => { type: { name: string } } }) {
  const preferred = new Set(['heading', 'taskItem', 'listItem', 'blockquote', 'codeBlock', 'tableCell', 'tableHeader']);
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (preferred.has(name)) return name;
  }
  return $from.parent.type.name;
}

function sanitizeDocumentTarget(value: string, kind: 'link' | 'image') {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return '';
  if (/^(?:javascript|vbscript):/i.test(trimmed)) return '';
  if (kind === 'image' && /^data:/i.test(trimmed)) return '';
  return trimmed;
}

function convertBulletTaskShortcut(editor: Editor, event: KeyboardEvent) {
  if (event.key !== ' ' || event.isComposing || !editor.isActive('bulletList')) return false;
  const { selection } = editor.state;
  if (!selection.empty || !selection.$from.parent.isTextblock) return false;
  const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\n');
  const match = /^\[([ xX]?)\]$/.exec(before);
  if (!match) return false;
  event.preventDefault();
  const checked = match[1].toLocaleLowerCase() === 'x';
  const converted = editor.chain()
    .focus()
    .deleteRange({ from: selection.$from.start(), to: selection.from })
    .toggleTaskList()
    .run();
  if (converted && checked) editor.commands.updateAttributes('taskItem', { checked: true });
  return converted;
}
