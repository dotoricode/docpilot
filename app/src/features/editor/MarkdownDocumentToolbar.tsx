import { useEffect, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';

type MarkdownDocumentToolbarProps = {
  editor: Editor | null;
  onOpenLink: () => void;
  onOpenImage: () => void;
};

export function MarkdownDocumentToolbar({ editor, onOpenLink, onOpenImage }: MarkdownDocumentToolbarProps) {
  useEditorRefresh(editor);
  if (!editor) return <div className="document-toolbar" aria-hidden="true" />;
  const run = (command: () => boolean) => () => { command(); editor.commands.focus(); };
  return (
    <>
      <div className="document-toolbar" role="toolbar" aria-label="Document 서식">
        <Tool label="본문" active={editor.isActive('paragraph')} onClick={run(() => editor.chain().focus().setParagraph().run())}>¶</Tool>
        <Tool label="제목 1" active={editor.isActive('heading', { level: 1 })} onClick={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>H1</Tool>
        <Tool label="제목 2" active={editor.isActive('heading', { level: 2 })} onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>H2</Tool>
        <Tool label="제목 3" active={editor.isActive('heading', { level: 3 })} onClick={run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}>H3</Tool>
        <Separator />
        <Tool label="굵게" active={editor.isActive('bold')} onClick={run(() => editor.chain().focus().toggleBold().run())}><strong>B</strong></Tool>
        <Tool label="기울임" active={editor.isActive('italic')} onClick={run(() => editor.chain().focus().toggleItalic().run())}><em>I</em></Tool>
        <Tool label="취소선" active={editor.isActive('strike')} onClick={run(() => editor.chain().focus().toggleStrike().run())}><s>S</s></Tool>
        <Tool label="인라인 코드" active={editor.isActive('code')} onClick={run(() => editor.chain().focus().toggleCode().run())}>{'<>'}</Tool>
        <Separator />
        <Tool label="글머리 목록" active={editor.isActive('bulletList')} onClick={run(() => editor.chain().focus().toggleBulletList().run())}>•</Tool>
        <Tool label="번호 목록" active={editor.isActive('orderedList')} onClick={run(() => editor.chain().focus().toggleOrderedList().run())}>1.</Tool>
        <Tool label="체크리스트" active={editor.isActive('taskList')} onClick={run(() => editor.chain().focus().toggleTaskList().run())}>☑</Tool>
        <Tool label="인용" active={editor.isActive('blockquote')} onClick={run(() => editor.chain().focus().toggleBlockquote().run())}>❞</Tool>
        <Separator />
        <Tool label="링크" active={editor.isActive('link')} onClick={onOpenLink}>⌁</Tool>
        <Tool label="이미지" active={false} onClick={onOpenImage}>▧</Tool>
        <Tool label="표 삽입" active={editor.isActive('table')} onClick={run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>▦</Tool>
        <details className="document-toolbar-more">
          <summary aria-label="더 많은 블록">•••</summary>
          <div>
            {[4, 5, 6].map(level => (
              <button key={level} type="button" onClick={run(() => editor.chain().focus().toggleHeading({ level: level as 4 | 5 | 6 }).run())}>제목 {level}</button>
            ))}
            <button type="button" onClick={run(() => editor.chain().focus().toggleCodeBlock().run())}>코드 블록</button>
            <button type="button" onClick={run(() => editor.chain().focus().setHorizontalRule().run())}>구분선</button>
            <button type="button" onClick={() => editor.commands.insertInlineMath({ latex: 'x' })}>인라인 수식</button>
            <button type="button" onClick={() => editor.commands.insertBlockMath({ latex: 'x' })}>수식 블록</button>
          </div>
        </details>
      </div>
      {editor.isActive('table') ? <TableToolbar editor={editor} /> : null}
    </>
  );
}

function TableToolbar({ editor }: { editor: Editor }) {
  const run = (command: () => boolean) => () => { command(); editor.commands.focus(); };
  return (
    <div className="document-table-toolbar" role="toolbar" aria-label="표 편집">
      <button type="button" aria-label="열 추가" onClick={run(() => editor.chain().focus().addColumnAfter().run())}>열 +</button>
      <button type="button" aria-label="열 삭제" onClick={run(() => editor.chain().focus().deleteColumn().run())}>열 −</button>
      <button type="button" aria-label="행 추가" onClick={run(() => editor.chain().focus().addRowAfter().run())}>행 +</button>
      <button type="button" aria-label="행 삭제" onClick={run(() => editor.chain().focus().deleteRow().run())}>행 −</button>
      <button type="button" aria-label="표 삭제" onClick={run(() => editor.chain().focus().deleteTable().run())}>표 삭제</button>
    </div>
  );
}

function Tool({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={active ? 'active' : ''} type="button" aria-label={label} aria-pressed={active} onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</button>;
}

function Separator() {
  return <span aria-hidden="true" />;
}

function useEditorRefresh(editor: Editor | null) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => setVersion(value => value + 1);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);
}
