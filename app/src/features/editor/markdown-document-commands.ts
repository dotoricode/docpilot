import type { Editor } from '@tiptap/core';

export type MarkdownDocumentCommandGroup = '기본 블록' | '고급' | '미디어';

export type MarkdownDocumentCommand = {
  id: string;
  label: string;
  description: string;
  aliases: string[];
  group: MarkdownDocumentCommandGroup;
  run: (editor: Editor, actions: { openImageInput: () => void }) => void;
};

export const markdownDocumentCommands: MarkdownDocumentCommand[] = [
  heading(1), heading(2), heading(3), heading(4), heading(5), heading(6),
  command('paragraph', '본문', '일반 문단으로 전환합니다.', ['text', 'body'], '기본 블록', editor => editor.chain().focus().setParagraph().run()),
  command('bullet-list', '글머리 목록', '글머리 기호 목록을 만듭니다.', ['bullet', 'ul', 'list'], '기본 블록', editor => editor.chain().focus().toggleBulletList().run()),
  command('ordered-list', '번호 목록', '번호 목록을 만듭니다.', ['ordered', 'ol', 'number'], '기본 블록', editor => editor.chain().focus().toggleOrderedList().run()),
  command('task-list', '체크리스트', '체크 가능한 작업 목록을 만듭니다.', ['task', 'todo', 'checkbox'], '기본 블록', editor => editor.chain().focus().toggleTaskList().run()),
  command('blockquote', '인용', '인용 블록을 만듭니다.', ['quote'], '기본 블록', editor => editor.chain().focus().toggleBlockquote().run()),
  command('code-block', '코드 블록', '코드 블록을 만듭니다.', ['code', 'fence'], '기본 블록', editor => editor.chain().focus().toggleCodeBlock().run()),
  command('divider', '구분선', '가로 구분선을 추가합니다.', ['rule', 'hr'], '기본 블록', editor => editor.chain().focus().setHorizontalRule().run()),
  command('table', '표', '3×3 Markdown 표를 추가합니다.', ['grid', 'rows', 'columns'], '고급', editor => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
  command('mermaid', 'Mermaid 다이어그램', 'Mermaid 코드 블록을 추가합니다.', ['diagram', 'flowchart'], '고급', editor => {
    editor.chain().focus().setCodeBlock({ language: 'mermaid' }).insertContent('graph TD\n  A[Start] --> B[End]').run();
  }),
  command('inline-math', '인라인 수식', '인라인 LaTeX 수식을 추가합니다.', ['math', 'latex', 'formula'], '고급', editor => {
    editor.commands.insertInlineMath({ latex: 'x' });
  }),
  command('math-block', '수식 블록', '블록 LaTeX 수식을 추가합니다.', ['equation', 'latex block'], '고급', editor => {
    editor.commands.insertBlockMath({ latex: 'x' });
  }),
  command('image', '이미지', '경로나 URL로 이미지를 추가합니다.', ['img', 'picture'], '미디어', (_editor, actions) => actions.openImageInput()),
  command('emoji', '이모지', '유니코드 이모지를 추가합니다.', ['smile', 'reaction'], '미디어', editor => editor.chain().focus().insertContent('🙂').run()),
];

export function filterMarkdownDocumentCommands(query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return markdownDocumentCommands;
  return markdownDocumentCommands.filter(item => [item.label, item.id, ...item.aliases]
    .some(value => value.toLocaleLowerCase().includes(normalized)));
}

function heading(level: 1 | 2 | 3 | 4 | 5 | 6): MarkdownDocumentCommand {
  return command(
    `heading-${level}`,
    `제목 ${level}`,
    `${level}단계 제목으로 전환합니다.`,
    [`h${level}`, 'heading'],
    '기본 블록',
    editor => editor.chain().focus().toggleHeading({ level }).run(),
  );
}

function command(
  id: string,
  label: string,
  description: string,
  aliases: string[],
  group: MarkdownDocumentCommandGroup,
  run: MarkdownDocumentCommand['run'],
): MarkdownDocumentCommand {
  return { id, label, description, aliases, group, run };
}
