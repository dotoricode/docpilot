import type { AnyExtension } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { workspaceAssetUrl } from '../../shared/bridge-client';
import { MarkdownMermaid } from './markdown-mermaid-extension';

const lowlight = createLowlight(common);

export function createMarkdownDocumentExtensions(filePath = ''): AnyExtension[] {
  return [
    StarterKit.configure({ link: false, codeBlock: false }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    createDocumentImageExtension(filePath),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    InlineMath.configure({ katexOptions: { throwOnError: false } }),
    BlockMath.configure({ katexOptions: { displayMode: true, throwOnError: false } }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    MarkdownMermaid,
  ];
}

function createDocumentImageExtension(filePath: string) {
  return Image.extend({
    addNodeView() {
      return ({ node, HTMLAttributes }) => {
        const wrapper = document.createElement('span');
        wrapper.className = 'document-image-node';
        wrapper.contentEditable = 'false';
        const image = document.createElement('img');
        image.draggable = false;
        wrapper.appendChild(image);

        const apply = (src: string, attrs: Record<string, unknown>) => {
          image.src = resolveDocumentImageSrc(src, filePath);
          image.alt = typeof attrs.alt === 'string' ? attrs.alt : '';
          if (typeof attrs.title === 'string' && attrs.title) image.title = attrs.title;
          else image.removeAttribute('title');
        };
        apply(String(node.attrs.src || ''), HTMLAttributes);

        return {
          dom: wrapper,
          update(updatedNode) {
            if (updatedNode.type.name !== 'image') return false;
            apply(String(updatedNode.attrs.src || ''), updatedNode.attrs);
            return true;
          },
        };
      };
    },
  }).configure({ allowBase64: false });
}

export function resolveDocumentImageSrc(src: string, filePath: string) {
  if (/^(?:https?:|data:|blob:|\/\/)/i.test(src)) return src;
  const directory = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  const stack: string[] = [];
  for (const part of `${directory ? `${directory}/` : ''}${src}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return workspaceAssetUrl(stack.join('/'));
}
