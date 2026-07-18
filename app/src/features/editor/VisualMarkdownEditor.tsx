import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { reconcileSerializedMarkdown } from '../../../../shared/core/markdown-source-reconcile';

type VisualMarkdownEditorProps = {
  source: string;
  editable: boolean;
  onChange: (source: string) => void;
  onSafetyFailure?: (reason: string) => void;
  onPendingChange?: (pending: boolean) => void;
};

export type VisualMarkdownEditorHandle = {
  flush: () => string | null;
};

function createVisualMarkdownExtensions() {
  return [
    StarterKit,
    Markdown,
    Image.configure({ allowBase64: false }),
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}

function roundTripMarkdown(markdown: string) {
  let detached: Editor | null = null;
  try {
    detached = new Editor({
      element: null,
      extensions: createVisualMarkdownExtensions(),
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

export const VisualMarkdownEditor = forwardRef<VisualMarkdownEditorHandle, VisualMarkdownEditorProps>(
  function VisualMarkdownEditor({ source, editable, onChange, onSafetyFailure, onPendingChange }, forwardedRef) {
    const originalSourceRef = useRef(source);
    const baseCanonicalRef = useRef('');
    const lastCommittedRef = useRef(source);
    const readyRef = useRef(false);
    const safetyLockedRef = useRef(false);
    const pendingCommitTimerRef = useRef<number | null>(null);
    const [safetyReason, setSafetyReason] = useState('');
    const onChangeRef = useRef(onChange);
    const onSafetyFailureRef = useRef(onSafetyFailure);
    const onPendingChangeRef = useRef(onPendingChange);
    onChangeRef.current = onChange;
    onSafetyFailureRef.current = onSafetyFailure;
    onPendingChangeRef.current = onPendingChange;

    function commitEditor(currentEditor: Editor, publish: boolean) {
      if (safetyLockedRef.current || !readyRef.current) return lastCommittedRef.current;
      let edited = '';
      try {
        edited = currentEditor.getMarkdown();
      } catch {
        return null;
      }
      const result = reconcileSerializedMarkdown({
        originalSource: originalSourceRef.current,
        baseCanonical: baseCanonicalRef.current,
        edited,
        roundTrip: roundTripMarkdown,
      });
      if (!result.ok) {
        safetyLockedRef.current = true;
        currentEditor.setEditable(false);
        setSafetyReason(result.reason);
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
      extensions: createVisualMarkdownExtensions(),
      content: source,
      contentType: 'markdown',
      editable,
      editorProps: {
        attributes: {
          class: 'visual-markdown-content markdown-preview',
          spellcheck: 'true',
          'aria-label': 'Markdown Visual editor',
        },
      },
      onCreate: ({ editor: currentEditor }) => {
        baseCanonicalRef.current = currentEditor.getMarkdown();
        readyRef.current = true;
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (safetyLockedRef.current || !readyRef.current) return;
        onPendingChangeRef.current?.(true);
        if (pendingCommitTimerRef.current !== null) window.clearTimeout(pendingCommitTimerRef.current);
        pendingCommitTimerRef.current = window.setTimeout(() => {
          pendingCommitTimerRef.current = null;
          commitEditor(currentEditor, true);
        }, 240);
      },
    });

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
        baseCanonicalRef.current = editor.getMarkdown();
        lastCommittedRef.current = source;
        safetyLockedRef.current = false;
        readyRef.current = true;
        setSafetyReason('');
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
    }, [editable, editor]);

    useEffect(() => () => {
      if (pendingCommitTimerRef.current !== null) window.clearTimeout(pendingCommitTimerRef.current);
    }, []);

    return (
      <section className="visual-markdown-editor" data-editable={editable && !safetyReason ? 'true' : 'false'} data-safety-reason={safetyReason}>
        {editable && !safetyReason ? <VisualToolbar editor={editor} /> : null}
        {safetyReason ? (
          <div className="visual-readonly-banner" role="alert">
            안전한 소스 보존을 확인할 수 없어 Visual 편집을 중지했습니다. Source에서 계속 편집하세요.
          </div>
        ) : null}
        <EditorContent className="visual-markdown-document" editor={editor} />
      </section>
    );
  },
);

function VisualToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="visual-toolbar" aria-hidden="true" />;
  const run = (command: () => boolean) => () => { command(); editor.commands.focus(); };
  return (
    <div className="visual-toolbar" role="toolbar" aria-label="Visual formatting">
      <button type="button" aria-label="본문" onClick={run(() => editor.chain().focus().setParagraph().run())}>¶</button>
      <button type="button" aria-label="제목 1" onClick={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>H1</button>
      <button type="button" aria-label="제목 2" onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>H2</button>
      <button type="button" aria-label="제목 3" onClick={run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}>H3</button>
      <span aria-hidden="true" />
      <button type="button" aria-label="굵게" onClick={run(() => editor.chain().focus().toggleBold().run())}>B</button>
      <button type="button" aria-label="기울임" onClick={run(() => editor.chain().focus().toggleItalic().run())}>I</button>
      <button type="button" aria-label="취소선" onClick={run(() => editor.chain().focus().toggleStrike().run())}>S</button>
      <span aria-hidden="true" />
      <button type="button" aria-label="글머리 목록" onClick={run(() => editor.chain().focus().toggleBulletList().run())}>•</button>
      <button type="button" aria-label="번호 목록" onClick={run(() => editor.chain().focus().toggleOrderedList().run())}>1.</button>
      <button type="button" aria-label="체크 목록" onClick={run(() => editor.chain().focus().toggleTaskList().run())}>☑</button>
      <button type="button" aria-label="인용" onClick={run(() => editor.chain().focus().toggleBlockquote().run())}>❞</button>
      <button type="button" aria-label="코드 블록" onClick={run(() => editor.chain().focus().toggleCodeBlock().run())}>{'</>'}</button>
      <button type="button" aria-label="표 삽입" onClick={run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>▦</button>
    </div>
  );
}
