import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, ArrowSquareOut, Check, ClockCounterClockwise, DotsSixVertical, DownloadSimple, FileText, FolderOpen, MagnifyingGlass, Moon, SidebarSimple, Sun, TerminalWindow, X } from '@phosphor-icons/react';
import { EditorPane } from '../features/editor/EditorPane';
import { InstructionsPanel } from '../features/instructions/InstructionsPanel';
import { TerminalPane } from '../features/terminal/TerminalPane';
import { ProjectSearchPanel } from '../features/search/ProjectSearchPanel';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { WorkspaceSidebar } from '../features/workspace/WorkspaceSidebar';
import { copyText, getAppVersion, getSettings, listWorkspaceFiles, pingBridge, readWorkspaceFile, saveSettings, saveWorkspaceFile, watchProject, type AppSettings } from '../shared/bridge-client';
import { withActiveInstructionPrompt } from '../shared/copy-with-instructions';
import { formatContextLocation } from '../shared/context-format';
import { applyThemePreference } from '../shared/theme';
import { applyDiskChange, applyPeerSaveResult, applySaveResult, createFileBuffer, updateEditorContent } from '../../../shared/core/file-buffer';
import { createWorkbenchLayout, movePane, panePlacement, parseWorkbenchLayout, resizePane, serializeWorkbenchLayout } from '../../../shared/core/workbench-pane-layout';

type FileBuffer = ReturnType<typeof createFileBuffer>;
type PaneEdge = 'left' | 'right' | 'top' | 'bottom';
type PaneId = 'document' | 'terminal';
type WorkbenchLayout = ReturnType<typeof createWorkbenchLayout>;

const WORKBENCH_LAYOUT_KEY = 'docpilot:workbench-pane-layout';

function readWorkbenchLayout(): WorkbenchLayout {
  const stored = window.localStorage.getItem(WORKBENCH_LAYOUT_KEY);
  if (stored) return parseWorkbenchLayout(stored) as WorkbenchLayout;
  const legacyPosition = window.localStorage.getItem('docpilot:terminal-orientation') === 'horizontal' ? 'right' : 'bottom';
  return createWorkbenchLayout({ terminalPosition: legacyPosition }) as WorkbenchLayout;
}

function applyAppTheme(preference: AppSettings['theme']) {
  applyThemePreference(preference);
  void window.docpilot?.setWindowTheme?.(preference);
}

