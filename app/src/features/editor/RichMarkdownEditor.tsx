import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';

type RichMarkdownEditorProps = {
  source: string;
  onChange: (source: string) => void;
};

export function RichMarkdownEditor({ source, onChange }: RichMarkdownEditorProps) {
  const sourceRef = useRef(source);
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: source,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'rich-markdown-content',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const markdown = currentEditor.getMarkdown();
      sourceRef.current = markdown;
      onChange(markdown);
    },
  });

  useEffect(() => {
    if (!editor || source === sourceRef.current) return;
    sourceRef.current = source;
    editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false });
  }, [editor, source]);

  return <EditorContent className="rich-markdown-editor" editor={editor} />;
}
