import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowCounterClockwise,
  Check,
  DownloadSimple,
  List,
  MagnifyingGlass,
  Moon,
  Pause,
  Play,
  Sun,
  X,
} from '@phosphor-icons/react';
import { curatedReleaseMedia, navigationGroups, pageForSlug, searchablePages } from './content.js';
import { canonicalPath, DOC_ROUTES, matchRoute, normalizeBase } from './routes.mjs';
import { FALLBACK_RELEASES, fetchReleases, resolveLatestDmg } from './releases.mjs';

const assetPath = value => `${normalizeBase(import.meta.env.BASE_URL)}${String(value).replace(/^\/+/, '')}`;
const routeFromLocation = () => matchRoute(window.location.pathname, import.meta.env.BASE_URL);

function navigateTo(route, replace = false) {
  const base = normalizeBase(import.meta.env.BASE_URL).replace(/\/$/, '');
  const path = `${base}${canonicalPath(route)}`.replace(/\/+/g, '/');
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path || '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Header({ route, theme, onTheme, onSearch, onMenu, onDownload, downloadState }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" type="button" onClick={() => navigateTo({ kind: 'docs', slug: 'overview' })} aria-label="DocPilot Docs 홈">
          <img src={assetPath('docpilot-icon.png')} alt="" />
          <span>DocPilot</span>
        </button>
        <nav className="top-nav" aria-label="주요 탐색">
          <button className={route.kind === 'docs' ? 'active' : ''} onClick={() => navigateTo({ kind: 'docs', slug: 'overview' })}>Docs</button>
          <button className={route.kind === 'changelog' || route.kind === 'release' ? 'active' : ''} onClick={() => navigateTo({ kind: 'changelog' })}>Changelog</button>
        </nav>
        <div className="header-actions">
          <button className="icon-action search-action" type="button" onClick={onSearch} aria-label="문서 검색"><MagnifyingGlass size={18} /></button>
          <button className="icon-action theme-action" type="button" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? '라이트 테마 사용' : '다크 테마 사용'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="download-action" type="button" onClick={onDownload} disabled={downloadState === 'loading'}>
            <DownloadSimple size={20} />
            <span>{downloadState === 'loading' ? 'Preparing…' : 'Download'}</span>
          </button>
          <button className="icon-action menu-action" type="button" onClick={onMenu} aria-label="문서 메뉴 열기"><List size={21} /></button>
        </div>
      </div>
    </header>
  );
}

function Sidebar({ route, mobile = false, onClose, onSearch }) {
  return (
    <aside className={mobile ? 'docs-sidebar mobile-sidebar' : 'docs-sidebar'} aria-label="문서 목차">
      {mobile ? <div className="mobile-sidebar-head"><strong>Docs</strong><button onClick={onClose} aria-label="메뉴 닫기"><X size={19} /></button></div> : null}
      <div className="sidebar-scroll">
        <button className="sidebar-search" type="button" onClick={() => { onSearch?.(); onClose?.(); }}><MagnifyingGlass size={15} /><span>Search docs</span><kbd>⌘K</kbd></button>
        {navigationGroups.map(group => (
          <section className="nav-group" key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map(item => (
              <button
                className={route.kind === 'docs' && route.slug === item.slug ? 'active' : ''}
                key={item.slug}
                onClick={() => { navigateTo({ kind: 'docs', slug: item.slug }); onClose?.(); }}
              >{item.title}</button>
            ))}
          </section>
        ))}
      </div>
      <footer className="sidebar-footer">DocPilot 2.0 documentation</footer>
    </aside>
  );
}

function SearchDialog({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const all = searchablePages();
    return (needle ? all.filter(page => `${page.title} ${page.group} ${page.description}`.toLocaleLowerCase().includes(needle)) : all).slice(0, 9);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;
  const choose = item => { if (!item) return; navigateTo({ kind: 'docs', slug: item.slug }); onClose(); };
  return (
    <div className="dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="search-dialog" role="dialog" aria-modal="true" aria-label="문서 검색">
        <div className="search-row">
          <MagnifyingGlass size={20} />
          <input
            ref={inputRef}
            value={query}
            placeholder="가이드 검색"
            onChange={event => { setQuery(event.target.value); setSelected(0); }}
            onKeyDown={event => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(value => Math.min(value + 1, results.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => Math.max(value - 1, 0)); }
              if (event.key === 'Enter') { event.preventDefault(); choose(results[selected]); }
            }}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="search-results" role="listbox">
          {results.map((item, index) => (
            <button key={item.slug} className={index === selected ? 'active' : ''} onMouseEnter={() => setSelected(index)} onClick={() => choose(item)}>
              <span><strong>{item.title}</strong><small>{item.group}</small></span><ArrowRight size={15} />
            </button>
          ))}
          {!results.length ? <p>일치하는 가이드가 없습니다.</p> : null}
        </div>
        <footer><span>↑↓ 이동</span><span>Enter 열기</span><span>Cmd/Ctrl+K</span></footer>
      </section>
    </div>
  );
}

