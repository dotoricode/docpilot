import { useEffect, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image as ImageIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  MoreHorizontal,
  Pilcrow,
  Quote,
  Sigma,
  Table2,
} from 'lucide-react';

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
        <Tool label="본문" active={editor.isActive('paragraph')} onClick={run(() => editor.chain().focus().setParagraph().run())}><Pilcrow /></Tool>
        <Tool label="제목 1" active={editor.isActive('heading', { level: 1 })} onClick={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}><Heading1 /></Tool>
        <Tool label="제목 2" active={editor.isActive('heading', { level: 2 })} onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}><Heading2 /></Tool>
        <Tool label="제목 3" active={editor.isActive('heading', { level: 3 })} onClick={run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}><Heading3 /></Tool>
        <Separator />
        <Tool label="굵게" active={editor.isActive('bold')} onClick={run(() => editor.chain().focus().toggleBold().run())}><strong>B</strong></Tool>
        <Tool label="기울임" active={editor.isActive('italic')} onClick={run(() => editor.chain().focus().toggleItalic().run())}><em>I</em></Tool>
        <Tool label="취소선" active={editor.isActive('strike')} onClick={run(() => editor.chain().focus().toggleStrike().run())}><s>S</s></Tool>
        <Separator />
        <Tool label="글머리 목록" active={editor.isActive('bulletList')} onClick={run(() => editor.chain().focus().toggleBulletList().run())}><List /></Tool>
        <Tool label="번호 목록" active={editor.isActive('orderedList')} onClick={run(() => editor.chain().focus().toggleOrderedList().run())}><ListOrdered /></Tool>
        <Tool label="체크리스트" active={editor.isActive('taskList')} onClick={run(() => editor.chain().focus().toggleTaskList().run())}><ListTodo /></Tool>
        <Separator />
        <Tool label="인용" active={editor.isActive('blockquote')} onClick={run(() => editor.chain().focus().toggleBlockquote().run())}><Quote /></Tool>
        <Tool label="링크" active={editor.isActive('link')} onClick={onOpenLink}><LinkIcon /></Tool>
        <Tool label="이미지" active={false} onClick={onOpenImage}><ImageIcon /></Tool>
        <details className="document-toolbar-more">
          <summary aria-label="더 많은 블록"><MoreHorizontal /></summary>
          <div>
            <MoreTool icon={<Heading4 />} label="제목 4" onClick={run(() => editor.chain().focus().toggleHeading({ level: 4 }).run())} />
            <MoreTool icon={<Heading5 />} label="제목 5" onClick={run(() => editor.chain().focus().toggleHeading({ level: 5 }).run())} />
            <MoreTool icon={<Heading6 />} label="제목 6" onClick={run(() => editor.chain().focus().toggleHeading({ level: 6 }).run())} />
            <MoreTool icon={<Code2 />} label="코드 블록" onClick={run(() => editor.chain().focus().toggleCodeBlock().run())} />
            <MoreTool icon={<Minus />} label="구분선" onClick={run(() => editor.chain().focus().setHorizontalRule().run())} />
            <MoreTool icon={<Table2 />} label="표 삽입" onClick={run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())} />
            <MoreTool icon={<Sigma />} label="인라인 수식" onClick={() => editor.commands.insertInlineMath({ latex: 'x' })} />
            <MoreTool icon={<Sigma />} label="수식 블록" onClick={() => editor.commands.insertBlockMath({ latex: 'x' })} />
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

function MoreTool({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onMouseDown={event => event.preventDefault()} onClick={onClick}>{icon}<span>{label}</span></button>;
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
