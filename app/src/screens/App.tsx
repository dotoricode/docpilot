import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { AgentPanel } from '../features/agent-panel/AgentPanel';
import { ChangedFilesPanel, type PendingFileReview } from '../features/diff-review/ChangedFilesPanel';
import { EditorPane } from '../features/editor/EditorPane';
import { InstructionsPanel } from '../features/instructions/InstructionsPanel';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { WorkspaceSidebar } from '../features/workspace/WorkspaceSidebar';
import { getSettings, getWorkspaceSnapshot, pingBridge, readWorkspaceFile, saveWorkspaceFile, watchProject, type AgentArtifact, type WorkspaceSnapshot } from '../shared/bridge-client';
import { applyThemePreference } from '../shared/theme';
import { createFileBuffer, markSaved, updateEditorContent } from '../../../shared/core/file-buffer';

export type SelectedContext = {
  fileId: string;
  text: string;
  from: number;
  to: number;
};

export type ContextChip = SelectedContext & {
  id: string;
};

export function App() {
  const [buffer, setBuffer] = useState(createFileBuffer());
  const [openError, setOpenError] = useState('');
  const [bridgeState, setBridgeState] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [bridgeMessage, setBridgeMessage] = useState('브리지 연결 확인 중');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedContext, setSelectedContext] = useState<SelectedContext | null>(null);
  const [contextChips, setContextChips] = useState<ContextChip[]>([]);
  const [workspaceRefreshSignal, setWorkspaceRefreshSignal] = useState(0);
  const [pendingReviews, setPendingReviews] = useState<PendingFileReview[]>([]);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(420);
  const openPathRef = useRef('');
  const turnBaselineRef = useRef<WorkspaceSnapshot | null>(null);

  useEffect(() => {
    openPathRef.current = buffer.path;
  }, [buffer.path]);

  useEffect(() => {
    checkBridge();
  }, []);

  useEffect(() => {
    let themePreference: 'dark' | 'system' = 'dark';
    const applyFromSettings = () => {
      getSettings()
        .then(response => {
          themePreference = response.settings.theme;
          applyThemePreference(themePreference);
        })
        .catch(() => applyThemePreference(themePreference));
    };
    const onSettingsSaved = (event: Event) => {
      const settings = (event as CustomEvent).detail?.settings;
      if (settings?.theme) {
        themePreference = settings.theme;
        applyThemePreference(themePreference);
      } else {
        applyFromSettings();
      }
    };
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const onSystemThemeChange = () => applyThemePreference(themePreference);
    applyFromSettings();
    window.addEventListener('docpilot-settings-saved', onSettingsSaved);
    media?.addEventListener?.('change', onSystemThemeChange);
    return () => {
      window.removeEventListener('docpilot-settings-saved', onSettingsSaved);
      media?.removeEventListener?.('change', onSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    const stop = watchProject(event => {
      if (event.type === 'watch.ready' || event.type === 'watch.ping') {
        setBridgeState('connected');
        setBridgeMessage('브리지 연결됨');
      }
      if (event.type !== 'files.changed') return;
      setWorkspaceRefreshSignal(value => value + 1);
      const openPath = openPathRef.current;
      if (!openPath) return;
      readWorkspaceFile(openPath)
        .then(file => {
          setBuffer(latest => {
            if (latest.path !== file.id || latest.lastKnownDiskContent === file.content) return latest;
            setPendingReviews(current => [
              {
                fileId: file.id,
                before: latest.editorContent,
                after: file.content,
                source: 'external',
                detectedAt: new Date().toISOString(),
              },
              ...current.filter(item => item.fileId !== file.id),
            ]);
            return {
              ...latest,
              lastKnownDiskContent: file.content,
              conflictState: latest.dirtyByUser ? 'external-conflict' : 'external-change',
            };
          });
          setOpenError('');
        })
        .catch(err => {
          setOpenError(err instanceof Error ? err.message : String(err));
        });
    }, () => {
      setBridgeState('disconnected');
      setBridgeMessage('브리지 연결이 끊겼습니다.');
    });
    return stop;
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

  useEffect(() => {
    const openFileRel = new URLSearchParams(window.location.search).get('open');
    if (openFileRel) openFile(openFileRel);
  }, []);

  async function openFile(id: string, options: { keepReview?: boolean } = {}) {
    try {
      const file = await readWorkspaceFile(id);
      setBuffer(createFileBuffer({ path: file.id, content: file.content }));
      if (!options.keepReview) setPendingReviews(current => current.filter(item => item.fileId !== file.id));
      setSelectedContext(null);
      setContextChips(current => current.filter(item => item.fileId !== file.id));
      setOpenError('');
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

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

  async function acceptReview(review: PendingFileReview) {
    await saveWorkspaceFile(review.fileId, review.after);
    setBuffer(current => current.path === review.fileId
      ? markSaved({ ...current, editorContent: review.after, lastKnownDiskContent: review.after }, review.after)
      : current);
    setPendingReviews(current => current.filter(item => item.fileId !== review.fileId));
    setWorkspaceRefreshSignal(value => value + 1);
  }

  async function rejectReview(review: PendingFileReview) {
    setSaving(true);
    try {
      await saveWorkspaceFile(review.fileId, review.before);
      setBuffer(current => current.path === review.fileId
        ? markSaved({ ...current, editorContent: review.before, lastKnownDiskContent: review.before }, review.before)
        : current);
      setPendingReviews(current => current.filter(item => item.fileId !== review.fileId));
      setWorkspaceRefreshSignal(value => value + 1);
      setOpenError('');
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function openReview(review: PendingFileReview) {
    await openFile(review.fileId, { keepReview: true });
  }

  async function mergeReview(review: PendingFileReview) {
    setBuffer(updateEditorContent({
      ...createFileBuffer({ path: review.fileId, content: review.before }),
      lastSavedContent: review.before,
      lastKnownDiskContent: review.after,
    }, review.after));
    setSelectedContext(null);
    setOpenError('');
  }

  async function saveMergedReview(review: PendingFileReview, content: string) {
    await saveWorkspaceFile(review.fileId, content);
    setBuffer(current => current.path === review.fileId
      ? markSaved({ ...current, editorContent: content, lastKnownDiskContent: content }, content)
      : current);
    setPendingReviews(current => current.filter(item => item.fileId !== review.fileId));
    setWorkspaceRefreshSignal(value => value + 1);
    setOpenError('');
  }

  async function reviewArtifact(artifact: AgentArtifact) {
    const fileId = artifact.fileId || '';
    const proposed = artifact.proposedContent || artifact.content || '';
    if (!fileId || !proposed) {
      setOpenError('검토할 수 있는 파일 산출물이 아닙니다.');
      return;
    }
    try {
      let before = '';
      try {
        const file = await readWorkspaceFile(fileId);
        before = file.content;
      } catch {
        before = '';
      }
      setPendingReviews(current => [
        {
          fileId,
          before,
          after: proposed,
          source: 'agent',
          detectedAt: new Date().toISOString(),
          promptPackageSummary: artifact.promptPackageSummary,
        },
        ...current.filter(item => item.fileId !== fileId),
      ]);
      setOpenError('');
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  async function captureTurnBaseline() {
    turnBaselineRef.current = await getWorkspaceSnapshot();
  }

  async function collectTurnChanges(source: 'agent' | 'external' = 'agent') {
    const before = turnBaselineRef.current;
    turnBaselineRef.current = null;
    if (!before) return;
    const after = await getWorkspaceSnapshot();
    const beforeById = new Map(before.files.map(file => [file.id, file]));
    const reviews: PendingFileReview[] = [];
    for (const file of after.files) {
      const previous = beforeById.get(file.id);
      if (previous && previous.hash === file.hash) continue;
      reviews.push({
        fileId: file.id,
        before: previous?.content || '',
        after: file.content,
        source,
        detectedAt: after.createdAt,
      });
    }
    if (!reviews.length) return;
    setPendingReviews(current => [
      ...reviews,
      ...current.filter(item => !reviews.some(review => review.fileId === item.fileId)),
    ]);
    setWorkspaceRefreshSignal(value => value + 1);
  }

  function addSelectedContextChip() {
    if (!selectedContext || !selectedContext.text.trim()) return;
    setContextChips(current => {
      const key = contextChipKey(selectedContext);
      if (current.some(item => contextChipKey(item) === key)) return current;
      return [{ ...selectedContext, id: `${Date.now()}-${current.length}` }, ...current].slice(0, 12);
    });
  }

  function removeContextChip(id: string) {
    setContextChips(current => current.filter(item => item.id !== id));
  }

  function clearContextChips() {
    setContextChips([]);
  }

  function startPanelResize(side: 'left' | 'right', event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;
    document.body.classList.add('resizing-panels');
    const move = (moveEvent: MouseEvent) => {
      if (side === 'left') {
        setLeftWidth(clamp(startLeft + moveEvent.clientX - startX, 220, 520));
      } else {
        setRightWidth(clamp(startRight - (moveEvent.clientX - startX), 320, 720));
      }
    };
    const stop = () => {
      document.body.classList.remove('resizing-panels');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop, { once: true });
  }

  return (
    <main
      className="app-shell"
      style={{
        '--left-panel-width': `${leftWidth}px`,
        '--right-panel-width': `${rightWidth}px`,
      } as CSSProperties}
    >
      <div className="app-topbar window-drag-region">
        <div className="topbar-left">
          <div className="app-logo"><span className="logo-dot" />DocPilot</div>
          <span className="topbar-chip">v1.0.21</span>
          <span className="topbar-chip" title={workspaceRoot}>root: {folderName(workspaceRoot) || '...'}</span>
          <span className="topbar-crumb">{buffer.path || '파일을 선택하세요'}</span>
        </div>
        <div className="topbar-right">
          <div className={`bridge-status ${bridgeState}`} title={bridgeMessage}>
            <span className="bridge-dot" />
            <span>{bridgeState === 'connected' ? '문서 연결됨' : bridgeMessage}</span>
            {bridgeState !== 'connected' ? (
              <button type="button" onClick={checkBridge}>{bridgeState === 'checking' ? '확인 중' : '재시도'}</button>
            ) : null}
          </div>
          <button className="agent-session-topbutton" type="button">Agent 세션</button>
          <span className="agent-availability claude">Claude 사용 가능</span>
          <span className="agent-availability codex">Codex 사용 가능</span>
        </div>
      </div>
      <WorkspaceSidebar
        activeFile={buffer.path}
        refreshSignal={workspaceRefreshSignal}
        instructionsPanel={<InstructionsPanel />}
        onOpenFile={openFile}
      />
      <div
        className="panel-resizer left-resizer"
        role="separator"
        aria-label="좌측 패널 폭 조절"
        onMouseDown={event => startPanelResize('left', event)}
      />
      <EditorPane
        buffer={buffer}
        error={openError}
        saving={saving}
        onSelectionChange={setSelectedContext}
        onChange={content => setBuffer(current => updateEditorContent(current, content))}
        onSave={saveFile}
      />
      <div
        className="panel-resizer right-resizer"
        role="separator"
        aria-label="우측 패널 폭 조절"
        onMouseDown={event => startPanelResize('right', event)}
      />
      <div className="right-stack">
        <AgentPanel
          selectedContext={selectedContext}
          contextChips={contextChips}
          onAddSelectedContext={addSelectedContextChip}
          onRemoveContextChip={removeContextChip}
          onClearContextChips={clearContextChips}
          onReviewArtifact={reviewArtifact}
          onTurnStart={captureTurnBaseline}
          onTurnSettled={() => collectTurnChanges('agent')}
        />
        <ChangedFilesPanel
          reviews={pendingReviews}
          onOpen={openReview}
          onMerge={mergeReview}
          onSaveMerge={saveMergedReview}
          onAccept={acceptReview}
          onReject={rejectReview}
        />
        <SettingsPanel />
      </div>
    </main>
  );
}

function contextChipKey(item: SelectedContext) {
  return `${item.fileId}:${item.from}:${item.to}:${item.text}`;
}

function folderName(folderPath: string) {
  const trimmed = String(folderPath || '').replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || '';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