function readInitialThemePreference(): AppSettings['theme'] {
  const preference = document.documentElement.dataset.themePreference;
  return preference === 'light' || preference === 'dark' || preference === 'system' ? preference : 'system';
}

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
  '2.0.4': [
    {
      title: '설치된 fish를 기본 터미널 셸로 사용합니다',
      body: 'fish가 설치된 Mac에서는 새 내장 터미널이 fish로 열립니다. 설정에서 Default, fish, zsh, bash 중 원하는 셸을 선택할 수도 있습니다.',
    },
    {
      title: '설정에서 fish를 바로 설치할 수 있습니다',
      body: 'Homebrew가 있는 Mac에서는 Terminal 설정의 Install fish 버튼으로 설치하고, 완료되면 fish를 기본 셸로 바로 적용합니다.',
    },
    {
      title: '닫은 터미널 탭을 연결 오류로 표시하지 않습니다',
      body: '사용자가 탭을 닫아 종료한 세션은 정상 종료로 처리해 Terminal session connection lost 경고가 남지 않습니다.',
    },
  ],
  '2.0.3': [
    {
      title: '새 버전을 앱 안에서 안전하게 내려받습니다',
      body: '공식 GitHub Release의 현재 Mac 아키텍처 DMG만 선택하고 파일 크기와 SHA-256을 검증한 뒤 Downloads 폴더에 보관합니다.',
    },
    {
      title: '다운로드가 진행 중인 작업을 멈추지 않습니다',
      body: '업데이트 카드와 다운로드 상태가 terminal·agent 세션, 열린 창과 미저장 문서를 종료하거나 초기화하지 않습니다.',
    },
    {
      title: '서명 없는 배포의 설치 경계를 명확히 표시합니다',
      body: '검증된 DMG를 여는 단계까지만 지원하며, 사용자가 DocPilot을 종료하고 Applications의 앱을 직접 교체하도록 안내합니다.',
    },
    {
      title: '설치 이미지와 Dock 아이콘의 검은 사각형을 제거했습니다',
      body: '투명 PNG와 ICNS를 패키지 및 마운트된 DMG에서 다시 검증해 아이콘 바깥쪽의 불투명 배경이 포함되지 않게 했습니다.',
    },
  ],
  '2.0.2': [
    {
      title: '앱 종료가 백그라운드 작업을 남기지 않습니다',
      body: 'Bridge, watcher, worker, 터미널과 Agent 자식 프로세스를 순서대로 정리해 창을 닫은 뒤 앱이 멈춰 있던 상황을 줄였습니다.',
    },
    {
      title: '워크스페이스 경계를 더 엄격하게 지킵니다',
      body: 'Bridge 요청 인증과 경로 검사를 강화하고 traversal, symlink, 잘못된 요청이 작업공간 밖 파일에 닿지 않도록 방어했습니다.',
    },
    {
      title: '동시 편집과 외부 변경에서 초안을 보호합니다',
      body: '저장 중 파일 변경, 분할 편집, 외부 변경 충돌에서도 사용자 초안을 유지하고 명시적으로 선택한 경우에만 덮어씁니다.',
    },
    {
      title: 'Intel과 Apple Silicon 패키지를 각각 제공합니다',
      body: 'x64와 arm64 앱 및 네이티브 터미널 모듈을 각 아키텍처에 맞춰 패키징하고 독립된 DMG로 검증합니다.',
    },
  ],
  '2.0.1': [
    {
      title: '문서 제목 체계를 다시 맞췄습니다',
      body: 'Markdown과 AsciiDoc 제목의 크기와 굵기를 정리하고 한국어 글꼴을 앱에 포함해 문서마다 달라 보이던 문제를 줄였습니다.',
    },
    {
      title: 'NOTE와 긴 줄 번호가 겹치지 않습니다',
      body: 'AsciiDoc NOTE 안의 긴 권한명과 여러 자리 줄 범위가 본문 밖으로 넘치거나 줄바꿈되어 겹치던 문제를 수정했습니다.',
    },
    {
      title: '프리뷰 폭과 줄 번호를 바로 조절합니다',
      body: '폭 조절선을 항상 은은하게 표시하고 Line numbers 스위치를 상단으로 옮겼습니다. 줄 번호는 기본적으로 꺼져 있습니다.',
    },
    {
      title: '처음 실행할 때 시스템 설정을 따릅니다',
      body: '초기 테마는 macOS 시스템 테마를 사용하며, 프리뷰는 사용 가능한 최대 폭보다 한 단계 좁게 시작합니다.',
    },
    {
      title: '닫힌 터미널을 작업 화면에서 다시 엽니다',
      body: '터미널을 닫은 상태에서도 우측 하단 Terminal 버튼으로 다시 열 수 있습니다.',
    },
  ],
  '2.0.0': [
    {
      title: 'DocPilot 작업 공간을 새로 설계했습니다',
      body: '프로젝트 탐색기, 문서 캔버스, 검토 레일과 터미널을 하나의 차분한 워크벤치로 다시 구성했습니다.',
    },
    {
      title: '기본 셸을 여는 실제 터미널을 제공합니다',
      body: 'Codex나 Claude 전용 실행 화면 대신 사용자의 기본 로그인 셸을 열고, 필요할 때 원하는 도구를 직접 실행할 수 있습니다.',
    },
    {
      title: '문서 탭과 터미널을 원하는 위치에 배치합니다',
      body: '열린 문서 탭을 상하좌우 가장자리로 끌어 분할하고, 터미널 패널도 같은 방식으로 이동할 수 있습니다.',
    },
    {
      title: 'Markdown과 AsciiDoc 검토 흐름을 강화했습니다',
      body: '프리뷰, 인라인 Diff, 변경 목록, 선택 복사와 문서 맥락 수집이 한 화면에서 이어집니다.',
    },
    {
      title: '시작 화면과 제품 아이덴티티를 교체했습니다',
      body: '마지막 테마를 복원하는 프로젝트 시작 화면, 새 DocPilot 아이콘과 일관된 라이트·다크 디자인을 적용했습니다.',
    },
  ],
  '1.0.28': [
    {
      title: '큰 AsciiDoc 문서가 바로 열립니다',
      body: 'AsciiDoc 변환을 별도 worker로 옮기고 프리뷰 계산을 줄여, 큰 manual.adoc 파일도 열 때마다 오래 멈추지 않습니다.',
    },
    {
      title: '프리뷰 스크롤이 더 가벼워졌습니다',
      body: '목차 동기화와 라인 표시 작업을 스크롤 흐름에 맞게 조정해 긴 문서를 빠르게 내려도 끊김을 줄였습니다.',
    },
    {
      title: '편집모드 하이라이트를 보강했습니다',
      body: 'AsciiDoc, Markdown, JSON, JavaScript, TypeScript 편집 화면에 VSCode 2026 Light/Dark 기반 색상 팔레트를 적용했습니다.',
    },
    {
      title: '프리뷰와 편집 위치를 이어갑니다',
      body: '프리뷰에서 편집으로, 편집에서 프리뷰로 전환할 때 현재 보고 있던 위치에 가깝게 이동합니다.',
    },
    {
      title: '문서 패널과 코드블록 가독성을 다듬었습니다',
      body: 'NOTE/WARNING 정보 패널, 코드블록 강조색, 제목 크기 단계를 라이트/다크 테마에 맞춰 다시 조정했습니다.',
    },
  ],
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
      body: '⌘ + Shift + P에서 탭과 스페이스를 선택하고, 언어별 권장 들여쓰기 기준을 적용할 수 있습니다. 들여쓰기 영역도 화면에서 구분됩니다.',
    },
    {
      title: '파일트리 마지막 항목도 편하게 우클릭할 수 있습니다',
      body: '파일트리 하단에 여유 공간을 두고 메뉴 위치를 보정해, 맨 아래 파일에서도 경로 복사 같은 메뉴가 잘리지 않습니다.',
    },
    {
      title: '홈 이동과 주요 단축키를 정리했습니다',
      body: '좌측 상단 DocPilot 로고로 홈 화면에 돌아갈 수 있고, ⌘ + P 빠른 이동과 ⌘ + Shift + P 명령 팔레트 사용법을 매뉴얼에 보강했습니다.',
    },
  ],
  '1.0.26': [
    {
      title: '새 창이 기존 프로젝트를 끊지 않습니다',
      body: '새 창에서 다른 폴더를 열어도 기존 창의 프로젝트와 브리지가 그대로 유지됩니다.',
    },
    {
      title: '검색창을 찾기 중심으로 줄였습니다',
      body: '프리뷰와 편집 모드의 ⌘ + F 창을 더 작게 정리하고, 다른 영역을 클릭하면 닫히도록 했습니다.',
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
    { title: '검색 단축키를 추가했습니다', body: '프리뷰와 편집 모드에서 각각 ⌘ + F 검색을 사용할 수 있습니다.' },
    { title: '파일 트리를 정리했습니다', body: '수정 표시, Markdown/YAML 아이콘, 프리뷰 하이라이트 색을 조정했습니다.' },
  ],
};

const DEFAULT_RELEASE_NOTES: ReleaseNoteItem[] = [
  { title: 'DocPilot이 업데이트되었습니다', body: '이번 버전의 변경사항을 확인한 뒤 문서 작업을 이어갈 수 있습니다.' },
];

