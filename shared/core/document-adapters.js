const FORMAT_CAPABILITIES = Object.freeze({
  markdown: Object.freeze({
    format: 'markdown',
    modes: Object.freeze(['source', 'rich', 'preview']),
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

function markdownRichSafety(source) {
  const value = String(source || '');
  if (value.length > 300_000) return { safe: false, reason: 'document-too-large' };
  const unsupported = [
    /^\s*(?:import|export)\s/m,
    /<\/?[A-Za-z][^>]*>/,
    /^\s*:::/m,
    /^\[\^[^\]]+\]:/m,
    /\[\[[^\]]+\]\]/,
    /\$\$[\s\S]*?\$\$/,
  ];
  if (unsupported.some(pattern => pattern.test(value))) return { safe: false, reason: 'unsupported-syntax' };
  return { safe: true, reason: '' };
}

module.exports = {
  FORMAT_CAPABILITIES,
  documentCapabilities,
  documentFormat,
  markdownRichSafety,
};
