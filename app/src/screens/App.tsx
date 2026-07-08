import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { EditorPane } from '../features/editor/EditorPane';
import { InstructionsPanel } from '../features/instructions/InstructionsPanel';
import { WorkspaceSidebar } from '../features/workspace/WorkspaceSidebar';
import { copyText, getAppVersion, getSettings, listWorkspaceFiles, pingBridge, readWorkspaceFile, saveSettings, saveWorkspaceFile, watchProject, type AppSettings } from '../shared/bridge-client';
import { withActiveInstructionPrompt } from '../shared/copy-with-instructions';
import { formatContextLocation } from '../shared/context-format';
import { applyThemePreference } from '../shared/theme';
import { applyDiskChange, createFileBuffer, markSaved, updateEditorContent } from '../../../shared/core/file-buffer';

type FileBuffer = ReturnType<typeof createFileBuffer>;

type OpenFileTab = {
  id: string;
  buffer: FileBuffer;
};

type ReleaseNotice = {
  id: string;
  version: string;
  items: ReleaseNoteItem[];
};

type ReleaseNoteItem = {
  title: string;
  body: string;
};

const RELEASE_NOTES: Record<string, ReleaseNoteItem[]> = {
  '1.0.27': [
    {
      title: '들여쓰기 선택지를 간단하게 정리했습니다',
      body: '상단 Tab 메뉴와 명령 팔레트에서 스페이스 2칸, 스페이스 4칸, 탭 2칸, 탭 4칸을 바로 선택할 수 있습니다.',
    },
    {
      title: 'JSON과 JavaScript 파일을 작업할 수 있습니다',
      body: '파일 트리, 빠른 이동, 편집기에서 JSON과 JavaScript 파일을 열고 수정할 수 있습니다. JSON은 보기 모드에서 읽기 좋게 정렬해 보여줍니다.',
    },
    {
      title: '프리뷰는 Markdown과 JSON에 집중했습니다',
      body: 'JavaScript, YAML, 일반 텍스트 파일은 기본적으로 편집 모드로 열립니다. 프리뷰가 어울리는 문서와 데이터 파일에만 프리뷰 전환을 제공합니다.',
    },
    {
      title: '편집기 색과 배경을 다시 맞췄습니다',
      body: '다크 테마 편집 배경을 덜 진하게 조정하고, 편집 모드 코드 색상을 프리뷰 코드블록과 더 가깝게 맞췄습니다.',
    },
    {
      title: '들여쓰기 설정을 명령 팔레트에서 바꿀 수 있습니다',
      body: 'Cmd+Shift+P에서 탭과 스페이스를 선택하고, 언어별 권장 들여쓰기 기준을 적용할 수 있습니다. 들여쓰기 영역도 화면에서 구분됩니다.',
    },
  ],
  '1.0.26': [
    {
      title: '새 창이 기존 프로젝트를 끊지 않습니다',
      body: '새 창에서 다른 폴더를 열어도 기존 창의 프로젝트와 브리지가 그대로 유지됩니다.',
    },
    {
      title: '검색창을 찾기 중심으로 줄였습니다',
      body: '프리뷰와 편집 모드의 Cmd+F 창을 더 작게 정리하고, 다른 영역을 클릭하면 닫히도록 했습니다.',
    },
    {
      title: '본문 폭 기본값을 넓혔습니다',
      body: '프리뷰 본문 폭은 처음부터 최대로 열리고, 슬라이더 트랙을 클릭해 바로 조절할 수 있습니다.',
    },
    {
      title: '라이트 테마 코드블록을 보정했습니다',
      body: '라이트 테마에서도 네이비 코드블록 안의 타입, 함수명, 매개변수가 잘 보이도록 색을 다시 맞췄습니다.',
    },
  ],
  '1.0.25': [
    {
      title: '작은 Diff만 보이게 했습니다',
      body: '표 한 줄이나 목록 한 항목만 바뀐 경우, DocPilot은 그 부분만 빨강/초록으로 표시합니다. 문서 전체가 바뀐 것처럼 보이던 화면을 줄였습니다.',
    },
    {
      title: '긴 문서에서 변경 위치를 먼저 볼 수 있습니다',
      body: 'Diff 오른쪽 레일에 변경 지점이 표시됩니다. 레일을 보고 어디쯤을 확인해야 하는지 파악한 뒤 스크롤하면 됩니다.',
    },
    {
      title: '라이트 테마 Diff를 다시 맞췄습니다',
      body: '줄 번호 색을 낮추고, 편집 모드 raw diff의 배경과 글자색을 조정했습니다. 밝은 화면에서도 삭제/추가 줄을 구분할 수 있습니다.',
    },
    {
      title: '지침 프리셋이 현재 상태를 따라갑니다',
      body: '지침을 끄거나 삭제하면 활성 프리셋 표시도 함께 정리됩니다. 파일에서 불러온 지침은 복사나 에이전트 요청 전에 최신 내용을 다시 읽습니다.',
    },
    {
      title: '프리뷰 복사 동작을 분리했습니다',
      body: '문단을 클릭하면 바로 참고 칩에 추가하고 복사합니다. 드래그로 범위를 잡았을 때만 선택 복사 메뉴가 열립니다.',
    },
  ],
  '1.0.24': [
    { title: '분할 탭을 분리했습니다', body: '주 파일과 분할 파일의 탭이 각 pane 안에 따로 표시됩니다.' },
    { title: '분할 크기 조절을 추가했습니다', body: '좌우/상하 분할에서 각 영역의 크기를 직접 조절할 수 있습니다.' },
    { title: '프리뷰와 편집 위치를 맞췄습니다', body: '프리뷰와 편집 모드를 오갈 때 현재 읽던 위치에 가깝게 이동합니다.' },
    { title: '검색 단축키를 추가했습니다', body: '프리뷰와 편집 모드에서 각각 Cmd+F 검색을 사용할 수 있습니다.' },
    { title: '파일 트리를 정리했습니다', body: '수정 표시, Markdown/YAML 아이콘, 프리뷰 하이라이트 색을 조정했습니다.' },
  ],
};

