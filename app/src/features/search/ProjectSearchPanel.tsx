import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, CaretRight, ListMagnifyingGlass, MagnifyingGlass, X } from '@phosphor-icons/react';
import { readWorkspaceFile } from '../../shared/bridge-client';

type SearchMode = 'name' | 'content';

type SearchResult = {
  fileId: string;
  line?: number;
  excerpt: string;
};

type ProjectSearchPanelProps = {
  files: string[];
  onClose: () => void;
  onOpenFile: (fileId: string) => void;
};

export function ProjectSearchPanel({ files, onClose, onOpenFile }: ProjectSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('content');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const filteredFiles = useMemo(
    () => files.filter(file => matchesFileFilters(file, include, exclude)),
    [exclude, files, include],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const request = ++requestRef.current;
    const needle = query.trim();
    if (!needle) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      if (mode === 'name') {
        setResults(searchNames(filteredFiles, needle, caseSensitive));
        setLoading(false);
        return;
      }
      setLoading(true);
      void searchContents(filteredFiles, needle, { caseSensitive, wholeWord, regex })
        .then(next => {
          if (request === requestRef.current) setResults(next);
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [caseSensitive, filteredFiles, mode, query, regex, wholeWord]);

  return (
    <aside className="workspace-sidebar project-search-panel" aria-label="프로젝트 검색">
      <header className="project-search-header">
        <strong>Search</strong>
        <div>
          <button type="button" aria-label="검색 새로고침" title="검색 새로고침" onClick={() => inputRef.current?.focus()}>
            <ArrowClockwise size={16} />
          </button>
          <button type="button" aria-label="검색 닫기" title="검색 닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="project-search-query">
        <MagnifyingGlass size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          className="project-search-input"
          type="search"
          value={query}
          placeholder="검색"
          onChange={event => setQuery(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') onClose();
          }}
        />
        <button className={caseSensitive ? 'active' : ''} type="button" aria-pressed={caseSensitive} title="대/소문자 구분" onClick={() => setCaseSensitive(value => !value)}>Aa</button>
        <button className={wholeWord ? 'active' : ''} type="button" aria-pressed={wholeWord} title="단어 단위" onClick={() => setWholeWord(value => !value)}>ab</button>
        <button className={regex ? 'active' : ''} type="button" aria-pressed={regex} title="정규식" onClick={() => setRegex(value => !value)}>.*</button>
      </div>
      <div className="project-search-mode" role="tablist" aria-label="검색 대상">
        <button className={mode === 'name' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'name'} onClick={() => setMode('name')}>이름</button>
        <button className={mode === 'content' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'content'} onClick={() => setMode('content')}>내용</button>
      </div>
      <label className="project-search-filter">
        <span>포함할 파일</span>
        <input value={include} placeholder="포함할 파일(예: *.ts, src/**)" onChange={event => setInclude(event.currentTarget.value)} />
      </label>
      <label className="project-search-filter">
        <span>제외할 파일</span>
        <input value={exclude} placeholder="제외할 파일(예: *.min.js, dist/**)" onChange={event => setExclude(event.currentTarget.value)} />
      </label>
      <div className="project-search-results" aria-live="polite">
        {loading ? (
          <div className="project-search-empty"><ListMagnifyingGlass size={20} />검색 중…</div>
        ) : results.length ? results.map((result, index) => (
          <button
            className="project-search-result"
            key={`${result.fileId}:${result.line || 0}:${index}`}
            type="button"
            onClick={() => onOpenFile(result.fileId)}
          >
            <CaretRight size={13} weight="bold" aria-hidden="true" />
            <span>
              <strong>{result.fileId}</strong>
              {result.line ? <small>Line {result.line}</small> : null}
              <em>{result.excerpt}</em>
            </span>
          </button>
        )) : (
          <div className="project-search-empty">
            <ListMagnifyingGlass size={21} />
            <span>{query.trim() ? '검색 결과가 없습니다.' : '파일에서 검색하려면 입력하세요.'}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function searchNames(files: string[], query: string, caseSensitive: boolean): SearchResult[] {
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  return files
    .filter(file => (caseSensitive ? file : file.toLocaleLowerCase()).includes(needle))
    .slice(0, 200)
    .map(fileId => ({ fileId, excerpt: fileId.split('/').pop() || fileId }));
}

async function searchContents(
  files: string[],
  query: string,
  options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
) {
  let matcher: RegExp;
  try {
    const source = options.regex ? query : escapeRegExp(query);
    matcher = new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, options.caseSensitive ? 'g' : 'gi');
  } catch {
    return [];
  }
  const results: SearchResult[] = [];
  for (let offset = 0; offset < files.length && results.length < 300; offset += 16) {
    const batch = files.slice(offset, offset + 16);
    const contents = await Promise.all(batch.map(async fileId => {
      try {
        return { fileId, content: (await readWorkspaceFile(fileId)).content };
      } catch {
        return { fileId, content: '' };
      }
    }));
    for (const { fileId, content } of contents) {
      const lines = content.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length && results.length < 300; lineIndex += 1) {
        matcher.lastIndex = 0;
        if (!matcher.test(lines[lineIndex])) continue;
        results.push({ fileId, line: lineIndex + 1, excerpt: lines[lineIndex].trim() || '(빈 줄)' });
      }
    }
  }
  return results;
}

function matchesFileFilters(file: string, include: string, exclude: string) {
  const includes = splitPatterns(include);
  const excludes = splitPatterns(exclude);
  if (includes.length && !includes.some(pattern => globMatches(file, pattern))) return false;
  return !excludes.some(pattern => globMatches(file, pattern));
}

function splitPatterns(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function globMatches(file: string, pattern: string) {
  const source = escapeRegExp(pattern)
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '.');
  return new RegExp(`^${source}$`, 'i').test(file) || new RegExp(`(?:^|/)${source}$`, 'i').test(file);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