function MediaFrame({ media }) {
  const videoRef = useRef(null);
  const visibleRef = useRef(false);
  const enteredRef = useRef(false);
  const endedRef = useRef(false);
  const manualPauseRef = useRef(false);
  const replayTimerRef = useRef(null);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [state, setState] = useState('idle');
  const type = media.type || 'demo';
  const asset = media.asset || media.demo;

  const clearReplayTimer = () => {
    if (replayTimerRef.current) window.clearTimeout(replayTimerRef.current);
    replayTimerRef.current = null;
  };

  const replay = video => {
    clearReplayTimer();
    endedRef.current = false;
    video.currentTime = 0;
    video.play().catch(() => {});
  };

  const holdThenReplay = video => {
    clearReplayTimer();
    replayTimerRef.current = window.setTimeout(() => {
      replayTimerRef.current = null;
      if (visibleRef.current && !manualPauseRef.current) replay(video);
    }, 3000);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    visibleRef.current = false;
    enteredRef.current = false;
    endedRef.current = false;
    manualPauseRef.current = false;
    clearReplayTimer();
    setState('idle');
    video.load();
    if (reducedMotion) return () => clearReplayTimer();
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.6);
      visibleRef.current = visible;
      if (!visible) {
        clearReplayTimer();
        video.pause();
        return;
      }
      if (!enteredRef.current || endedRef.current) video.currentTime = 0;
      enteredRef.current = true;
      endedRef.current = false;
      if (!manualPauseRef.current) video.play().catch(() => {});
    }, { threshold: [0.6] });
    observer.observe(video);
    return () => {
      visibleRef.current = false;
      clearReplayTimer();
      observer.disconnect();
      video.pause();
    };
  }, [asset, reducedMotion]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      manualPauseRef.current = true;
      clearReplayTimer();
      return video.pause();
    }
    manualPauseRef.current = false;
    if (endedRef.current || video.ended) replay(video);
    return video.play();
  };

  if (type === 'image') {
    return (
      <figure className="media-frame media-frame-image">
        <div className="media-surface">
          <img src={assetPath(`media/images/${asset}.jpg`)} alt={media.alt} loading="lazy" />
        </div>
        <figcaption>{media.label}</figcaption>
      </figure>
    );
  }

  return (
    <figure className="media-frame">
      <div className="media-surface">
        <video
          ref={videoRef}
          data-media-asset={asset}
          poster={assetPath(`media/demos/${asset}.jpg`)}
          muted
          playsInline
          aria-label={media.alt}
          onPlay={() => setState('playing')}
          onPause={() => setState(replayTimerRef.current ? 'holding' : 'paused')}
          onEnded={() => {
            const video = videoRef.current;
            if (!video) return;
            endedRef.current = true;
            setState('holding');
            if (visibleRef.current && !manualPauseRef.current) holdThenReplay(video);
          }}
        >
          <source src={assetPath(`media/demos/${asset}.webm`)} type="video/webm" />
          <source src={assetPath(`media/demos/${asset}.mp4`)} type="video/mp4" />
        </video>
        {!reducedMotion ? (
          <button className="media-control" type="button" onClick={toggle} aria-label={state === 'playing' ? '데모 일시 정지' : state === 'holding' ? '데모 처음부터 다시 보기' : '데모 재생'}>
            {state === 'playing' ? <Pause size={15} weight="fill" /> : state === 'holding' ? <ArrowCounterClockwise size={16} /> : <Play size={15} weight="fill" />}
          </button>
        ) : null}
      </div>
      <figcaption>{media.label}</figcaption>
    </figure>
  );
}