const DEFAULT_RELEASE_NOTES: ReleaseNoteItem[] = [
  { title: 'DocPilot이 업데이트되었습니다', body: '이번 버전의 변경사항을 확인한 뒤 문서 작업을 이어갈 수 있습니다.' },
];

const RELEASE_NOTICE_REVISION = 'r2';
const RELEASE_NOTICE_SEEN_ID_KEY = 'docpilot:release-notice-seen-id';

function releaseNoticeId(version: string) {
  return `${version}:${RELEASE_NOTICE_REVISION}`;
}

export type SelectedContext = {
  fileId: string;
  text: string;
  from: number;
  to: number;
  lineStart?: number;
  lineEnd?: number;
};

export type ContextChip = SelectedContext & {
  id: string;
};

export function App() {
  const [buffer, setBuffer] = useState(createFileBuffer());
  const [openTabs, setOpenTabs] = useState<OpenFileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [secondaryBuffer, setSecondaryBuffer] = useState(createFileBuffer());
  const [secondaryOpenTabs, setSecondaryOpenTabs] = useState<OpenFileTab[]>([]);
  const [secondaryActiveTabId, setSecondaryActiveTabId] = useState('');
  const [openError, setOpenError] = useState('');
  const [bridgeState, setBridgeState] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [bridgeMessage, setBridgeMessage] = useState('브리지 연결 확인 중');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedContext, setSelectedContext] = useState<SelectedContext | null>(null);
  const [contextChips, setContextChips] = useState<ContextChip[]>([]);
  const [workspaceRefreshSignal, setWorkspaceRefreshSignal] = useState(0);
  const [reviewDiff, setReviewDiff] = useState<{ fileId: string; before: string; signal: number } | null>(null);
  const [leftWidth, setLeftWidth] = useState(() => readStoredPanelWidth('docpilot:left-panel-width', 300, 220, 520));
  const [leftCollapsed, setLeftCollapsed] = useState(() => readStoredBoolean('docpilot:left-panel-collapsed', false));
  const [themePreference, setThemePreference] = useState<AppSettings['theme']>('dark');
  const [activePreviewPane, setActivePreviewPane] = useState<'primary' | 'secondary'>('primary');
  const [splitOrientation, setSplitOrientation] = useState<'horizontal' | 'vertical'>(() => {
    const stored = window.localStorage.getItem('docpilot:preview-split-orientation');
    return stored === 'vertical' ? 'vertical' : 'horizontal';
  });
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState('');
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);
  const [quickOpenRecent, setQuickOpenRecent] = useState<string[]>(() => readStoredStringList('docpilot:quick-open-recent'));
  const [releaseNotice, setReleaseNotice] = useState<ReleaseNotice | null>(null);
  const openPathRef = useRef('');
  const secondaryOpenPathRef = useRef('');
  const activePreviewPaneRef = useRef<'primary' | 'secondary'>('primary');

  useEffect(() => {
    openPathRef.current = buffer.path;
  }, [buffer.path]);

  useEffect(() => {
    secondaryOpenPathRef.current = secondaryBuffer.path;
  }, [secondaryBuffer.path]);

  useEffect(() => {
    if (!buffer.path) {
      setActiveTabId('');
      return;
    }
    setActiveTabId(buffer.path);
    setOpenTabs(current => upsertOpenTab(current, buffer));
  }, [buffer]);

  useEffect(() => {
    if (!secondaryBuffer.path) {
      setSecondaryActiveTabId('');
      return;
    }
    setSecondaryActiveTabId(secondaryBuffer.path);
    setSecondaryOpenTabs(current => upsertOpenTab(current, secondaryBuffer));
  }, [secondaryBuffer]);

  function setActivePane(nextPane: 'primary' | 'secondary') {
    activePreviewPaneRef.current = nextPane;
    setActivePreviewPane(nextPane);
  }

  useEffect(() => {
    checkBridge();
  }, []);

  useEffect(() => {
    let disposed = false;
    getAppVersion()
      .then(version => {
        if (disposed || !version) return;
        const noticeId = releaseNoticeId(version);
        const seenNoticeId = window.localStorage.getItem(RELEASE_NOTICE_SEEN_ID_KEY);
        if (seenNoticeId === noticeId) {
          return;
        }
        const items = RELEASE_NOTES[version] || DEFAULT_RELEASE_NOTES;
        setReleaseNotice({ id: noticeId, version, items });
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem('docpilot:left-panel-width', String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    window.localStorage.setItem('docpilot:left-panel-collapsed', leftCollapsed ? '1' : '0');
  }, [leftCollapsed]);

  useEffect(() => {
    window.localStorage.setItem('docpilot:preview-split-orientation', splitOrientation);
  }, [splitOrientation]);

  useEffect(() => {
    let disposed = false;
    listWorkspaceFiles()
      .then(data => {
        if (!disposed) setWorkspaceFiles(Array.isArray(data.files) ? data.files : []);
      })
      .catch(() => {
        if (!disposed) setWorkspaceFiles([]);
      });
    return () => {
      disposed = true;
    };
  }, [workspaceRefreshSignal]);

  const quickOpenResults = useMemo(() => {
    return quickOpenMatches(workspaceFiles, quickOpenQuery, quickOpenRecent, buffer.path);
  }, [buffer.path, quickOpenQuery, quickOpenRecent, workspaceFiles]);

  const dirtyFileIds = useMemo(() => {
    const ids = new Set(openTabs.filter(tab => tab.buffer.dirtyByUser).map(tab => tab.id));
    secondaryOpenTabs.filter(tab => tab.buffer.dirtyByUser).forEach(tab => ids.add(tab.id));
    if (buffer.path && buffer.dirtyByUser) ids.add(buffer.path);
    return Array.from(ids);
  }, [buffer.dirtyByUser, buffer.path, openTabs, secondaryOpenTabs]);

  useEffect(() => {
    setQuickOpenIndex(current => clamp(current, 0, Math.max(quickOpenResults.length - 1, 0)));
  }, [quickOpenResults.length]);

  useEffect(() => {
    if (!workspaceFiles.length) return;
    const visibleFiles = new Set(workspaceFiles);
    setOpenTabs(current => current.filter(tab => visibleFiles.has(tab.id) || tab.buffer.dirtyByUser));
    setSecondaryOpenTabs(current => current.filter(tab => visibleFiles.has(tab.id) || tab.buffer.dirtyByUser));
  }, [workspaceFiles]);

  useEffect(() => {
    let currentThemePreference: AppSettings['theme'] = 'dark';
    const applyFromSettings = () => {
      getSettings()
        .then(response => {
          currentThemePreference = response.settings.theme;
          setThemePreference(response.settings.theme);
          applyThemePreference(currentThemePreference);
        })
        .catch(() => applyThemePreference(currentThemePreference));
    };
    const onSettingsSaved = (event: Event) => {
      const settings = (event as CustomEvent).detail?.settings;
      if (settings?.theme) {
        currentThemePreference = settings.theme;
        setThemePreference(settings.theme);
        applyThemePreference(currentThemePreference);
      } else {
        applyFromSettings();
      }
    };
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const onSystemThemeChange = () => applyThemePreference(currentThemePreference);
    applyFromSettings();
    window.addEventListener('docpilot-settings-saved', onSettingsSaved);
    media?.addEventListener?.('change', onSystemThemeChange);
    return () => {
      window.removeEventListener('docpilot-settings-saved', onSettingsSaved);
      media?.removeEventListener?.('change', onSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    const refreshOpenDiskFiles = () => {
      const openPaths = Array.from(new Set([openPathRef.current, secondaryOpenPathRef.current].filter(Boolean)));
      if (!openPaths.length) return;
      openPaths.forEach(openPath => {
        readWorkspaceFile(openPath)
          .then(file => {
            applyExternalDiskContent(file.id, file.content);
            setOpenError('');
          })
          .catch(err => {
            setOpenError(err instanceof Error ? err.message : String(err));
          });
      });
    };
    const stop = watchProject(event => {
      if (event.type === 'watch.ready' || event.type === 'watch.ping') {
        setBridgeState('connected');
        setBridgeMessage('브리지 연결됨');
      }
      if (event.type !== 'files.changed') return;
      setWorkspaceRefreshSignal(value => value + 1);
      refreshOpenDiskFiles();
    }, () => {
      setBridgeState('disconnected');
      setBridgeMessage('브리지 연결이 끊겼습니다.');
    });
    const poll = window.setInterval(refreshOpenDiskFiles, 1500);
    return () => {
      stop();
      window.clearInterval(poll);
    };
  }, []);

  async function checkBridge() {
    setBridgeState('checking');
    setBridgeMessage('브리지 연결 확인 중');
    try {
      const ping = await pingBridge();
      setBridgeState('connected');
      setBridgeMessage(`브리지 연결됨 · ${ping.root}`);
      setWorkspaceRoot(ping.root);
      setWorkspaceRefreshSignal(value => value + 1);
    } catch (err) {
      setBridgeState('disconnected');
      setBridgeMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function setTopbarTheme(nextTheme: 'light' | 'dark') {
    setThemePreference(nextTheme);
    applyThemePreference(nextTheme);
    try {
      const response = await getSettings();
      const saved = await saveSettings({ ...response.settings, theme: nextTheme });
      setThemePreference(saved.settings.theme);
      applyThemePreference(saved.settings.theme);
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: saved.settings } }));
    } catch {
      // Keep the immediate visual toggle even if settings persistence is unavailable.
    }
  }

  useEffect(() => {
    const openFileRel = new URLSearchParams(window.location.search).get('open');
    if (openFileRel) openFile(openFileRel);
  }, []);

  async function openFile(id: string, options: { keepReview?: boolean } = {}) {
    const existingTab = openTabs.find(tab => tab.id === id);
    if (existingTab) {
      openPathRef.current = id;
      setBuffer(existingTab.buffer);
      setActivePane('primary');
      if (!options.keepReview) setReviewDiff(null);
      setSelectedContext(null);
      setContextChips(current => current.filter(item => item.fileId !== id));
      setOpenError('');
      rememberQuickOpenFile(id);
      return;
    }
    try {
      const file = await readWorkspaceFile(id);
      openPathRef.current = file.id;
      setBuffer(createFileBuffer({ path: file.id, content: file.content }));
      setActivePane('primary');
      if (!options.keepReview) setReviewDiff(null);
      setSelectedContext(null);
      setContextChips(current => current.filter(item => item.fileId !== file.id));
      setOpenError('');
      rememberQuickOpenFile(file.id);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyExternalDiskContent(fileId: string, content: string) {
    const applyToBuffer = (current: FileBuffer) => {
      if (current.path !== fileId) return current;
      return applyDiskChange(current, content, 'external');
    };
    setBuffer(applyToBuffer);
    setSecondaryBuffer(applyToBuffer);
    setOpenTabs(current => updateOpenTabsForDiskChange(current, fileId, content));
    setSecondaryOpenTabs(current => updateOpenTabsForDiskChange(current, fileId, content));
  }

  async function openFileInSplit(id: string, orientation: 'horizontal' | 'vertical' = splitOrientation) {
    const existingTab = secondaryOpenTabs.find(tab => tab.id === id);
    if (existingTab) {
      setSplitOrientation(orientation);
      secondaryOpenPathRef.current = id;
      setSecondaryBuffer(existingTab.buffer);
      setActivePane('secondary');
      setOpenError('');
      rememberQuickOpenFile(id);
      return;
    }
    try {
      const file = await readWorkspaceFile(id);
      setSplitOrientation(orientation);
      secondaryOpenPathRef.current = file.id;
      setSecondaryBuffer(createFileBuffer({ path: file.id, content: file.content }));
      setActivePane('secondary');
      setOpenError('');
      rememberQuickOpenFile(file.id);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  function openCurrentFileInSplit(orientation: 'horizontal' | 'vertical' = splitOrientation) {
    if (!buffer.path) return;
    setSplitOrientation(orientation);
    secondaryOpenPathRef.current = buffer.path;
    setSecondaryBuffer(createFileBuffer({ path: buffer.path, content: buffer.editorContent }));
    setActivePane('secondary');
    setOpenError('');
    rememberQuickOpenFile(buffer.path);
  }

  function openFileFromTree(id: string) {
    if (secondaryBuffer.path && activePreviewPane === 'secondary') {
      openFileInSplit(id);
      return;
    }
    openFile(id);
  }

  function closeSplitPreview(activePane = activePreviewPaneRef.current) {
    if (activePane === 'secondary' && secondaryBuffer.path) {
      openPathRef.current = secondaryBuffer.path;
      setBuffer(secondaryBuffer);
    }
    secondaryOpenPathRef.current = '';
    setSecondaryBuffer(createFileBuffer());
    setSecondaryOpenTabs([]);
    setActivePane('primary');
  }

  function selectOpenTab(id: string) {
    const tab = openTabs.find(item => item.id === id);
    if (!tab) return;
    openPathRef.current = id;
    setBuffer(tab.buffer);
    setActivePane('primary');
    setOpenError('');
  }

  function closeOpenTab(id: string) {
    const tabIndex = openTabs.findIndex(item => item.id === id);
    if (tabIndex < 0) return;
    const tab = openTabs[tabIndex];
    if (tab.buffer.dirtyByUser) {
      setOpenError(`${pathFileName(tab.id)} 파일에 저장되지 않은 변경사항이 있어 닫지 않았습니다.`);
      return;
    }
    const remainingTabs = openTabs.filter(item => item.id !== id);
    setOpenTabs(remainingTabs);
    if (buffer.path !== id) return;
    const nextTab = remainingTabs[Math.min(tabIndex, Math.max(remainingTabs.length - 1, 0))];
    if (nextTab) {
      openPathRef.current = nextTab.id;
      setBuffer(nextTab.buffer);
      setActivePane('primary');
      return;
    }
    if (secondaryBuffer.path) {
      openPathRef.current = secondaryBuffer.path;
      setBuffer(secondaryBuffer);
      secondaryOpenPathRef.current = '';
      setSecondaryBuffer(createFileBuffer());
      setActivePane('primary');
      return;
    }
    openPathRef.current = '';
    setBuffer(createFileBuffer());
    setActiveTabId('');
  }

  function selectSecondaryOpenTab(id: string) {
    const tab = secondaryOpenTabs.find(item => item.id === id);
    if (!tab) return;
    secondaryOpenPathRef.current = id;
    setSecondaryBuffer(tab.buffer);
    setActivePane('secondary');
    setOpenError('');
  }

  function closeSecondaryOpenTab(id: string) {
    const tabIndex = secondaryOpenTabs.findIndex(item => item.id === id);
    if (tabIndex < 0) return;
    const tab = secondaryOpenTabs[tabIndex];
    if (tab.buffer.dirtyByUser) {
      setOpenError(`${pathFileName(tab.id)} 파일에 저장되지 않은 변경사항이 있어 닫지 않았습니다.`);
      return;
    }
    const remainingTabs = secondaryOpenTabs.filter(item => item.id !== id);
    setSecondaryOpenTabs(remainingTabs);
    if (secondaryBuffer.path !== id) return;
    const nextTab = remainingTabs[Math.min(tabIndex, Math.max(remainingTabs.length - 1, 0))];
    if (nextTab) {
      secondaryOpenPathRef.current = nextTab.id;
      setSecondaryBuffer(nextTab.buffer);
      setActivePane('secondary');
      return;
    }
    secondaryOpenPathRef.current = '';
    setSecondaryBuffer(createFileBuffer());
    setSecondaryActiveTabId('');
    setActivePane('primary');
  }

  function moveOpenTab(pane: 'primary' | 'secondary', fromId: string, toId: string) {
    const move = (tabs: OpenFileTab[]) => reorderOpenTabs(tabs, fromId, toId);
    if (pane === 'primary') {
      setOpenTabs(move);
      return;
    }
    setSecondaryOpenTabs(move);
  }

  function closeActivePage() {
    if (secondaryBuffer.path && activePreviewPaneRef.current === 'secondary') {
      closeSecondaryOpenTab(secondaryBuffer.path);
      return;
    }
    if (buffer.path) {
      closeOpenTab(buffer.path);
      return;
    }
    if (secondaryBuffer.path) {
      setSecondaryBuffer(createFileBuffer());
      setActivePane('primary');
    }
  }

  function openQuickOpen() {
    setQuickOpenOpen(true);
    setQuickOpenQuery('');
    setQuickOpenIndex(0);
  }

  function closeQuickOpen() {
    setQuickOpenOpen(false);
    setQuickOpenQuery('');
    setQuickOpenIndex(0);
  }

  function rememberQuickOpenFile(id: string) {
    if (!id) return;
    setQuickOpenRecent(current => {
      const next = [id, ...current.filter(item => item !== id)].slice(0, 8);
      window.localStorage.setItem('docpilot:quick-open-recent', JSON.stringify(next));
      return next;
    });
  }

  function selectedQuickOpenFile() {
    return quickOpenResults[quickOpenIndex]?.id || quickOpenResults[0]?.id || '';
  }

  function openQuickOpenSelection(split?: 'horizontal' | 'vertical') {
    const id = selectedQuickOpenFile();
    if (!id) return;
    if (split) {
      openFileInSplit(id, split);
    } else {
      openFile(id);
    }
    closeQuickOpen();
  }

  function openCurrentOrQuickFileInSplit(orientation: 'horizontal' | 'vertical') {
    if (quickOpenOpen) {
      openQuickOpenSelection(orientation);
      return;
    }
    openCurrentFileInSplit(orientation);
  }

  useEffect(() => {
    const handleAppShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        openQuickOpen();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        event.stopPropagation();
        openCurrentOrQuickFileInSplit(event.shiftKey ? 'vertical' : 'horizontal');
        return;
      }
      if (mod && key === 'w') {
        event.preventDefault();
        event.stopPropagation();
        closeActivePage();
        return;
      }
      if (!quickOpenOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeQuickOpen();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setQuickOpenIndex(current => Math.min(current + 1, Math.max(quickOpenResults.length - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setQuickOpenIndex(current => Math.max(current - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        openQuickOpenSelection();
      }
    };
    window.addEventListener('keydown', handleAppShortcuts);
    return () => window.removeEventListener('keydown', handleAppShortcuts);
  }, [activePreviewPane, buffer.path, buffer.editorContent, openTabs, quickOpenIndex, quickOpenOpen, quickOpenResults, secondaryBuffer, secondaryOpenTabs, splitOrientation]);

  async function saveFile() {
    if (!buffer.path || !buffer.dirtyByUser || saving) return;
    setSaving(true);
    try {
      await saveWorkspaceFile(buffer.path, buffer.editorContent);
      setBuffer(current => markSaved(current, current.editorContent));
      setOpenError('');
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function addContextChip(context: SelectedContext) {
    if (!context.text.trim()) return;
    setContextChips(current => {
      const key = contextChipKey(context);
      if (current.some(item => contextChipKey(item) === key)) return current;
      return [{ ...context, id: `${Date.now()}-${current.length}` }, ...current].slice(0, 12);
    });
  }

  function removeContextChip(id: string) {
    setContextChips(current => current.filter(item => item.id !== id));
  }

  async function copyContextChips() {
    const uniqueChips = uniqueContextChips(contextChips);
    if (uniqueChips.length !== contextChips.length) {
      setContextChips(uniqueChips);
    }
    const text = uniqueChips.map(item => [
      `File: ${item.fileId}`,
      formatContextLocation(item),
      item.text,
    ].join('\n')).join('\n\n---\n\n');
    if (!text) return;
    await copyText(await withActiveInstructionPrompt(text));
  }

  function clearContextChips() {
    setContextChips([]);
  }

  function closeReleaseNotice() {
    if (releaseNotice?.version) {
      window.localStorage.setItem('docpilot:last-seen-version', releaseNotice.version);
      window.localStorage.setItem('docpilot:release-notice-seen', '1');
      window.localStorage.setItem('docpilot:release-notice-seen-version', releaseNotice.version);
      window.localStorage.setItem(RELEASE_NOTICE_SEEN_ID_KEY, releaseNotice.id);
    }
    setReleaseNotice(null);
  }

  function startPanelResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (leftCollapsed) return;
    const startX = event.clientX;
    const startLeft = leftWidth;
    document.body.classList.add('resizing-panels');
    const move = (moveEvent: MouseEvent) => {
      setLeftWidth(clamp(startLeft + moveEvent.clientX - startX, 220, 520));
    };
    const stop = () => {
      document.body.classList.remove('resizing-panels');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop, { once: true });
  }

  function renderOpenFileTabs(
    tabs: OpenFileTab[],
    activeId: string,
    pane: 'primary' | 'secondary',
    onSelect: (id: string) => void,
    onClose: (id: string) => void,
  ) {
    const paneLabel = pane === 'primary' ? '주 파일' : '분할 파일';
    return (
      <div className={`file-tab-pane ${activePreviewPane === pane ? 'active-pane' : ''}`} data-pane={pane}>
        <div className="file-tab-strip" role="tablist" aria-label={`${paneLabel} 열린 파일`}>
          {tabs.length ? tabs.map(tab => (
            <button
              className={`file-tab ${tab.id === activeId ? 'active' : ''} ${tab.buffer.dirtyByUser ? 'dirty' : ''}`}
              key={tab.id}
              type="button"
              role="tab"
              draggable
              aria-selected={tab.id === activeId}
              title={tab.id}
              onClick={() => onSelect(tab.id)}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-docpilot-tab-pane', pane);
                event.dataTransfer.setData('application/x-docpilot-tab-id', tab.id);
              }}
              onDragOver={event => {
                const dragPane = event.dataTransfer.getData('application/x-docpilot-tab-pane');
                if (dragPane && dragPane !== pane) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={event => {
                event.preventDefault();
                const dragPane = event.dataTransfer.getData('application/x-docpilot-tab-pane');
                const dragId = event.dataTransfer.getData('application/x-docpilot-tab-id');
                if (dragPane !== pane || !dragId || dragId === tab.id) return;
                moveOpenTab(pane, dragId, tab.id);
              }}
            >
              <span className={`tree-icon tree-icon-file tree-icon-${quickOpenFileIconType(tab.id)}`} aria-hidden="true" />
              <span className="file-tab-name">{pathFileName(tab.id)}</span>
              {tab.buffer.dirtyByUser ? <span className="file-tab-dirty" aria-label="수정됨" title="수정됨" /> : <span className="file-tab-dirty-spacer" aria-hidden="true" />}
              <span
                className="file-tab-close"
                role="button"
                tabIndex={0}
                aria-label={`${pathFileName(tab.id)} 닫기`}
                onClick={event => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                ×
              </span>
            </button>
          )) : (
            <div className="file-tab-empty">파일을 선택하세요</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <main
      className={`app-shell ${leftCollapsed ? 'left-collapsed' : ''}`}
      style={{
        '--left-panel-width': leftCollapsed ? '44px' : `${leftWidth}px`,
      } as CSSProperties}
    >
      <div className="app-topbar window-drag-region">
        <div className="topbar-left">
          <div className="app-logo"><span className="logo-dot" />DocPilot</div>
          <span className="topbar-chip" title={workspaceRoot}>root: {folderName(workspaceRoot) || '...'}</span>
          <span className="topbar-crumb">{buffer.path || '파일을 선택하세요'}</span>
        </div>
        <div className="topbar-right">
          <div className="theme-toggle" aria-label="테마 전환">
            <button
              className={themePreference === 'light' ? 'active' : ''}
              type="button"
              onClick={() => setTopbarTheme('light')}
            >
              <span aria-hidden="true">☼</span>
              Light
            </button>
            <button
              className={themePreference !== 'light' ? 'active' : ''}
              type="button"
              onClick={() => setTopbarTheme('dark')}
            >
              <span aria-hidden="true">☾</span>
              Dark
            </button>
          </div>
          <div className={`bridge-status ${bridgeState}`} title={bridgeMessage}>
            <span className="bridge-dot" />
            <span>{bridgeState === 'connected' ? '문서 연결됨' : bridgeMessage}</span>
            {bridgeState !== 'connected' ? (
              <button type="button" onClick={checkBridge}>{bridgeState === 'checking' ? '확인 중' : '재시도'}</button>
            ) : null}
          </div>
        </div>
      </div>
      {leftCollapsed ? (
        <aside className="panel-collapsed-rail left-rail">
          <button className="panel-rail-open-button" type="button" onClick={() => setLeftCollapsed(false)}>열기</button>
        </aside>
      ) : (
        <WorkspaceSidebar
          activeFile={buffer.path}
          dirtyFileIds={dirtyFileIds}
          refreshSignal={workspaceRefreshSignal}
          instructionsPanel={<InstructionsPanel />}
          onOpenFile={openFileFromTree}
          onOpenFileInSplit={openFileInSplit}
          onCollapse={() => setLeftCollapsed(true)}
        />
      )}
      <div
        className="panel-resizer left-resizer"
        role="separator"
        aria-label="좌측 패널 폭 조절"
        onMouseDown={startPanelResize}
      />
      {quickOpenOpen ? (
        <div className="quick-open-overlay" role="dialog" aria-modal="true" aria-label="파일 빠른 이동">
          <div className="quick-open-panel">
            <input
              autoFocus
              value={quickOpenQuery}
              placeholder="파일 이름으로 이동"
              onChange={event => {
                setQuickOpenQuery(event.currentTarget.value);
                setQuickOpenIndex(0);
              }}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeQuickOpen();
                }
              }}
            />
            <div className="quick-open-results" role="listbox" aria-label="파일 결과">
              {quickOpenResults.length ? quickOpenResults.slice(0, 12).map((item, index) => (
                <button
                  className={`quick-open-row ${index === quickOpenIndex ? 'active' : ''}`}
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === quickOpenIndex}
                  onMouseEnter={() => setQuickOpenIndex(index)}
                  onClick={() => {
                    openFile(item.id);
                    closeQuickOpen();
                  }}
                >
                  <span className={`tree-icon tree-icon-file tree-icon-${quickOpenFileIconType(item.id)}`} aria-hidden="true" />
                  <span className="quick-open-name">{highlightQuickOpenName(pathFileName(item.id), quickOpenQuery)}</span>
                  <span className="quick-open-path">{parentPath(item.id)}</span>
                  {item.recent ? <small>recently opened</small> : <small>file results</small>}
                </button>
              )) : (
                <div className="quick-open-empty">No results</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {releaseNotice ? (
        <div className="release-notice-overlay" role="dialog" aria-modal="true" aria-label="새 버전 안내">
          <section className="release-notice-modal">
            <header>
              <div className="release-notice-brand">
                <span className="release-notice-dot" />
                <span>DocPilot</span>
              </div>
              <span className="release-notice-version">v{releaseNotice.version}</span>
              <button type="button" aria-label="새 버전 안내 닫기" onClick={closeReleaseNotice}>×</button>
            </header>
            <div className="release-notice-body">
              <span className="release-notice-kicker">Documentation</span>
              <h2>What&apos;s new in v{releaseNotice.version}</h2>
              <p>문서 검토 중 헷갈리던 부분을 줄였습니다. Diff는 바뀐 줄에 더 가깝게 표시되고, 지침과 복사 동작은 현재 화면 상태를 기준으로 움직입니다.</p>
              <ul className="release-notice-list">
                {releaseNotice.items.map((item, index) => (
                  <li key={item.title}>
                    <span className="release-note-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <footer>
              <button type="button" onClick={closeReleaseNotice}>확인</button>
            </footer>
          </section>
        </div>
      ) : null}
      <section className="editor-stack">
        <EditorPane
          buffer={buffer}
          error={openError}
          saving={saving}
          primaryFileTabs={renderOpenFileTabs(openTabs, activeTabId, 'primary', selectOpenTab, closeOpenTab)}
          secondaryFileTabs={renderOpenFileTabs(
            secondaryOpenTabs,
            secondaryActiveTabId,
            'secondary',
            selectSecondaryOpenTab,
            closeSecondaryOpenTab,
          )}
          reviewDiff={reviewDiff}
          secondaryBuffer={secondaryBuffer.path ? secondaryBuffer : undefined}
          activePreviewPane={activePreviewPane}
          splitOrientation={splitOrientation}
          contextChips={contextChips}
          onSelectionChange={setSelectedContext}
          onPreviewContextPick={addContextChip}
          onRemoveContextChip={removeContextChip}
          onCopyContextChips={copyContextChips}
          onClearContextChips={clearContextChips}
          onChange={content => setBuffer(current => updateEditorContent(current, content))}
          onSave={saveFile}
          onCloseSecondary={closeSplitPreview}
          onOpenCurrentInSplit={openCurrentFileInSplit}
          onActivePreviewPaneChange={setActivePane}
          onSplitOrientationChange={setSplitOrientation}
        />
      </section>
    </main>
  );
}

function upsertOpenTab(tabs: OpenFileTab[], buffer: FileBuffer): OpenFileTab[] {
  if (!buffer.path) return tabs;
  const nextTab = { id: buffer.path, buffer };
  const index = tabs.findIndex(tab => tab.id === buffer.path);
  if (index < 0) return [...tabs, nextTab];
  return tabs.map((tab, tabIndex) => tabIndex === index ? nextTab : tab);
}

function updateOpenTabsForDiskChange(tabs: OpenFileTab[], fileId: string, content: string): OpenFileTab[] {
  let changed = false;
  const nextTabs = tabs.map(tab => {
    if (tab.id !== fileId) return tab;
    const nextBuffer = applyDiskChange(tab.buffer, content, 'external');
    if (nextBuffer === tab.buffer) return tab;
    changed = true;
    return { ...tab, buffer: nextBuffer };
  });
  return changed ? nextTabs : tabs;
}

function reorderOpenTabs(tabs: OpenFileTab[], fromId: string, toId: string): OpenFileTab[] {
  const fromIndex = tabs.findIndex(tab => tab.id === fromId);
  const toIndex = tabs.findIndex(tab => tab.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return tabs;
  const next = tabs.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function contextChipKey(item: SelectedContext) {
  return `${item.fileId}:${item.from}:${item.to}:${item.text}`;
}

function uniqueContextChips<T extends SelectedContext>(items: T[]) {
  const exactSeen = new Set<string>();
  return items.filter((item, index) => {
    const key = `${item.fileId}:${normalizeContextText(item.text)}`;
    if (exactSeen.has(key)) return false;
    exactSeen.add(key);
    const text = normalizeContextText(item.text);
    const isContainedByAnother = items.some((other, otherIndex) => {
      if (index === otherIndex || item.fileId !== other.fileId) return false;
      const otherText = normalizeContextText(other.text);
      if (!otherText || otherText === text || !otherText.includes(text)) return false;
      const itemHasRange = Number.isFinite(item.from) && Number.isFinite(item.to);
      const otherHasRange = Number.isFinite(other.from) && Number.isFinite(other.to);
      if (itemHasRange && otherHasRange) {
        return other.from <= item.from && other.to >= item.to;
      }
      return otherText.length > text.length;
    });
    if (isContainedByAnother) return false;
    return true;
  });
}

function folderName(folderPath: string) {
  const trimmed = String(folderPath || '').replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || '';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStoredPanelWidth(key: string, fallback: number, min: number, max: number) {
  const raw = Number(window.localStorage.getItem(key));
  return Number.isFinite(raw) ? clamp(raw, min, max) : fallback;
}

function readStoredBoolean(key: string, fallback: boolean) {
  const raw = window.localStorage.getItem(key);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
}

function readStoredStringList(key: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

type QuickOpenResult = {
  id: string;
  score: number;
  recent: boolean;
};

function quickOpenMatches(files: string[], query: string, recent: string[], activeFile: string): QuickOpenResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const recentSet = new Set(recent);
  if (!normalizedQuery) {
    const recentResults = recent
      .filter(file => files.includes(file))
      .map((id, index) => ({ id, score: 1000 - index, recent: true }));
    const rest = files
      .filter(file => !recentSet.has(file))
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((id, index) => ({ id, score: activeFile === id ? 900 : 500 - index, recent: false }));
    return [...recentResults, ...rest];
  }

  return files
    .map(id => {
      const name = pathFileName(id);
      const score = quickOpenScore(id, name, normalizedQuery);
      return { id, score: score + (recentSet.has(id) ? 20 : 0), recent: recentSet.has(id) };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function quickOpenScore(id: string, name: string, query: string) {
  const lowerName = name.toLowerCase();
  const lowerId = id.toLowerCase();
  if (lowerName === query) return 1000;
  if (lowerName.startsWith(query)) return 900 - lowerName.length;
  if (lowerName.includes(query)) return 760 - lowerName.indexOf(query);
  if (lowerId.includes(query)) return 560 - lowerId.indexOf(query);
  return fuzzySubsequenceScore(lowerId, query);
}

function fuzzySubsequenceScore(value: string, query: string) {
  let cursor = 0;
  let score = 220;
  for (const char of query) {
    const found = value.indexOf(char, cursor);
    if (found === -1) return 0;
    score -= found - cursor;
    cursor = found + 1;
  }
  return Math.max(score, 1);
}

function pathFileName(fileId: string) {
  return String(fileId || '').split('/').filter(Boolean).pop() || fileId;
}

function parentPath(fileId: string) {
  const parts = String(fileId || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function quickOpenFileIconType(fileId: string) {
  const lower = fileId.toLowerCase();
  if (/\.(md|markdown|mdown)$/i.test(lower)) return 'markdown';
  if (/\.(ya?ml)$/i.test(lower)) return 'yaml';
  if (/\.(json)$/i.test(lower)) return 'json';
  if (/\.(js|mjs|cjs)$/i.test(lower)) return 'javascript';
  if (/\.(txt|text)$/i.test(lower)) return 'text';
  return 'default';
}

function highlightQuickOpenName(name: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return name;
  const lower = name.toLowerCase();
  const start = lower.indexOf(normalizedQuery);
  if (start === -1) return name;
  return [
    name.slice(0, start),
    <mark key="match">{name.slice(start, start + normalizedQuery.length)}</mark>,
    name.slice(start + normalizedQuery.length),
  ];
}

function normalizeContextText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}
