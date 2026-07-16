export const DOC_ROUTES = Object.freeze([
  { slug: 'overview', path: '/docs', title: 'DocPilot 소개', group: '시작하기' },
  { slug: 'install', path: '/docs/install', title: '설치', group: '시작하기' },
  { slug: 'first-workspace', path: '/docs/first-workspace', title: '첫 작업공간', group: '시작하기' },
  { slug: 'workspace/additional-folders', path: '/docs/workspace/additional-folders', title: '추가 폴더', group: '작업공간' },
  { slug: 'workspace/file-explorer', path: '/docs/workspace/file-explorer', title: '파일 탐색기', group: '작업공간' },
  { slug: 'workspace/recent', path: '/docs/workspace/recent', title: '최근 위치', group: '작업공간' },
  { slug: 'workspace/tabs-panes-splits', path: '/docs/workspace/tabs-panes-splits', title: '탭과 문서 분할', group: '작업공간' },
  { slug: 'workspace/pane-layout', path: '/docs/workspace/pane-layout', title: 'Pane 배치', group: '작업공간' },
  { slug: 'find/quick-open', path: '/docs/find/quick-open', title: '빠른 열기', group: '찾기' },
  { slug: 'find/project-search', path: '/docs/find/project-search', title: '프로젝트 검색', group: '찾기' },
  { slug: 'editing/source', path: '/docs/editing/source', title: 'Source 편집', group: '문서 편집' },
  { slug: 'editing/markdown', path: '/docs/editing/markdown', title: 'Markdown', group: '문서 편집' },
  { slug: 'editing/asciidoc', path: '/docs/editing/asciidoc', title: 'AsciiDoc', group: '문서 편집' },
  { slug: 'editing/json', path: '/docs/editing/json', title: 'JSON', group: '문서 편집' },
  { slug: 'editing/preview', path: '/docs/editing/preview', title: 'Preview와 목차', group: '문서 편집' },
  { slug: 'review/diff', path: '/docs/review/diff', title: 'Diff 검토', group: '검토와 전달' },
  { slug: 'review/context-copy', path: '/docs/review/context-copy', title: '문맥 선택과 복사', group: '검토와 전달' },
  { slug: 'terminal/overview', path: '/docs/terminal/overview', title: '터미널', group: '터미널' },
  { slug: 'terminal/layout', path: '/docs/terminal/layout', title: '터미널 배치', group: '터미널' },
  { slug: 'settings/appearance', path: '/docs/settings/appearance', title: '테마', group: '설정' },
  { slug: 'settings/reference', path: '/docs/settings/reference', title: '설정 참고', group: '설정' },
  { slug: 'install/updates', path: '/docs/install/updates', title: '업데이트', group: '설정' },
  { slug: 'reference/shortcuts', path: '/docs/reference/shortcuts', title: '키보드 단축키', group: '참고' },
  { slug: 'troubleshooting', path: '/docs/troubleshooting', title: '문제 해결', group: '참고' },
]);

export function normalizeBase(base = '/') {
  const normalized = `/${String(base).replace(/^\/+|\/+$/g, '')}/`.replace(/\/+/g, '/');
  return normalized === '//' ? '/' : normalized;
}

export function stripBase(pathname, base = '/') {
  const normalizedBase = normalizeBase(base);
  const path = `/${String(pathname || '').replace(/^\/+/, '')}`.replace(/\/+/g, '/');
  if (normalizedBase === '/') return path;
  const prefix = normalizedBase.replace(/\/$/, '');
  return path === prefix ? '/' : path.startsWith(`${prefix}/`) ? path.slice(prefix.length) || '/' : path;
}

export function matchRoute(pathname, base = '/') {
  const path = stripBase(pathname, base).replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/docs') return { kind: 'docs', slug: 'overview' };
  const doc = DOC_ROUTES.find(route => route.path === path);
  if (doc) return { kind: 'docs', slug: doc.slug };
  if (path === '/changelog') return { kind: 'changelog' };
  const release = path.match(/^\/changelog\/v?([^/]+)$/);
  if (release) return { kind: 'release', version: decodeURIComponent(release[1]) };
  return { kind: 'not-found' };
}

export function canonicalPath(route) {
  if (route.kind === 'docs') return DOC_ROUTES.find(item => item.slug === route.slug)?.path || '/docs';
  if (route.kind === 'release') return `/changelog/${encodeURIComponent(route.version)}`;
  if (route.kind === 'changelog') return '/changelog';
  return '/docs';
}

export function routePaths(releaseVersions = []) {
  const releasePaths = releaseVersions
    .map(version => String(version || '').replace(/^v/i, '').trim())
    .filter(Boolean)
    .map(version => `/changelog/${encodeURIComponent(version)}`);
  return [...new Set([...DOC_ROUTES.map(route => route.path), '/changelog', ...releasePaths])];
}