function PageSection({ section }) {
  return (
    <section id={section.id} className={`article-section section-${section.kind}`}>
      <h2>{section.title}</h2>
      {section.kind === 'steps' ? (
        <ol className="step-list">{section.items.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
      ) : (
        <ul className="plain-list">{section.items.map(item => <li key={item}>{section.kind === 'checks' ? <Check size={16} /> : null}<span>{item}</span></li>)}</ul>
      )}
    </section>
  );
}

function ArticleOutline({ page }) {
  return (
    <aside className="article-outline" aria-label="이 페이지에서">
      <h2>On this page</h2>
      <a href="#outcome">이 가이드를 마치면</a>
      {page.sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}
    </aside>
  );
}

function DocsArticle({ slug }) {
  const requestedPage = pageForSlug(slug);
  const resolvedSlug = requestedPage.redirectTo || slug;
  const route = DOC_ROUTES.find(item => item.slug === resolvedSlug) || DOC_ROUTES[0];
  const page = pageForSlug(resolvedSlug);
  const index = DOC_ROUTES.findIndex(item => item.slug === route.slug);
  const previous = DOC_ROUTES[index - 1];
  const next = DOC_ROUTES[index + 1];
  return (
    <div className="article-layout">
      <main className="article-column">
        <article className="docs-article">
          <p className="eyebrow">{route.group}</p>
          <h1>{route.title}</h1>
          <p className="article-lede">{page.description}</p>
          <aside className="outcome" id="outcome"><span>이 가이드를 마치면</span><p>{page.outcome}</p></aside>
          {page.shortcuts ? (
            <section className="article-section" id="shortcuts"><h2>기본 단축키</h2><div className="shortcut-table">{page.shortcuts.map(([keys, action]) => <div key={keys}><kbd>{keys}</kbd><span>{action}</span></div>)}</div></section>
          ) : null}
          {page.sections.map(section => <PageSection section={section} key={section.id} />)}
          {page.media?.length ? (
            <section className="guide-media" aria-label={`${route.title} 기능 화면`}>
              {page.media.map((item, mediaIndex) => <MediaFrame media={item} key={`${resolvedSlug}:${item.asset}:${mediaIndex}`} />)}
            </section>
          ) : null}
          {page.related?.length ? <RelatedPages slugs={page.related} /> : null}
          <nav className="page-pagination" aria-label="가이드 이동">
            {previous ? <button onClick={() => navigateTo({ kind: 'docs', slug: previous.slug })}><ArrowLeft size={16} /><span><small>Previous</small>{previous.title}</span></button> : <span />}
            {next ? <button className="next" onClick={() => navigateTo({ kind: 'docs', slug: next.slug })}><span><small>Next</small>{next.title}</span><ArrowRight size={16} /></button> : <span />}
          </nav>
        </article>
      </main>
      <ArticleOutline page={page} />
    </div>
  );
}

function RelatedPages({ slugs }) {
  return <section className="related-pages"><h2>Related</h2>{slugs.map(slug => { const item = DOC_ROUTES.find(route => route.slug === slug); return item ? <button key={slug} onClick={() => navigateTo({ kind: 'docs', slug })}><span>{item.title}</span><ArrowRight size={15} /></button> : null; })}</section>;
}

function Changelog({ selectedVersion }) {
  const [releases, setReleases] = useState(FALLBACK_RELEASES);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    let alive = true;
    fetchReleases().then(value => { if (alive) { setReleases(value); setStatus('ready'); } }).catch(() => { if (alive) setStatus('fallback'); });
    return () => { alive = false; };
  }, []);
  const selected = selectedVersion ? releases.find(item => item.version === selectedVersion) : null;
  if (selected) return <ReleaseDetail release={selected} />;
  return (
    <main className="changelog-page">
      <header className="changelog-hero"><p className="eyebrow">DocPilot releases</p><h1>Changelog</h1><p>새 기능, 변경된 동작과 업그레이드 전에 확인할 내용을 버전별로 기록합니다.</p>{status === 'fallback' ? <span className="sync-note">실시간 정보를 불러오지 못해 내장된 최신 요약을 표시합니다.</span> : null}</header>
      <div className="release-list">
        {releases.map(release => (
          <article className="release-card" key={release.version}>
            <div className="release-meta"><time>{release.unreleased ? '출시 예정' : formatDate(release.date)}</time><span>v{release.version}</span></div>
            <button className="release-copy" onClick={() => navigateTo({ kind: 'release', version: release.version })}>
              <h2>{release.title}</h2><p>{release.summary}</p><span className="read-release">Read release notes <ArrowRight size={15} /></span>
            </button>
            {curatedReleaseMedia[release.version]?.[0] ? <MediaFrame media={curatedReleaseMedia[release.version][0]} key={`${release.version}:${curatedReleaseMedia[release.version][0].asset || curatedReleaseMedia[release.version][0].demo}`} /> : null}
          </article>
        ))}
      </div>
    </main>
  );
}

