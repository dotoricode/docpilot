import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  anchorTop: number;
  anchorBottom: number;
  maxHeight: number;
  placement: 'up' | 'down';
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
    const slashMenuElementRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const originalSourceRef = useRef(source);
    const baseCanonicalRef = useRef('');
    const lastCommittedRef = useRef(source);
    const readyRef = useRef(false);
    const safetyLockedRef = useRef(false);
    const pendingCommitTimerRef = useRef<number | null>(null);
    const compositionStartTextRef = useRef<string | null>(null);
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

    useLayoutEffect(() => {
      const root = rootRef.current;
      const menu = slashMenuElementRef.current;
      const shell = root?.closest<HTMLElement>('.document-editor-shell');
      if (!root || !menu || !shell || !slashMenu) return;
      const rootRect = root.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const toolbarRect = root.querySelector<HTMLElement>('.document-toolbar')?.getBoundingClientRect();
      const topBoundary = Math.max(shellRect.top, toolbarRect?.bottom || shellRect.top) + 8;
      const bottomBoundary = shellRect.bottom - 8;
      const anchorTop = rootRect.top + slashMenu.anchorTop;
      const anchorBottom = rootRect.top + slashMenu.anchorBottom;
      const naturalHeight = Math.min(320, menu.scrollHeight);
      const spaceAbove = Math.max(0, anchorTop - topBoundary - 8);
      const spaceBelow = Math.max(0, bottomBoundary - anchorBottom - 8);
      const placement = naturalHeight > spaceBelow && spaceAbove > spaceBelow ? 'up' : 'down';
      const availableHeight = Math.max(48, placement === 'up' ? spaceAbove : spaceBelow);
      const maxHeight = Math.min(320, availableHeight);
      const menuHeight = Math.min(naturalHeight, maxHeight);
      const desiredTop = placement === 'up'
        ? anchorTop - menuHeight - 8
        : anchorBottom + 8;
      const clampedTop = Math.min(
        Math.max(desiredTop, topBoundary),
        Math.max(topBoundary, bottomBoundary - menuHeight),
      );
      const menuWidth = Math.min(menu.offsetWidth, Math.max(0, shellRect.width - 16));
      const desiredLeft = rootRect.left + slashMenu.left;
      const clampedLeft = Math.min(
        Math.max(desiredLeft, shellRect.left + 8),
        Math.max(shellRect.left + 8, shellRect.right - menuWidth - 8),
      );
      const nextTop = clampedTop - rootRect.top;
      const nextLeft = clampedLeft - rootRect.left;
      setSlashMenu(current => current
        && current.top === nextTop
        && current.left === nextLeft
        && current.maxHeight === maxHeight
        && current.placement === placement
        ? current
        : current ? { ...current, top: nextTop, left: nextLeft, maxHeight, placement } : current);
    }, [filteredCommands.length, slashMenu]);

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
        handleDOMEvents: {
          compositionstart: () => {
            const currentEditor = editorRef.current;
            const selection = currentEditor?.state.selection;
            compositionStartTextRef.current = selection?.empty && selection.$from.parent.type.name === 'paragraph'
              ? selection.$from.parent.textContent
              : null;
            return false;
          },
          compositionend: () => {
            // TipTap's built-in input rules only see the final composed line.
            // Korean IME can commit `- 한글` in one transaction, so promote the
            // leading Markdown marker after composition without dropping text.
            const compositionStartText = compositionStartTextRef.current;
            compositionStartTextRef.current = null;
            window.setTimeout(() => {
              const currentEditor = editorRef.current;
              if (currentEditor) promoteComposedMarkdownShortcut(currentEditor, compositionStartText);
            });
            return false;
          },
        },
        handleKeyDown: (_view, event) => {
          const currentEditor = editorRef.current;
          if (currentEditor && convertBulletTaskShortcut(currentEditor, event)) return true;
          if (currentEditor && convertPipeTableShortcut(currentEditor, event)) return true;
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
          if (event.key === 'Tab') {
            event.preventDefault();
            if (!currentEditor) return true;
            if (event.shiftKey) {
              if (!currentEditor.commands.liftListItem('listItem')) currentEditor.commands.liftListItem('taskItem');
              return true;
            }
            if (currentEditor.isActive('codeBlock')) {
              currentEditor.commands.insertContent('  ');
              return true;
            }
            if (!currentEditor.commands.sinkListItem('listItem')) currentEditor.commands.sinkListItem('taskItem');
            return true;
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
        anchorTop: coords.top - (rootRect?.top || 0),
        anchorBottom: coords.bottom - (rootRect?.top || 0),
        maxHeight: 320,
        placement: 'down' as const,
      };
      setSlashMenu(current => current
        && current.from === next.from
        && current.to === next.to
        && current.query === next.query
        && current.left === next.left
        && current.top === next.top
        && current.anchorTop === next.anchorTop
        && current.anchorBottom === next.anchorBottom
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
          <div
            ref={slashMenuElementRef}
            className="document-slash-menu"
            role="listbox"
            aria-label="블록 추가"
            data-placement={slashMenu.placement}
            style={{ left: slashMenu.left, top: slashMenu.top, maxHeight: slashMenu.maxHeight }}
          >
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

function convertPipeTableShortcut(editor: Editor, event: KeyboardEvent) {
  if (event.key !== ' ' || event.isComposing || editor.isActive('table')) return false;
  const { selection } = editor.state;
  if (!selection.empty || selection.$from.parent.type.name !== 'paragraph') return false;
  const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\n');
  if (before !== '|') return false;
  event.preventDefault();
  return editor.chain()
    .focus()
    .deleteRange({ from: selection.$from.start(), to: selection.from })
    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    .run();
}

type ComposedMarkdownShortcut = {
  body: string;
  checked?: boolean;
  kind: 'blockquote' | 'bullet' | 'heading' | 'ordered' | 'table' | 'task';
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  markerLength: number;
  start?: number;
};

function promoteComposedMarkdownShortcut(editor: Editor, compositionStartText: string | null) {
  if (editor.view.composing) return false;
  const { selection } = editor.state;
  if (!selection.empty || selection.$from.parent.type.name !== 'paragraph') return false;
  const text = selection.$from.parent.textContent;
  const shortcut = composedMarkdownShortcut(text);
  if (!shortcut) return false;
  const marker = text.slice(0, shortcut.markerLength);
  if (compositionStartText !== '' && compositionStartText !== marker && compositionStartText !== marker.trimEnd()) return false;
  const paragraphStart = selection.$from.start();
  if (shortcut.kind === 'table') {
    return editor.chain()
      .focus()
      .deleteRange({ from: paragraphStart, to: paragraphStart + text.length })
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .insertContent(shortcut.body)
      .run();
  }

  const chain = editor.chain()
    .focus()
    .deleteRange({ from: paragraphStart, to: paragraphStart + shortcut.markerLength });
  if (shortcut.kind === 'bullet') return chain.toggleBulletList().run();
  if (shortcut.kind === 'blockquote') return chain.toggleBlockquote().run();
  if (shortcut.kind === 'heading') return chain.setHeading({ level: shortcut.level || 1 }).run();
  if (shortcut.kind === 'task') {
    const converted = chain.toggleTaskList().run();
    if (converted && shortcut.checked) editor.commands.updateAttributes('taskItem', { checked: true });
    return converted;
  }
  const converted = chain.toggleOrderedList().run();
  if (converted && shortcut.start && shortcut.start !== 1) {
    editor.commands.updateAttributes('orderedList', { start: shortcut.start });
  }
  return converted;
}

function composedMarkdownShortcut(text: string): ComposedMarkdownShortcut | null {
  const task = /^- \[([ xX])\] (.*)$/s.exec(text);
  if (task) return { body: task[2], checked: task[1].toLocaleLowerCase() === 'x', kind: 'task', markerLength: task[0].length - task[2].length };
  const heading = /^(#{1,6}) (.*)$/s.exec(text);
  if (heading) return { body: heading[2], kind: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, markerLength: heading[1].length + 1 };
  const ordered = /^(\d+)\. (.*)$/s.exec(text);
  if (ordered) return { body: ordered[2], kind: 'ordered', markerLength: ordered[1].length + 2, start: Number(ordered[1]) };
  const bullet = /^[-+*] (.*)$/s.exec(text);
  if (bullet) return { body: bullet[1], kind: 'bullet', markerLength: 2 };
  const quote = /^> (.*)$/s.exec(text);
  if (quote) return { body: quote[1], kind: 'blockquote', markerLength: 2 };
  const table = /^\| (.*)$/s.exec(text);
  if (table) return { body: table[1], kind: 'table', markerLength: 2 };
  return null;
}
