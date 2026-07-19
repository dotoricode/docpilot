const FORMAT_CAPABILITIES = Object.freeze({
  markdown: Object.freeze({
    format: 'markdown',
    modes: Object.freeze(['source', 'document']),
    outline: true,
    formatDocument: false,
    validate: false,
  }),
  asciidoc: Object.freeze({
    format: 'asciidoc',
    modes: Object.freeze(['source', 'preview']),
    outline: true,
    formatDocument: false,
    validate: false,
  }),
  json: Object.freeze({
    format: 'json',
    modes: Object.freeze(['source', 'tree']),
    outline: false,
    formatDocument: true,
    validate: true,
  }),
  source: Object.freeze({
    format: 'source',
    modes: Object.freeze(['source']),
    outline: false,
    formatDocument: false,
    validate: false,
  }),
});

function documentFormat(filePath) {
  const normalized = String(filePath || '').toLowerCase();
  if (/\.(md|markdown|mdown|mkd)$/.test(normalized)) return 'markdown';
  if (/\.(adoc|asciidoc|asc)$/.test(normalized)) return 'asciidoc';
  if (/\.json$/.test(normalized)) return 'json';
  return 'source';
}

function documentCapabilities(filePath) {
  const capability = FORMAT_CAPABILITIES[documentFormat(filePath)];
  return {
    ...capability,
    modes: [...capability.modes],
  };
}

function stripMarkdownCodeForEligibility(source) {
  return String(source || '')
    .replace(/(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3(?=\n|$)/g, '\n')
    .replace(/`[^`\n]*`/g, '');
}

function getMarkdownDocumentEligibility(source) {
  const value = String(source || '');
  if (value.length > 50_000) return { editable: false, reason: 'document-too-large' };
  const inspectable = stripMarkdownCodeForEligibility(value);
  const unsupported = [
    ['mdx', /^\s*(?:import|export)\s/m],
    ['raw-html', /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>/],
    ['directive', /^\s*:::/m],
    ['footnote', /^\[\^[^\]]+\]:|\[\^[^\]]+\]/m],
    ['reference-definition', /^\s*\[[^\]^]+\]:\s*\S+/m],
    ['wiki-link', /\[\[[^\]]+\]\]/],
  ];
  const match = unsupported.find(([, pattern]) => pattern.test(inspectable));
  return match ? { editable: false, reason: match[0] } : { editable: true, reason: '' };
}

module.exports = {
  FORMAT_CAPABILITIES,
  documentCapabilities,
  documentFormat,
  getMarkdownDocumentEligibility,
};