function ReleaseDetail({ release }) {
  const blocks = releaseBodyBlocks(release.body);
  return (
    <main className="release-detail">
      <button className="back-link" onClick={() => navigateTo({ kind: 'changelog' })}><ArrowLeft size={15} /> All releases</button>
      <header><p className="eyebrow">{release.unreleased ? '출시 예정' : formatDate(release.date)} · v{release.version}</p><h1>{release.title}</h1><p>{release.summary}</p></header>
      {blocks.map((block, index) => <section key={`${block.title}-${index}`}><h2>{block.title}</h2><ul>{block.items.map(item => <li key={item}>{item}</li>)}</ul></section>)}
      {curatedReleaseMedia[release.version]?.map(media => <MediaFrame media={media} key={media.asset || media.demo} />)}
    </main>
  );
}

function NotFound() {
  return <main className="not-found"><p className="eyebrow">404</p><h1>문서를 찾을 수 없습니다.</h1><p>주소가 바뀌었거나 아직 제공되지 않는 페이지입니다.</p><button onClick={() => navigateTo({ kind: 'docs', slug: 'overview' })}>Docs로 돌아가기</button></main>;
}

export function App() {
  const [route, setRoute] = useState(routeFromLocation);
  const [theme, setTheme] = useState(() => initialTheme());
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [downloadState, setDownloadState] = useState('idle');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const onRoute = () => { setRoute(routeFromLocation()); setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'auto' }); };
    window.addEventListener('popstate', onRoute);
    return () => window.removeEventListener('popstate', onRoute);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('docpilot-manual-theme', theme);
  }, [theme]);
  useEffect(() => {
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
      if (event.key === 'Escape') { setSearchOpen(false); setMobileOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const download = async () => {
    setDownloadState('loading'); setNotice('');
    try {
      const asset = await resolveLatestDmg();
      window.location.assign(asset.url);
      setDownloadState('ready');
    } catch (error) {
      setDownloadState('error');
      setNotice(error instanceof Error ? error.message : '다운로드를 준비하지 못했습니다.');
    }
  };

  const docsRoute = route.kind === 'docs';
  return (
    <div className="site-app">
      <Header route={route} theme={theme} onTheme={setTheme} onSearch={() => setSearchOpen(true)} onMenu={() => setMobileOpen(true)} onDownload={download} downloadState={downloadState} />
      {notice ? <button className="site-notice" onClick={() => setNotice('')}>{notice}<X size={14} /></button> : null}
      <div className={docsRoute ? 'site-body with-sidebar' : 'site-body'}>
        {docsRoute ? <Sidebar route={route} onSearch={() => setSearchOpen(true)} /> : null}
        <div className="page-shell">
          {route.kind === 'docs' ? <DocsArticle slug={route.slug} /> : null}
          {route.kind === 'changelog' ? <Changelog /> : null}
          {route.kind === 'release' ? <Changelog selectedVersion={route.version} /> : null}
          {route.kind === 'not-found' ? <NotFound /> : null}
          <footer className="site-footer"><span>DocPilot</span><span>Local-first document workbench</span></footer>
        </div>
      </div>
      {mobileOpen ? <div className="mobile-backdrop" onMouseDown={event => event.target === event.currentTarget && setMobileOpen(false)}><Sidebar route={route} mobile onClose={() => setMobileOpen(false)} onSearch={() => setSearchOpen(true)} /></div> : null}
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function initialTheme() {
  const stored = localStorage.getItem('docpilot-manual-theme') || localStorage.getItem('docpilot:theme-preference');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function formatDate(value) {
  if (!value) return 'Release';
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function releaseBodyBlocks(markdown) {
  const blocks = [];
  let current = { title: 'Release notes', items: [] };
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const heading = raw.match(/^#{1,4}\s+(.+)/);
    if (heading) {
      if (current.items.length) blocks.push(current);
      current = { title: heading[1].replace(/[*_`]/g, ''), items: [] };
      continue;
    }
    const text = raw.replace(/^\s*[-*+]\s+/, '').replace(/[*_`]/g, '').trim();
    if (text) current.items.push(text);
  }
  if (current.items.length) blocks.push(current);
  return blocks.length ? blocks : [{ title: 'Release notes', items: ['이 릴리스에는 별도의 설명이 없습니다.'] }];
}
