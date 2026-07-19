import { locateMarkdownDocumentSelection as locateSelection } from '../../../../shared/core/markdown-document-selection';

export type MarkdownDocumentSelection = {
  fileId: string;
  text: string;
  from: number;
  to: number;
  lineStart: number;
  lineEnd: number;
  blockType: string;
  editorFrom: number;
  editorTo: number;
};

type SelectionInput = {
  fileId: string;
  source: string;
  text: string;
  blockType: string;
  editorFrom: number;
  editorTo: number;
  documentSize: number;
};

export function locateMarkdownDocumentSelection(input: SelectionInput): MarkdownDocumentSelection | null {
  return locateSelection(input) as MarkdownDocumentSelection | null;
}
