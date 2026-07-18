import { useEffect, useState } from 'react';
import { getDiagnostics, getSettings, getTerminalShells, installFishShell, openLocalPath, saveSettings, type AppDiagnostics, type AppSettings, type TerminalShell } from '../../shared/bridge-client';
import { applyThemePreference } from '../../shared/theme';

const emptySettings: AppSettings = {
  version: 1,
  autosave: false,
  suppressMarkdownVisualReadonlyNotice: false,
  theme: 'dark',
  defaultTerminalShell: 'default',
  agentCommandMode: 'auto',
  claudeCommand: 'claude',
  codexCommand: 'codex',
  fileWatcherIgnore: '',
  recentWorkspaces: [],
};

export function SettingsPanel() {
  const [draft, setDraft] = useState<AppSettings>(emptySettings);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [terminalShells, setTerminalShells] = useState<TerminalShell[]>([]);
  const [status, setStatus] = useState('불러오는 중');
  const [busy, setBusy] = useState(false);
  const [installingFish, setInstallingFish] = useState(false);
  const fishShell = terminalShells.find(shell => shell.id === 'fish');

  useEffect(() => {
    reloadSettings();
  }, []);

  async function reloadSettings() {
    setBusy(true);
    try {
      const [response, diagnosticsResponse, shells] = await Promise.all([getSettings(), getDiagnostics(), getTerminalShells()]);
      setDraft(response.settings);
      setDiagnostics(diagnosticsResponse.diagnostics);
      setTerminalShells(shells);
      applyThemePreference(response.settings.theme);
      setStatus('저장된 설정');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revealPath(targetPath: string) {
    if (!targetPath) return;
    const ok = await openLocalPath(targetPath);
    setStatus(ok ? '열림' : '경로를 열 수 없음');
  }

  async function persistSettings() {
    setBusy(true);
    try {
      const response = await saveSettings(draft);
      setDraft(response.settings);
      applyThemePreference(response.settings.theme);
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: response.settings } }));
      setStatus('저장됨');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function installFish() {
    if (!window.confirm('Homebrew로 fish 셸을 설치할까요?\n\n실행 명령: brew install fish')) return;
    setInstallingFish(true);
    setStatus('fish 설치 중');
    try {
      const result = await installFishShell();
      setTerminalShells(await getTerminalShells());
      setDraft(result.settings);
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: result.settings } }));
      setStatus('fish 설치 완료');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingFish(false);
    }
  }

  return (
    <section className="settings-panel">
      <div className="panel-title settings-title">
        <span>Settings</span>
        <strong>{status}</strong>
        <button type="button" onClick={reloadSettings} disabled={busy}>새로고침</button>
        <button type="button" onClick={persistSettings} disabled={busy}>저장</button>
      </div>
      <div className="settings-form">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.autosave}
            onChange={event => setDraft(current => ({ ...current, autosave: event.target.checked }))}
          />
          <span>자동 저장</span>
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={!draft.suppressMarkdownVisualReadonlyNotice}
            onChange={event => setDraft(current => ({
              ...current,
              suppressMarkdownVisualReadonlyNotice: !event.target.checked,
            }))}
          />
          <span>Visual 읽기 전용 안내 모달 표시</span>
        </label>
        <label>
          <span>테마</span>
          <select
            value={draft.theme}
            onChange={event => {
              const theme = event.target.value as AppSettings['theme'];
              setDraft(current => ({ ...current, theme }));
              applyThemePreference(theme);
            }}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </label>
        <label>
          <span>Agent 실행</span>
          <select
            value={draft.agentCommandMode}
            onChange={event => setDraft(current => ({ ...current, agentCommandMode: event.target.value as AppSettings['agentCommandMode'] }))}
          >
            <option value="auto">기본 PATH</option>
            <option value="custom">직접 지정</option>
          </select>
        </label>
        <label>
          <span>기본 터미널 셸</span>
          <select
            value={draft.defaultTerminalShell}
            onChange={event => setDraft(current => ({ ...current, defaultTerminalShell: event.target.value as AppSettings['defaultTerminalShell'] }))}
          >
            {(terminalShells.length ? terminalShells : [{ id: 'default', label: 'Default shell', description: 'Use your macOS login shell', available: true, installable: false, path: '' } as TerminalShell]).map(shell => (
              <option key={shell.id} value={shell.id} disabled={!shell.available}>
                {shell.label}{shell.available ? '' : ' — 설치되지 않음'}
              </option>
            ))}
          </select>
          <small className="settings-field-hint">fish는 내장 터미널에서 자동 제안을 보여주며 Ctrl+F로 수락합니다.</small>
          {fishShell && !fishShell.available ? (
            <button
              className="settings-inline-action"
              type="button"
              disabled={installingFish || !fishShell.installable}
              onClick={() => void installFish()}
            >
              {installingFish ? 'fish 설치 중…' : fishShell.installable ? 'Homebrew로 fish 설치' : 'fish 설치에는 Homebrew 필요'}
            </button>
          ) : null}
        </label>
        <label>
          <span>Claude 명령</span>
          <input
            value={draft.claudeCommand}
            onChange={event => setDraft(current => ({ ...current, claudeCommand: event.target.value }))}
            placeholder="claude"
          />
        </label>
        <label>
          <span>Codex 명령</span>
          <input
            value={draft.codexCommand}
            onChange={event => setDraft(current => ({ ...current, codexCommand: event.target.value }))}
            placeholder="codex"
          />
        </label>
        <label className="settings-wide">
          <span>파일 감시 제외</span>
          <textarea
            value={draft.fileWatcherIgnore}
            onChange={event => setDraft(current => ({ ...current, fileWatcherIgnore: event.target.value }))}
            placeholder="예: dist/**, .cache/**"
          />
        </label>
        {draft.recentWorkspaces.length ? (
          <div className="settings-recent settings-wide">
            <span>최근 작업공간</span>
            {draft.recentWorkspaces.slice(0, 4).map(folder => (
              <code key={folder}>{folder}</code>
            ))}
          </div>
        ) : null}
        {diagnostics ? (
          <div className="settings-diagnostics settings-wide">
            <span>진단 및 로그</span>
            <div>
              <code title={diagnostics.docpilotDir}>{diagnostics.docpilotDir}</code>
              <button type="button" onClick={() => revealPath(diagnostics.docpilotDir)}>메타 폴더</button>
            </div>
            <div>
              <code title={diagnostics.sessionLogsDir}>세션 로그 {diagnostics.sessionLogCount}개</code>
              <button type="button" onClick={() => revealPath(diagnostics.sessionLogsDir)}>로그 폴더</button>
            </div>
            <div>
              <code title={diagnostics.settingsFile}>settings.json</code>
              <button type="button" onClick={() => revealPath(diagnostics.settingsFile)}>설정 파일</button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
