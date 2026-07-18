import DOMPurify, { type Config } from 'dompurify';

const RENDERED_DOCUMENT_SANITIZER_CONFIG: Config = {
  USE_PROFILES: { html: true },
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: [
    'base',
    'button',
    'embed',
    'form',
    'iframe',
    'input',
    'link',
    'meta',
    'object',
    'option',
    'script',
    'select',
    'style',
    'textarea',
  ],
  // Inline CSS can create fixed, full-window overlays even when scripts are
  // removed. Preview styling belongs to DocPilot's own stylesheet.
  FORBID_ATTR: ['srcdoc', 'style'],
  RETURN_TRUSTED_TYPE: false,
};

/**
 * Asciidoctor's secure mode restricts file and include access, but it is not
 * an HTML sanitizer. Keep document-oriented HTML while removing executable
 * markup before it reaches React's dangerouslySetInnerHTML boundary.
 */
export function sanitizeRenderedDocumentHtml(html: string) {
  return DOMPurify.sanitize(String(html || ''), RENDERED_DOCUMENT_SANITIZER_CONFIG);
}
