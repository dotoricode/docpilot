import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createMermaidDiagramElement } from './mermaid-renderer';

export const MarkdownMermaid = Extension.create({
  name: 'markdownMermaid',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('docpilot-markdown-mermaid'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (node.type.name !== 'codeBlock' || String(node.attrs.language || '').toLowerCase() !== 'mermaid') return;
              const source = node.textContent;
              decorations.push(Decoration.node(position, position + node.nodeSize, {
                class: 'document-mermaid-source',
                contenteditable: 'false',
                'data-mermaid-protected': 'true',
              }));
              decorations.push(Decoration.widget(
                position + node.nodeSize,
                () => createMermaidDiagramElement(source, 'document-mermaid-diagram'),
                { key: `mermaid-${position}-${stableSourceKey(source)}`, side: 1 },
              ));
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

function stableSourceKey(source: string) {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  return `${source.length}-${hash}`;
}