const RELEASE_NOTICE_REVISION = 'r1';
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
  const [leftWidth, setLeftWidth] = useState(() => readStoredPanelWidth('docpilot:left-panel-width', 274, 220, 520));
  const [leftCollapsed, setLeftCollapsed] = useState(() => readStoredBoolean('docpilot:left-panel-collapsed', false));
  const [themePreference, setThemePreference] = useState<AppSettings['theme']>(readInitialThemePreference);
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const [suppressMarkdownDocumentReadonlyNotice, setSuppressMarkdownDocumentReadonlyNotice] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(() => readStoredBoolean('docpilot:terminal-open', true));
  const [paneLayout, setPaneLayout] = useState<WorkbenchLayout>(readWorkbenchLayout);
  const [draggingPane, setDraggingPane] = useState<PaneId | null>(null);
  const [paneDropPreview, setPaneDropPreview] = useState<{ paneId: PaneId; edge: PaneEdge } | null>(null);
  const [documentTabDropPreview, setDocumentTabDropPreview] = useState<{ id: string; edge: PaneEdge } | null>(null);
  const [terminalSize, setTerminalSize] = useState(() => readStoredPanelWidth('docpilot:terminal-size', 260, 160, 620));
  const [activePreviewPane, setActivePreviewPane] = useState<'primary' | 'secondary'>('primary');
  const [splitOrientation, setSplitOrientation] = useState<'horizontal' | 'vertical'>(() => {
    const stored = window.localStorage.getItem('docpilot:preview-split-orientation');
    return stored === 'vertical' ? 'vertical' : 'horizontal';
  });
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState('');
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);
  const [quickOpenRecent, setQuickOpenRecent] = useState<string[]>(() => readStoredStringList('docpilot:quick-open-recent'));
  const [releaseNotice, setReleaseNotice] = useState<ReleaseNotice | null>(null);
  const [updateState, setUpdateState] = useState<DocPilotUpdateState>({ status: 'idle' });
  const [updateCardVisible, setUpdateCardVisible] = useState(false);
  const dismissedUpdateVersionRef = useRef('');
  const openPathRef = useRef('');
  const secondaryOpenPathRef = useRef('');
  const activePreviewPaneRef = useRef<'primary' | 'secondary'>('primary');
  const draggedDocumentTabRef = useRef<{ id: string; pane: 'primary' | 'secondary' } | null>(null);
  const savingRef = useRef(false);
  const menuSaveRef = useRef<() => void>(() => {});
  const documentFlushRef = useRef<() => string | null>(() => null);
  const menuUpdateCheckRef = useRef<() => void>(() => {});
  const manualUpdateCheckVisibleRef = useRef(false);
  const bufferRef = useRef(buffer);
  const bufferEditGenerationRef = useRef(0);
  const primaryOpenRequestRef = useRef(0);
  const secondaryOpenRequestRef = useRef(0);
  bufferRef.current = buffer;
  const committedTerminalPosition = (panePlacement(paneLayout, 'terminal', 'document') || 'bottom') as PaneEdge;
  const previewPaneLayout = useMemo(() => {
    if (!paneDropPreview) return paneLayout;
    const targetId = paneDropPreview.paneId === 'terminal' ? 'document' : 'terminal';
    return movePane(paneLayout, paneDropPreview.paneId, targetId, paneDropPreview.edge) as WorkbenchLayout;
  }, [paneDropPreview, paneLayout]);
  const terminalPosition = (panePlacement(previewPaneLayout, 'terminal', 'document') || committedTerminalPosition) as PaneEdge;

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
    window.localStorage.setItem('docpilot:terminal-open', terminalOpen ? '1' : '0');
    window.localStorage.setItem('docpilot:terminal-orientation', committedTerminalPosition === 'left' || committedTerminalPosition === 'right' ? 'horizontal' : 'vertical');
    window.localStorage.setItem('docpilot:terminal-size', String(Math.round(terminalSize)));
    window.localStorage.setItem(WORKBENCH_LAYOUT_KEY, serializeWorkbenchLayout(paneLayout));
  }, [committedTerminalPosition, paneLayout, terminalOpen, terminalSize]);

  menuSaveRef.current = () => {
    const flushed = documentFlushRef.current();
    void saveFile(flushed ?? undefined);
  };

  menuUpdateCheckRef.current = () => {
    void runManualUpdateCheck();
  };

  useEffect(() => {
    if (!autosaveEnabled || !buffer.path || !buffer.dirtyByUser || buffer.conflictState.includes('conflict')) return;
    const timer = window.setTimeout(() => menuSaveRef.current(), 750);
    return () => window.clearTimeout(timer);
  }, [autosaveEnabled, buffer.conflictState, buffer.dirtyByUser, buffer.editorContent, buffer.lastSavedRevision, buffer.path]);

  useEffect(() => {
    const bridge = window.docpilot;
    if (!bridge?.onMenuCommand) return;
    return bridge.onMenuCommand(command => {
      if (command === 'save') menuSaveRef.current();
      if (command === 'check-update') menuUpdateCheckRef.current();
    });
  }, []);

  useEffect(() => {
    const bridge = window.docpilot;
    if (!bridge) return;
    let disposed = false;
    const applyUpdateState = (nextState: DocPilotUpdateState) => {
      if (disposed || !nextState || nextState.status === 'idle') return;
      setUpdateState(nextState);
      const updateAvailable = ['available', 'downloading', 'downloaded'].includes(nextState.status);
      const downloadError = nextState.status === 'error' && Boolean(nextState.version);
      if (
        manualUpdateCheckVisibleRef.current
        || downloadError
        || (updateAvailable && dismissedUpdateVersionRef.current !== nextState.version)
      ) {
        setUpdateCardVisible(true);
      }
    };
    void bridge.getUpdateState?.().then(applyUpdateState).catch(() => {});
    const disposeListener = bridge.onUpdateState?.(applyUpdateState);
    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, []);

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
  const homeRecentFiles = useMemo(() => {
    const visibleFiles = new Set(workspaceFiles);
    return quickOpenRecent.filter(file => visibleFiles.has(file)).slice(0, 5);
  }, [quickOpenRecent, workspaceFiles]);
  const homeSuggestedFiles = useMemo(() => {
    const recent = new Set(homeRecentFiles);
    return workspaceFiles.filter(file => !recent.has(file)).slice(0, 6);
  }, [homeRecentFiles, workspaceFiles]);
  const showHome = !buffer.path && !secondaryBuffer.path;

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
    let currentThemePreference: AppSettings['theme'] = readInitialThemePreference();
    const applyFromSettings = () => {
      getSettings()
        .then(response => {
          currentThemePreference = response.settings.theme;
          setThemePreference(response.settings.theme);
          setAutosaveEnabled(response.settings.autosave);
          setSuppressMarkdownDocumentReadonlyNotice(response.settings.suppressMarkdownVisualReadonlyNotice);
          applyAppTheme(currentThemePreference);
        })
        .catch(() => applyAppTheme(currentThemePreference));
    };
    const onSettingsSaved = (event: Event) => {
      const settings = (event as CustomEvent).detail?.settings;
      if (settings) {
        setAutosaveEnabled(settings.autosave === true);
        setSuppressMarkdownDocumentReadonlyNotice(settings.suppressMarkdownVisualReadonlyNotice === true);
        currentThemePreference = settings.theme;
        setThemePreference(settings.theme);
        applyAppTheme(currentThemePreference);
      } else {
        applyFromSettings();
      }
    };
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const onSystemThemeChange = () => applyAppTheme(currentThemePreference);
    applyFromSettings();
    window.addEventListener('docpilot-settings-saved', onSettingsSaved);
    media?.addEventListener?.('change', onSystemThemeChange);
    return () => {
      window.removeEventListener('docpilot-settings-saved', onSettingsSaved);
      media?.removeEventListener?.('change', onSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const requestSequences = new Map<string, number>();
    const refreshOpenDiskFiles = (force = false) => {
      if (!force && document.visibilityState === 'hidden') return;
      const openPaths = Array.from(new Set([openPathRef.current, secondaryOpenPathRef.current].filter(Boolean)));
      if (!openPaths.length) return;
      openPaths.forEach(openPath => {
        const sequence = (requestSequences.get(openPath) || 0) + 1;
        requestSequences.set(openPath, sequence);
        readWorkspaceFile(openPath)
          .then(file => {
            if (disposed || requestSequences.get(openPath) !== sequence) return;
            applyExternalDiskContent(file.id, file.content, file.revision);
            setOpenError('');
          })
          .catch(err => {
            if (disposed || requestSequences.get(openPath) !== sequence) return;
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
      refreshOpenDiskFiles(true);
    }, () => {
      setBridgeState('disconnected');
      setBridgeMessage('브리지 연결이 끊겼습니다.');
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshOpenDiskFiles(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const poll = window.setInterval(refreshOpenDiskFiles, 10000);
    return () => {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
    applyAppTheme(nextTheme);
    try {
      const response = await getSettings();
      const saved = await saveSettings({ ...response.settings, theme: nextTheme });
      setThemePreference(saved.settings.theme);
      applyAppTheme(saved.settings.theme);
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: saved.settings } }));
    } catch {
      // Keep the immediate visual toggle even if settings persistence is unavailable.
    }
  }

  async function suppressDocumentReadonlyNotice() {
    setSuppressMarkdownDocumentReadonlyNotice(true);
    try {
      const response = await getSettings();
      const saved = await saveSettings({ ...response.settings, suppressMarkdownVisualReadonlyNotice: true });
      setSuppressMarkdownDocumentReadonlyNotice(saved.settings.suppressMarkdownVisualReadonlyNotice);
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: saved.settings } }));
    } catch {
      // Keep the current-session suppression even when persistence is unavailable.
    }
  }

  useEffect(() => {
    const openFileRel = new URLSearchParams(window.location.search).get('open');
    if (openFileRel) openFile(openFileRel);
  }, []);

  async function openFile(id: string, options: { keepReview?: boolean } = {}) {
    const requestId = ++primaryOpenRequestRef.current;
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
      if (requestId !== primaryOpenRequestRef.current) return;
      openPathRef.current = file.id;
      setBuffer(createFileBuffer({ path: file.id, content: file.content, revision: file.revision }));
      setActivePane('primary');
      if (!options.keepReview) setReviewDiff(null);
      setSelectedContext(null);
      setContextChips(current => current.filter(item => item.fileId !== file.id));
      setOpenError('');
      rememberQuickOpenFile(file.id);
    } catch (err) {
      if (requestId !== primaryOpenRequestRef.current) return;
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyExternalDiskContent(fileId: string, content: string, revision = '') {
    const applyToBuffer = (current: FileBuffer) => {
      if (current.path !== fileId) return current;
      return applyDiskChange(current, content, 'external', revision);
    };
    setBuffer(applyToBuffer);
    setSecondaryBuffer(applyToBuffer);
    setOpenTabs(current => updateOpenTabsForDiskChange(current, fileId, content, revision));
    setSecondaryOpenTabs(current => updateOpenTabsForDiskChange(current, fileId, content, revision));
  }

  async function openFileInSplit(id: string, orientation: 'horizontal' | 'vertical' = splitOrientation) {
    const requestId = ++secondaryOpenRequestRef.current;
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
      if (requestId !== secondaryOpenRequestRef.current) return;
      setSplitOrientation(orientation);
      secondaryOpenPathRef.current = file.id;
      setSecondaryBuffer(createFileBuffer({ path: file.id, content: file.content, revision: file.revision }));
      setActivePane('secondary');
      setOpenError('');
      rememberQuickOpenFile(file.id);
    } catch (err) {
      if (requestId !== secondaryOpenRequestRef.current) return;
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  function openCurrentFileInSplit(orientation: 'horizontal' | 'vertical' = splitOrientation) {
    if (!buffer.path) return;
    secondaryOpenRequestRef.current += 1;
    setSplitOrientation(orientation);
    secondaryOpenPathRef.current = buffer.path;
    setSecondaryBuffer({ ...buffer });
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
    secondaryOpenRequestRef.current += 1;
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
    primaryOpenRequestRef.current += 1;
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
    primaryOpenRequestRef.current += 1;
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
    secondaryOpenRequestRef.current += 1;
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
    secondaryOpenRequestRef.current += 1;
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

  async function openDocumentTabAtEdge(id: string, edge: PaneEdge) {
    const orientation = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';
    const leading = edge === 'left' || edge === 'top';
    try {
      const known = [...openTabs, ...secondaryOpenTabs].find(tab => tab.id === id)?.buffer;
      let loaded = known;
      if (!loaded) {
        const file = await readWorkspaceFile(id);
        if (!file) throw new Error(`${id} 파일을 열 수 없습니다.`);
        loaded = createFileBuffer({ path: file.id, content: file.content, revision: file.revision });
      }
      const alternatives = [...openTabs, ...secondaryOpenTabs]
        .map(tab => tab.buffer)
        .filter(tabBuffer => tabBuffer.path && tabBuffer.path !== id);
      const counterpart = (buffer.path && buffer.path !== id ? buffer : null)
        || (secondaryBuffer.path && secondaryBuffer.path !== id ? secondaryBuffer : null)
        || alternatives[0]
        || loaded;

      setSplitOrientation(orientation);
      if (leading) {
        openPathRef.current = loaded.path;
        secondaryOpenPathRef.current = counterpart.path;
        setBuffer(loaded);
        setSecondaryBuffer(counterpart);
        setActivePane('primary');
      } else {
        if (!buffer.path || buffer.path === id) {
          openPathRef.current = counterpart.path;
          setBuffer(counterpart);
        }
        secondaryOpenPathRef.current = loaded.path;
        setSecondaryBuffer(loaded);
        setActivePane('secondary');
      }
      setOpenError('');
      rememberQuickOpenFile(id);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    } finally {
      setDocumentTabDropPreview(null);
      draggedDocumentTabRef.current = null;
    }
  }

  function previewDocumentTabDrop(event: ReactDragEvent<HTMLDivElement>) {
    const dragged = draggedDocumentTabRef.current;
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = paneEdgeAtPoint(bounds, event.clientX, event.clientY);
    setDocumentTabDropPreview(edge ? { id: dragged.id, edge } : null);
  }

  function finishDocumentTabDrop(event: ReactDragEvent<HTMLDivElement>) {
    const dragged = draggedDocumentTabRef.current;
    const edge = documentTabDropPreview?.edge;
    if (!dragged || !edge) return;
    event.preventDefault();
    void openDocumentTabAtEdge(dragged.id, edge);
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
      if (mod && event.shiftKey && key === 'f') {
        event.preventDefault();
        event.stopPropagation();
        setLeftCollapsed(false);
        setProjectSearchOpen(true);
        return;
      }
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
      if (!quickOpenOpen) {
        if (projectSearchOpen && event.key === 'Escape') {
          event.preventDefault();
          setProjectSearchOpen(false);
        }
        return;
      }
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
  }, [activePreviewPane, buffer.path, buffer.editorContent, openTabs, projectSearchOpen, quickOpenIndex, quickOpenOpen, quickOpenResults, secondaryBuffer, secondaryOpenTabs, splitOrientation]);

  async function saveFile(contentOverride?: string) {
    const liveBuffer = bufferRef.current;
    if (!liveBuffer.path || savingRef.current) return;
    if (contentOverride === undefined && !liveBuffer.dirtyByUser) return;
    const bufferToSave = contentOverride === undefined
      ? liveBuffer
      : updateEditorContent(liveBuffer, contentOverride);
    const savedPath = bufferToSave.path;
    const savedContent = bufferToSave.editorContent;
    bufferRef.current = bufferToSave;
    setBuffer(bufferToSave);
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await saveWorkspaceFile(savedPath, savedContent, bufferToSave.lastSavedRevision);
      setBuffer(current => applySaveResult(current, savedPath, savedContent, result.revision));
      setSecondaryBuffer(current => applyPeerSaveResult(current, savedPath, savedContent, result.revision));
      setOpenTabs(current => updateOpenTabsForSave(current, savedPath, savedContent, result.revision));
      setSecondaryOpenTabs(current => updateOpenTabsForSave(current, savedPath, savedContent, result.revision, true));
      setOpenError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('파일이 디스크에서 변경되었습니다')) {
        try {
          const disk = await readWorkspaceFile(savedPath);
          applyExternalDiskContent(disk.id, disk.content, disk.revision);
        } catch {}
      }
      setOpenError(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function applyPreviewSourceEdit(request: { fileId: string; expectedContent: string; nextContent: string; saveAfter: boolean }) {
    const current = bufferRef.current;
    if (
      current.path !== request.fileId
      || current.editorContent !== request.expectedContent
      || savingRef.current
    ) {
      return false;
    }

    const nextBuffer = updateEditorContent(current, request.nextContent);
    bufferEditGenerationRef.current += 1;
    bufferRef.current = nextBuffer;
    setBuffer(nextBuffer);
    if (!request.saveAfter) return true;

    savingRef.current = true;
    setSaving(true);
    try {
      const result = await saveWorkspaceFile(request.fileId, request.nextContent, current.lastSavedRevision);
      setBuffer(active => applySaveResult(active, request.fileId, request.nextContent, result.revision));
      setSecondaryBuffer(active => applyPeerSaveResult(active, request.fileId, request.nextContent, result.revision));
      setOpenTabs(active => updateOpenTabsForSave(active, request.fileId, request.nextContent, result.revision));
      setSecondaryOpenTabs(active => updateOpenTabsForSave(active, request.fileId, request.nextContent, result.revision, true));
      setOpenError('');
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    return true;
  }

  async function reloadConflictFromDisk() {
    const filePath = buffer.path;
    if (!filePath) return;
    if (buffer.dirtyByUser && !window.confirm('현재 편집 내용은 사라집니다. 디스크 버전을 불러올까요?')) return;
    const editGeneration = bufferEditGenerationRef.current;
    const editorContent = buffer.editorContent;
    try {
      const file = await readWorkspaceFile(filePath);
      const current = bufferRef.current;
      if (
        current.path !== filePath
        || current.editorContent !== editorContent
        || bufferEditGenerationRef.current !== editGeneration
      ) {
        setOpenError('불러오는 동안 편집 상태가 바뀌어 디스크 버전을 적용하지 않았습니다. 다시 시도하세요.');
        return;
      }
      const fresh = createFileBuffer({ path: file.id, content: file.content, revision: file.revision });
      setBuffer(fresh);
      setSecondaryBuffer(currentBuffer => (
        currentBuffer.path === file.id && !currentBuffer.dirtyByUser ? fresh : currentBuffer
      ));
      setOpenError('');
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  async function overwriteConflictWithLocal() {
    if (!buffer.path || savingRef.current) return;
    if (!window.confirm('디스크에서 변경된 내용을 현재 편집 내용으로 덮어쓸까요?')) return;
    const savedPath = buffer.path;
    const savedContent = buffer.editorContent;
    savingRef.current = true;
    setSaving(true);
    try {
      const latest = await readWorkspaceFile(savedPath);
      const result = await saveWorkspaceFile(savedPath, savedContent, latest.revision);
      setBuffer(current => applySaveResult(current, savedPath, savedContent, result.revision));
      setSecondaryBuffer(current => applyPeerSaveResult(current, savedPath, savedContent, result.revision));
      setOpenTabs(current => updateOpenTabsForSave(current, savedPath, savedContent, result.revision));
      setSecondaryOpenTabs(current => updateOpenTabsForSave(current, savedPath, savedContent, result.revision, true));
      setOpenError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('파일이 디스크에서 변경되었습니다')) {
        try {
          const disk = await readWorkspaceFile(savedPath);
          applyExternalDiskContent(disk.id, disk.content, disk.revision);
        } catch {}
      }
      setOpenError(message);
    } finally {
      savingRef.current = false;
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

  async function runUpdateAction() {
    const bridge = window.docpilot;
    if (!bridge) return;
    try {
      if (updateState.status === 'downloaded') {
        await bridge.openDownloadedUpdate?.();
        return;
      }
      const nextState = await bridge.downloadUpdate?.();
      if (nextState) setUpdateState(nextState);
    } catch (error) {
      setUpdateState(current => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : '업데이트 다운로드에 실패했습니다.',
      }));
    }
  }

  async function runManualUpdateCheck() {
    const bridge = window.docpilot;
    if (!bridge?.checkForUpdates) return;
    manualUpdateCheckVisibleRef.current = true;
    setUpdateState({ status: 'checking' });
    setUpdateCardVisible(true);
    try {
      const nextState = await bridge.checkForUpdates();
      if (nextState) setUpdateState(nextState);
    } catch (error) {
      setUpdateState({
        status: 'error',
        error: error instanceof Error ? error.message : '업데이트 확인에 실패했습니다.',
      });
    } finally {
      manualUpdateCheckVisibleRef.current = false;
    }
  }

  function openUpdateReleaseNotes() {
    if (updateState.releaseUrl) void window.docpilot?.openUrl?.(updateState.releaseUrl);
  }

  function goHome() {
    if (dirtyFileIds.length) {
      setOpenError('저장되지 않은 변경사항이 있어 홈으로 이동하지 않았습니다. 먼저 저장하거나 탭을 닫아주세요.');
      return;
    }

    primaryOpenRequestRef.current += 1;
    secondaryOpenRequestRef.current += 1;
    openPathRef.current = '';
    secondaryOpenPathRef.current = '';
    setBuffer(createFileBuffer());
    setSecondaryBuffer(createFileBuffer());
    setOpenTabs([]);
    setSecondaryOpenTabs([]);
    setActiveTabId('');
    setSecondaryActiveTabId('');
    setActivePane('primary');
    setReviewDiff(null);
    setSelectedContext(null);
    setContextChips([]);
    setQuickOpenOpen(false);
    setOpenError('');
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

  function startTerminalResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const stack = event.currentTarget.parentElement;
    if (!stack) return;
    const bounds = stack.getBoundingClientRect();
    document.body.classList.add('resizing-panels');
    const move = (moveEvent: globalThis.MouseEvent) => {
      const horizontal = committedTerminalPosition === 'left' || committedTerminalPosition === 'right';
      const rawSize = committedTerminalPosition === 'left'
        ? moveEvent.clientX - bounds.left
        : committedTerminalPosition === 'right'
          ? bounds.right - moveEvent.clientX
          : committedTerminalPosition === 'top'
            ? moveEvent.clientY - bounds.top
            : bounds.bottom - moveEvent.clientY;
      const next = Math.max(160, Math.min(620, rawSize));
      const total = horizontal ? bounds.width : bounds.height;
      setTerminalSize(next);
      setPaneLayout(current => resizePane(current, 'terminal', next / Math.max(1, total)) as WorkbenchLayout);
    };
    const stop = () => {
      document.body.classList.remove('resizing-panels');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop, { once: true });
  }

  function moveWorkbenchPane(paneId: PaneId, edge: PaneEdge) {
    const targetId = paneId === 'terminal' ? 'document' : 'terminal';
    setPaneLayout(current => movePane(current, paneId, targetId, edge) as WorkbenchLayout);
    setPaneDropPreview(null);
  }

  function finishPaneDrag() {
    setPaneDropPreview(null);
    setDraggingPane(null);
    document.body.classList.remove('dragging-workbench-pane');
  }

  function beginPanePointerDrag(event: ReactPointerEvent<HTMLElement>, paneId: PaneId) {
    if (event.button !== 0 || !terminalOpen) return;
    event.preventDefault();
    const stack = event.currentTarget.closest('.workbench-stack');
    if (!(stack instanceof HTMLElement)) return;
    const bounds = stack.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const source = event.currentTarget;
    let active = false;
    let previewEdge: PaneEdge | null = null;

    source.setPointerCapture?.(pointerId);

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
      if (!active) {
        active = true;
        document.body.classList.add('dragging-workbench-pane');
        setDraggingPane(paneId);
      }
      previewEdge = paneEdgeAtPoint(bounds, moveEvent.clientX, moveEvent.clientY);
      setPaneDropPreview(previewEdge ? { paneId, edge: previewEdge } : null);
    };

    const stop = (stopEvent: PointerEvent, commit: boolean) => {
      if (stopEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      try { source.releasePointerCapture?.(pointerId); } catch {}
      if (active && commit && previewEdge) moveWorkbenchPane(paneId, previewEdge);
      finishPaneDrag();
    };
    const onPointerUp = (stopEvent: PointerEvent) => stop(stopEvent, true);
    const onPointerCancel = (stopEvent: PointerEvent) => stop(stopEvent, false);

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function movePaneFromKeyboard(event: ReactKeyboardEvent<HTMLElement>, paneId: PaneId) {
    if (!event.altKey) return;
    const edge = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' } as Record<string, PaneEdge>)[event.key];
    if (!edge) return;
    event.preventDefault();
    moveWorkbenchPane(paneId, edge);
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
                draggedDocumentTabRef.current = { id: tab.id, pane };
                document.body.classList.add('dragging-document-tab');
              }}
              onDragEnd={() => {
                draggedDocumentTabRef.current = null;
                setDocumentTabDropPreview(null);
                document.body.classList.remove('dragging-document-tab');
              }}
              onDragOver={event => {
                const dragPane = event.dataTransfer.getData('application/x-docpilot-tab-pane');
                if (dragPane && dragPane !== pane) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={event => {
                event.preventDefault();
                event.stopPropagation();
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
          <span
            className="document-tabbar-drag-surface"
            draggable={false}
            role="button"
            tabIndex={terminalOpen ? 0 : -1}
            aria-label="Drag document pane from tab bar. Use Alt plus arrow keys to move."
            title="Drag document pane"
            onPointerDown={event => beginPanePointerDrag(event, 'document')}
            onKeyDown={event => movePaneFromKeyboard(event, 'document')}
          />
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
          <button className="app-logo" type="button" onClick={goHome} aria-label="홈으로 이동">
            <span className="app-logo-mark" aria-hidden="true"><FileText size={15} weight="regular" /></span>
            <span>DocPilot</span>
          </button>
          <span className="topbar-chip" title={workspaceRoot}>
            <span className="topbar-chip-label">Workspace</span>
            <span className="topbar-chip-value">{folderName(workspaceRoot) || '...'}</span>
          </span>
          <span className="topbar-crumb" title={buffer.path || undefined}>{buffer.path || '파일을 선택하세요'}</span>
        </div>
        <div className="topbar-right">
          <div className="theme-toggle" aria-label="테마 전환">
            <button
              className={themePreference === 'light' ? 'active' : ''}
              type="button"
              onClick={() => setTopbarTheme('light')}
            >
              <Sun size={14} aria-hidden="true" />
              <span>Light</span>
            </button>
            <button
              className={themePreference !== 'light' ? 'active' : ''}
              type="button"
              onClick={() => setTopbarTheme('dark')}
            >
              <Moon size={14} aria-hidden="true" />
              <span>Dark</span>
            </button>
          </div>
          <button
            className={`topbar-icon-button ${terminalOpen ? 'active' : ''}`}
            type="button"
            aria-label={terminalOpen ? 'Close terminal pane' : 'Open terminal pane'}
            title={terminalOpen ? 'Close terminal pane' : 'Open terminal pane'}
            onClick={() => setTerminalOpen(current => !current)}
          >
            <TerminalWindow size={16} />
          </button>
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
          <button className="panel-rail-open-button" type="button" aria-label="Open project panel" title="Open project panel" onClick={() => setLeftCollapsed(false)}>
            <SidebarSimple size={18} weight="regular" />
          </button>
        </aside>
      ) : projectSearchOpen ? (
        <ProjectSearchPanel
          files={workspaceFiles}
          onClose={() => setProjectSearchOpen(false)}
          onOpenFile={fileId => {
            openFile(fileId);
          }}
        />
      ) : (
        <WorkspaceSidebar
          activeFile={buffer.path}
          dirtyFileIds={dirtyFileIds}
          refreshSignal={workspaceRefreshSignal}
          instructionsPanel={<InstructionsPanel />}
          settingsPanel={<SettingsPanel />}
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
        <div className="quick-open-overlay" role="dialog" aria-modal="true" aria-label="파일 빠른 이동" onClick={closeQuickOpen}>
          <div className="quick-open-panel" onClick={event => event.stopPropagation()}>
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
        <div className="release-notice-overlay" role="dialog" aria-modal="true" aria-label="새 버전 안내" onClick={closeReleaseNotice}>
          <section className="release-notice-modal" onClick={event => event.stopPropagation()}>
            <header>
              <div className="release-notice-brand">
                <span className="release-notice-mark" aria-hidden="true"><FileText size={15} weight="regular" /></span>
                <span>DocPilot</span>
              </div>
              <span className="release-notice-version">v{releaseNotice.version}</span>
              <button type="button" aria-label="새 버전 안내 닫기" onClick={closeReleaseNotice}><X size={16} /></button>
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
              <button type="button" onClick={closeReleaseNotice}><Check size={15} />확인</button>
            </footer>
          </section>
        </div>
      ) : null}
      {updateCardVisible ? (
        <aside className="update-card" role="dialog" aria-label="업데이트 확인" aria-live="polite">
          <header>
            <div>
              <span className="update-card-icon" aria-hidden="true"><DownloadSimple size={16} weight="bold" /></span>
              <strong>{updateState.status === 'checking'
                ? '업데이트 확인 중'
                : updateState.status === 'latest'
                  ? '최신 버전'
                  : updateState.status === 'error' && !updateState.version
                    ? '확인 실패'
                    : '업데이트 가능'}</strong>
            </div>
            <button
              type="button"
              aria-label="업데이트 안내 닫기"
              onClick={() => {
                dismissedUpdateVersionRef.current = updateState.version || '';
                setUpdateCardVisible(false);
              }}
            ><X size={17} /></button>
          </header>
          <div className="update-card-body">
            {updateState.status === 'checking' ? (
              <p className="update-card-version" role="status">공식 릴리즈와 현재 버전을 비교하고 있습니다…</p>
            ) : updateState.status === 'latest' ? (
              <p className="update-card-version">DocPilot v{updateState.version}은(는) 최신 버전입니다.</p>
            ) : updateState.version ? (
              <p className="update-card-version">DocPilot v{updateState.version}이(가) 준비되었습니다.</p>
            ) : null}
            {['available', 'downloading', 'downloaded'].includes(updateState.status) ? (
              <p className="update-card-preservation">다운로드 중에도 terminal·agent 세션과 편집 중인 문서는 유지됩니다.</p>
            ) : null}
            {updateState.status === 'downloading' ? (
              <div className="update-card-progress" role="status" aria-label={`업데이트 ${updateState.percent || 0}% 다운로드됨`}>
                <span style={{ width: `${updateState.percent || 0}%` }} />
              </div>
            ) : null}
            {updateState.status === 'downloaded' ? (
              <p className="update-card-status">SHA-256 검증을 마쳤습니다. DMG를 열어 Applications의 앱을 직접 교체하세요.</p>
            ) : null}
            {updateState.status === 'error' ? (
              <p className="update-card-error" role="alert">{updateState.error || (updateState.version ? '업데이트 다운로드에 실패했습니다.' : '업데이트 확인에 실패했습니다.')}</p>
            ) : null}
            {updateState.releaseUrl ? (
              <button className="update-release-link" type="button" onClick={openUpdateReleaseNotes}>
                릴리즈 노트 <ArrowSquareOut size={13} />
              </button>
            ) : null}
          </div>
          {updateState.status === 'latest' ? null : <footer>
            <button
              className="update-primary-action"
              type="button"
              disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
              onClick={() => updateState.status === 'error' && !updateState.version
                ? void runManualUpdateCheck()
                : void runUpdateAction()}
            >
              {updateState.status === 'checking'
                ? '확인 중…'
                : updateState.status === 'downloading'
                ? `다운로드 중 ${updateState.percent || 0}%`
                : updateState.status === 'downloaded'
                  ? 'DMG 열기'
                  : updateState.status === 'error' && !updateState.version
                    ? '다시 확인'
                    : updateState.status === 'error'
                    ? '다시 다운로드'
                    : '업데이트 다운로드'}
            </button>
          </footer>}
        </aside>
      ) : null}
      <section
        className={`editor-stack workbench-stack terminal-${terminalPosition} ${terminalOpen && !showHome ? 'with-terminal' : ''} ${draggingPane ? 'pane-dragging' : ''} ${paneDropPreview ? 'pane-layout-preview' : ''}`}
        style={{ '--terminal-pane-size': `${terminalSize}px` } as CSSProperties}
      >
        <div
          className={`workbench-document-pane ${documentTabDropPreview ? 'document-tab-drop-active' : ''}`}
          data-pane-id="document"
          onDragOver={previewDocumentTabDrop}
          onDrop={finishDocumentTabDrop}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDocumentTabDropPreview(null);
          }}
        >
          {!showHome && terminalOpen ? (
            <button
              className="document-pane-drag-handle"
              type="button"
              draggable={false}
              aria-label="Drag document pane. Use Alt plus arrow keys to move."
              title="Drag document pane"
              onPointerDown={event => beginPanePointerDrag(event, 'document')}
              onKeyDown={event => movePaneFromKeyboard(event, 'document')}
            >
              <DotsSixVertical size={16} weight="bold" />
            </button>
          ) : null}
          {showHome ? (
          <HomeScreen
            workspaceRoot={workspaceRoot}
            bridgeState={bridgeState}
            fileCount={workspaceFiles.length}
            recentFiles={homeRecentFiles}
            suggestedFiles={homeSuggestedFiles}
            error={openError}
            onQuickOpen={openQuickOpen}
            onOpenFile={openFile}
          />
          ) : (
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
            onChange={content => {
              bufferEditGenerationRef.current += 1;
              setBuffer(current => updateEditorContent(current, content));
            }}
            onApplySourceEdit={applyPreviewSourceEdit}
            onSave={saveFile}
            suppressMarkdownDocumentReadonlyNotice={suppressMarkdownDocumentReadonlyNotice}
            onSuppressMarkdownDocumentReadonlyNotice={suppressDocumentReadonlyNotice}
            onRegisterDocumentFlush={flush => { documentFlushRef.current = flush || (() => null); }}
            onReloadConflict={reloadConflictFromDisk}
            onOverwriteConflict={overwriteConflictWithLocal}
            onCloseSecondary={closeSplitPreview}
            onOpenCurrentInSplit={openCurrentFileInSplit}
            onActivePreviewPaneChange={setActivePane}
            onSplitOrientationChange={setSplitOrientation}
            />
          )}
          {documentTabDropPreview ? (
            <div
              className={`document-tab-drop-preview edge-${documentTabDropPreview.edge}`}
              data-edge={documentTabDropPreview.edge}
              aria-hidden="true"
            />
          ) : null}
        </div>
        {!terminalOpen ? (
          <button className="terminal-reopen-button" type="button" aria-label="Open terminal pane" onClick={() => setTerminalOpen(true)}>
            <TerminalWindow size={16} />
            <span>Terminal</span>
          </button>
        ) : null}
        {terminalOpen && !showHome ? (
          <>
            <div className="terminal-split-resizer" role="separator" aria-label="Terminal pane size" onMouseDown={startTerminalResize} />
            <TerminalPane
              position={terminalPosition}
              theme={themePreference === 'light' ? 'light' : 'dark'}
              onPositionChange={edge => moveWorkbenchPane('terminal', edge)}
              onPanePointerDown={event => beginPanePointerDrag(event, 'terminal')}
              onPaneKeyDown={event => movePaneFromKeyboard(event, 'terminal')}
              onClose={() => setTerminalOpen(false)}
            />
          </>
        ) : null}
        {draggingPane ? <div className="pane-drop-overlay" aria-hidden="true" /> : null}
      </section>
    </main>
  );
}

function HomeScreen({
  workspaceRoot,
  bridgeState,
  fileCount,
  recentFiles,
  suggestedFiles,
  error,
  onQuickOpen,
  onOpenFile,
}: {
  workspaceRoot: string;
  bridgeState: 'checking' | 'connected' | 'disconnected';
  fileCount: number;
  recentFiles: string[];
  suggestedFiles: string[];
  error: string;
  onQuickOpen: () => void;
  onOpenFile: (id: string) => void;
}) {
  const firstFile = recentFiles[0] || suggestedFiles[0] || '';
  const projectName = folderName(workspaceRoot) || 'Workspace';
  const visibleFiles = recentFiles.length ? recentFiles.slice(0, 6) : suggestedFiles.slice(0, 6);
  const statusLabel = bridgeState === 'connected' ? 'Local project' : bridgeState === 'checking' ? 'Connecting' : 'Offline';
  return (
    <div className="home-screen">
      <div className="home-content">
        <section className="home-project-header" aria-label="DocPilot 홈">
          <div className="home-project-heading">
            <span className="home-eyebrow">Project</span>
            <div className="home-project-title-row">
              <FolderOpen size={22} weight="regular" aria-hidden="true" />
              <h1>{projectName}</h1>
            </div>
            <p title={workspaceRoot || undefined}>{workspaceRoot || '작업공간 연결 대기 중'}</p>
            <div className={`home-project-status ${bridgeState}`}>
              <span className="home-project-status-dot" />
              <span>{statusLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{fileCount.toLocaleString()} documents</span>
            </div>
          </div>
          <div className="home-actions" aria-label="빠른 작업">
            <button type="button" aria-label="Quick open" onClick={onQuickOpen} disabled={!fileCount}>
              <MagnifyingGlass size={16} weight="regular" />
              <span>Quick open</span>
              <kbd>⌘P</kbd>
            </button>
            <button type="button" aria-label="Open recent document" onClick={() => firstFile && onOpenFile(firstFile)} disabled={!firstFile}>
              <ClockCounterClockwise size={16} weight="regular" />
              <span>Open recent</span>
            </button>
          </div>
        </section>

        {error ? <div className="home-error">{error}</div> : null}

        <section className="home-recent-section">
          <header>
            <div>
              <span className="home-section-kicker">Documents</span>
              <h2>Recent documents</h2>
            </div>
            <button className="home-icon-action" type="button" aria-label="Quick open recent documents" title="Quick open" onClick={onQuickOpen} disabled={!fileCount}>
              <MagnifyingGlass size={17} weight="regular" />
            </button>
          </header>
          <div className="home-file-list">
            {visibleFiles.map(file => (
              <button type="button" key={file} onClick={() => onOpenFile(file)}>
                <FileText size={17} weight="regular" aria-hidden="true" />
                <span className="home-file-copy">
                  <strong>{pathFileName(file)}</strong>
                  <small>{parentPath(file) || projectName}</small>
                </span>
                <ArrowRight className="home-file-arrow" size={16} weight="regular" aria-hidden="true" />
              </button>
            ))}
            {!fileCount ? <div className="home-empty">열 수 있는 문서가 없습니다</div> : null}
          </div>
        </section>

        <footer className="home-workflow" aria-label="DocPilot workflow">
          <span>Open a document</span>
          <ArrowRight size={13} aria-hidden="true" />
          <span>Edit or preview</span>
          <ArrowRight size={13} aria-hidden="true" />
          <span>Review changes</span>
        </footer>
      </div>
    </div>
  );
}

function upsertOpenTab(tabs: OpenFileTab[], buffer: FileBuffer): OpenFileTab[] {
  if (!buffer.path) return tabs;
  const nextTab = { id: buffer.path, buffer };
  const index = tabs.findIndex(tab => tab.id === buffer.path);
  if (index < 0) return [...tabs, nextTab];
  return tabs.map((tab, tabIndex) => tabIndex === index ? nextTab : tab);
}

function updateOpenTabsForDiskChange(tabs: OpenFileTab[], fileId: string, content: string, revision = ''): OpenFileTab[] {
  let changed = false;
  const nextTabs = tabs.map(tab => {
    if (tab.id !== fileId) return tab;
    const nextBuffer = applyDiskChange(tab.buffer, content, 'external', revision);
    if (nextBuffer === tab.buffer) return tab;
    changed = true;
    return { ...tab, buffer: nextBuffer };
  });
  return changed ? nextTabs : tabs;
}

function updateOpenTabsForSave(tabs: OpenFileTab[], fileId: string, content: string, revision = '', cleanPeer = false): OpenFileTab[] {
  let changed = false;
  const nextTabs = tabs.map(tab => {
    if (tab.id !== fileId) return tab;
    const nextBuffer = cleanPeer
      ? applyPeerSaveResult(tab.buffer, fileId, content, revision)
      : applySaveResult(tab.buffer, fileId, content, revision);
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

function paneEdgeAtPoint(bounds: DOMRect, clientX: number, clientY: number): PaneEdge | null {
  const x = clamp((clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
  const y = clamp((clientY - bounds.top) / Math.max(1, bounds.height), 0, 1);
  const distances: Array<[PaneEdge, number]> = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][1] <= 0.38 ? distances[0][0] : null;
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
