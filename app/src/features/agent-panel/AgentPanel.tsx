import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { contextModeLabel } from '../../../../shared/core/context-policy';
import type { ContextChip, SelectedContext } from '../../screens/App';
import {
  createAgentSession,
  getAgentRuntime,
  getAgentSessionDetail,
  getAgentSessionLogs,
  listAgentSessions,
  resizeTerminalSession,
  sendTerminalInput,
  sendSessionTurn,
  startTerminalSession,
  stopSessionTurn,
  stopTerminalSession,
  type AgentName,
  type AgentArtifact,
  type AgentSessionLogEntry,
  type AgentSessionSummary,
  type AgentRuntime,
  type SessionTurnEvent,
  watchTerminalSession,
} from '../../shared/bridge-client';

type AgentPanelProps = {
  selectedContext: SelectedContext | null;
  contextChips: ContextChip[];
  onAddSelectedContext: () => void;
  onRemoveContextChip: (id: string) => void;
  onClearContextChips: () => void;
  onReviewArtifact: (artifact: AgentArtifact) => void;
  onTurnStart?: () => Promise<void> | void;
  onTurnSettled?: () => Promise<void> | void;
};

export function AgentPanel({
  selectedContext,
  contextChips,
  onAddSelectedContext,
  onRemoveContextChip,
  onClearContextChips,
  onReviewArtifact,
  onTurnStart,
  onTurnSettled,
}: AgentPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalSessionIdRef = useRef('');
  const terminalStreamStopRef = useRef<(() => void) | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [contextModeOverride, setContextModeOverride] = useState('auto');
  const [promptChars, setPromptChars] = useState(0);
  const [inputChars, setInputChars] = useState(0);
  const [promptMeta, setPromptMeta] = useState('');
  const [statusText, setStatusText] = useState('대기 중');
  const [canRestart, setCanRestart] = useState(false);
  const [activityLines, setActivityLines] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<AgentArtifact[]>([]);
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [terminalSessionId, setTerminalSessionId] = useState('');
  const hasContext = Boolean(selectedContext || contextChips.length);
  const automaticContextMode = hasContext ? 'selection' : 'minimal';
  const contextMode = contextModeOverride === 'auto' ? automaticContextMode : contextModeOverride;

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Hack, Menlo, Monaco, monospace',
      fontSize: 13,
      theme: {
        background: '#07080a',
        foreground: '#d7d9df',
      },
    });
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    terminal.onData(data => {
      const sessionId = terminalSessionIdRef.current;
      if (!sessionId) return;
      sendTerminalInput(sessionId, data).catch(err => {
        setError(err instanceof Error ? err.message : String(err));
      });
    });
    terminal.writeln('DocPilot Agent Session');
    terminal.writeln('세션을 선택하거나 새 세션을 만드세요.');
    return () => {
      terminal.dispose();
      terminalRef.current = null;
      terminalStreamStopRef.current?.();
    };
  }, []);

  useEffect(() => {
    terminalSessionIdRef.current = terminalSessionId;
  }, [terminalSessionId]);

  useEffect(() => {
    refreshSessions();
    refreshRuntime();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    loadSession(selectedSessionId);
  }, [selectedSessionId]);

  async function refreshSessions() {
    try {
      const data = await listAgentSessions();
      setSessions(data.sessions || []);
      if (!selectedSessionId && data.sessions?.length) setSelectedSessionId(data.sessions[0].id);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshRuntime() {
    try {
      const data = await getAgentRuntime();
      setRuntime(data.runtime);
    } catch {}
  }

  async function loadSession(sessionId: string) {
    try {
      const [detail, logs] = await Promise.all([
        getAgentSessionDetail(sessionId),
        getAgentSessionLogs(sessionId, 12),
      ]);
      const terminal = terminalRef.current;
      if (terminal) {
        terminal.clear();
        terminal.writeln(`${detail.session.agent === 'claude' ? 'Claude' : 'Codex'} · ${detail.session.status}`);
        terminal.writeln('');
        for (const message of detail.messages || []) {
          terminal.writeln(message.role === 'user' ? '› USER' : '› ASSISTANT');
          terminal.writeln(message.text || '');
          terminal.writeln('');
        }
      }
      setCanRestart(Boolean((detail.messages || []).some(message => message.role === 'user')));
      setArtifacts(detail.artifacts || []);
      setActivityLines((logs.logs || []).map(formatLogEntry).filter(Boolean).slice(-6));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function newSession(agent: AgentName) {
    try {
      const data = await createAgentSession(agent, { type: 'project' });
      setSessions(current => [data.session, ...current.filter(item => item.id !== data.session.id)]);
      setSelectedSessionId(data.session.id);
      setStatusText('대기 중');
      setCanRestart(false);
      setArtifacts([]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function formatLogEntry(entry: AgentSessionLogEntry) {
    const seconds = entry.elapsedMs ? `${Math.round(Number(entry.elapsedMs) / 1000)}초` : '';
    if (entry.type === 'session.created') return '세션 생성';
    if (entry.type === 'turn.user') return `사용자 입력 ${Number(entry.chars || 0).toLocaleString()}자`;
    if (entry.type === 'turn.started') {
      const metadata = entry.promptPackage && typeof entry.promptPackage === 'object' ? entry.promptPackage as Record<string, unknown> : {};
      const chars = Number(metadata.totalPromptChars || 0);
      return `프롬프트 전송 ${Number.isFinite(chars) ? chars.toLocaleString() : 0}자`;
    }
    if (entry.type === 'turn.assistant') return `응답 완료 ${Number(entry.chars || 0).toLocaleString()}자`;
    if (entry.type === 'artifact.created') return `아티팩트 생성 ${entry.kind || ''}`.trim();
    if (entry.type === 'turn.stopped') return '사용자 중단';
    if (entry.type === 'turn.error') return `오류 ${entry.error || ''}`.trim();
    if (entry.type === 'turn.progress') return `진행 중 ${seconds}`.trim();
    return String(entry.type || '').replace(/^turn\./, '');
  }

  function pushActivity(line: string) {
    if (!line) return;
    setActivityLines(current => [...current, line].slice(-6));
  }

  function handleTurnEvent(event: SessionTurnEvent) {
    const terminal = terminalRef.current;
    if (event.type === 'turn.started') {
      if (event.runtime) setRuntime(event.runtime);
      const metadata = event.promptPackage || {};
      const chars = Number(metadata.totalPromptChars || metadata.promptChars || metadata.chars || 0);
      const input = Number(metadata.inputChars || 0);
      const summaryChars = Number(metadata.summaryChars || 0);
      const included = metadata.included && typeof metadata.included === 'object' ? metadata.included as Record<string, unknown> : {};
      setPromptChars(Number.isFinite(chars) ? chars : 0);
      setInputChars(Number.isFinite(input) ? input : 0);
      setPromptMeta([
        metadata.contextMode ? `범위 ${contextModeLabel(String(metadata.contextMode))}` : '',
        Number.isFinite(summaryChars) && summaryChars > 0 ? `요약 ${summaryChars.toLocaleString()}자` : '',
        typeof included.attachments === 'number' ? `첨부 ${included.attachments}개` : '',
        typeof included.transcriptMessages === 'number' ? `대화 ${included.transcriptMessages}개` : '',
      ].filter(Boolean).join(' · '));
      setStatusText('응답 대기 중');
      pushActivity(`프롬프트 전송 ${Number.isFinite(chars) ? chars.toLocaleString() : 0}자`);
      if (event.runtime) pushActivity(runtimeLabel(event.runtime));
      terminal?.writeln('');
      terminal?.writeln('› SEND');
      return;
    }
    if (event.type === 'turn.progress') {
      const seconds = Math.round((event.elapsedMs || 0) / 1000);
      setStatusText(`${event.phase === 'streaming' ? '응답 수신 중' : '응답 대기 중'} · ${seconds}초`);
      if (seconds > 0 && seconds % 10 === 0) pushActivity(`${event.phase === 'streaming' ? '응답 수신 중' : '응답 대기 중'} ${seconds}초`);
      return;
    }
    if (event.type === 'turn.delta' && event.text) {
      setStatusText('응답 수신 중');
      pushActivity('응답 스트리밍');
      terminal?.write(event.text.replace(/\n/g, '\r\n'));
      return;
    }
    if (event.type === 'artifact.created') {
      terminal?.writeln('');
      terminal?.writeln(`artifact: ${event.artifact?.title || event.artifact?.kind || 'created'}`);
      pushActivity(`아티팩트 생성 ${event.artifact?.kind || ''}`.trim());
      if (event.artifact) setArtifacts(current => [event.artifact as AgentArtifact, ...current.filter(item => item.id !== event.artifact?.id)]);
      return;
    }
    if (event.type === 'turn.done') {
      setStatusText('완료');
      if (event.session) {
        setSessions(current => current.map(item => item.id === event.session?.id ? event.session : item));
      }
      terminal?.writeln('');
      terminal?.writeln('✓ done');
      pushActivity('응답 완료');
      return;
    }
    if (event.type === 'turn.error') {
      setStatusText('오류');
      setError(event.error || '세션 실행 중 오류가 발생했습니다.');
      terminal?.writeln('');
      terminal?.writeln(`error: ${event.error || 'unknown error'}`);
      pushActivity(`오류 ${event.error || ''}`.trim());
      return;
    }
    if (event.type === 'turn.stopped') {
      setStatusText('중단됨');
      terminal?.writeln('');
      terminal?.writeln('stopped');
      pushActivity('사용자 중단');
    }
  }

  async function runTurn(message: string, attachments: unknown[], outputHints: Record<string, unknown>, options: { clearInput?: boolean } = {}) {
    if (!message.trim() || sending) return;
    let sessionId = selectedSessionId;
    setSending(true);
    setError('');
    try {
      if (!sessionId) {
        const data = await createAgentSession('claude', { type: 'project' });
        sessionId = data.session.id;
        setSessions(current => [data.session, ...current]);
        setSelectedSessionId(sessionId);
      }
      await onTurnStart?.();
      terminalRef.current?.writeln('');
      terminalRef.current?.writeln(`› ${message}`);
      if (options.clearInput) setInput('');
      const controller = new AbortController();
      turnAbortRef.current = controller;
      await sendSessionTurn(sessionId, {
        message,
        attachments,
        outputHints,
      }, handleTurnEvent, controller.signal);
      await onTurnSettled?.();
      await refreshSessions();
      setCanRestart(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatusText('중단됨');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      await onTurnSettled?.();
    } finally {
      turnAbortRef.current = null;
      setSending(false);
    }
  }

  async function sendTurn() {
    const message = input.trim();
    if (!message || sending) return;
    const attachments = uniqueContextAttachments([
      ...contextChips,
      ...(selectedContext ? [selectedContext] : []),
    ]);
    await runTurn(
      message,
      attachments,
      { contextMode, turnType: contextMode === 'project' ? 'project' : attachments.length ? 'selection' : 'chat' },
      { clearInput: true },
    );
  }

  async function copyContextChips() {
    const unique = uniqueContextAttachments(contextChips);
    const text = unique.map(item => [
      `File: ${item.fileId}`,
      `Range: ${item.from}-${item.to}`,
      item.text,
    ].join('\n')).join('\n\n---\n\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      pushActivity(`문맥 ${unique.length}개 복사`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function restartLastTurn() {
    if (!selectedSessionId || sending) return;
    try {
      const detail = await getAgentSessionDetail(selectedSessionId);
      const lastUser = [...(detail.messages || [])].reverse().find(message => message.role === 'user');
      if (!lastUser?.text?.trim()) {
        setCanRestart(false);
        return;
      }
      await runTurn(
        lastUser.text,
        Array.isArray(lastUser.attachments) ? lastUser.attachments : [],
        lastUser.outputHints && typeof lastUser.outputHints === 'object' ? lastUser.outputHints : { contextMode },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stopTurn() {
    if (!selectedSessionId || !sending) return;
    setStatusText('중단 중');
    try {
      await stopSessionTurn(selectedSessionId);
      turnAbortRef.current?.abort();
      terminalRef.current?.writeln('');
      terminalRef.current?.writeln('stop requested');
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startInteractiveTerminal() {
    if (terminalSessionId) return;
    const agent = selectedSession?.agent || 'claude';
    try {
      const data = await startTerminalSession(agent);
      setRuntime(data.runtime);
      setTerminalSessionId(data.session.id);
      terminalSessionIdRef.current = data.session.id;
      terminalRef.current?.clear();
      terminalRef.current?.writeln(`${agent === 'codex' ? 'Codex' : 'Claude'} terminal · ${data.session.mode}`);
      terminalRef.current?.writeln('키보드 입력이 Agent 프로세스로 전달됩니다.');
      terminalRef.current?.writeln('');
      terminalStreamStopRef.current?.();
      terminalStreamStopRef.current = watchTerminalSession(data.session.id, event => {
        if (event.runtime) setRuntime(event.runtime);
        if (event.type === 'terminal.data' && event.data) terminalRef.current?.write(event.data.replace(/\n/g, '\r\n'));
        if (event.type === 'terminal.exit') {
          terminalRef.current?.writeln('');
          terminalRef.current?.writeln('terminal closed');
          setTerminalSessionId('');
          terminalSessionIdRef.current = '';
          terminalStreamStopRef.current?.();
          terminalStreamStopRef.current = null;
        }
      }, () => {
        setTerminalSessionId('');
        terminalSessionIdRef.current = '';
      });
      const activeTerminal = terminalRef.current;
      resizeTerminalSession(data.session.id, activeTerminal?.cols || 100, activeTerminal?.rows || 30).catch(() => {});
      pushActivity('Interactive terminal 시작');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stopInteractiveTerminal() {
    const sessionId = terminalSessionId;
    if (!sessionId) return;
    try {
      await stopTerminalSession(sessionId);
      terminalStreamStopRef.current?.();
      terminalStreamStopRef.current = null;
      terminalSessionIdRef.current = '';
      setTerminalSessionId('');
      pushActivity('Interactive terminal 종료');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedSession = sessions.find(item => item.id === selectedSessionId);

  return (
    <aside className="agent-panel">
      <div className="panel-title agent-title">
        <span>Agent Session</span>
        <button type="button" onClick={() => newSession('claude')}>+ Claude</button>
        <button type="button" onClick={() => newSession('codex')}>+ Codex</button>
      </div>
      <div className="session-list">
        {sessions.map(session => (
          <button
            className={`session-row ${session.id === selectedSessionId ? 'active' : ''} ${session.agent}`}
            key={session.id}
            type="button"
            onClick={() => setSelectedSessionId(session.id)}
          >
            <span>{session.agent === 'claude' ? 'Claude' : 'Codex'}</span>
            <small>{session.status || 'idle'}</small>
          </button>
        ))}
        {!sessions.length ? <span className="empty-note">세션 없음</span> : null}
      </div>
      <div className="agent-session-actions">
        <button type="button" disabled={!selectedSessionId || sending || !canRestart} onClick={restartLastTurn}>다시 실행</button>
        {terminalSessionId ? (
          <button type="button" onClick={stopInteractiveTerminal}>터미널 종료</button>
        ) : (
          <button type="button" disabled={sending} onClick={startInteractiveTerminal}>터미널 시작</button>
        )}
      </div>
      <div className="agent-runtime">
        <span>{runtime ? runtimeLabel(runtime) : '런타임 확인 중'}</span>
        <small>{runtime ? `cwd ${runtime.cwd}` : ''}</small>
      </div>
      <div className="context-strip">
        <span>
          {contextChips.length
            ? `문맥 칩 ${contextChips.length}개 · ${contextChips.reduce((sum, item) => sum + item.text.length, 0).toLocaleString()}자`
            : selectedContext
              ? `${selectedContext.fileId} · ${selectedContext.text.length}자 선택`
              : selectedSession ? `${selectedSession.agent} · ${statusText}` : statusText}
        </span>
        <strong>{contextModeLabel(contextMode)}</strong>
      </div>
      <div className="context-chip-bar">
        {selectedContext ? (
          <button type="button" disabled={sending} onClick={onAddSelectedContext}>선택 추가</button>
        ) : null}
        {contextChips.map(chip => (
          <span className="context-chip" key={chip.id}>
            <strong>{chip.fileId}</strong>
            <small>{chip.text.length.toLocaleString()}자</small>
            <button type="button" disabled={sending} onClick={() => onRemoveContextChip(chip.id)}>×</button>
          </span>
        ))}
        {contextChips.length ? (
          <>
            <button type="button" disabled={sending} onClick={copyContextChips}>복사</button>
            <button type="button" disabled={sending} onClick={onClearContextChips}>비우기</button>
          </>
        ) : null}
      </div>
      <div className="agent-meta">
        입력 {input.trim().length.toLocaleString()}자
        {promptChars ? ` · 마지막 전체 ${promptChars.toLocaleString()}자` : ' · 마지막 전체 0자'}
        {inputChars ? ` · 마지막 입력 ${inputChars.toLocaleString()}자` : ''}
        {promptMeta ? ` · ${promptMeta}` : ''}
      </div>
      <div className="agent-activity">
        <span>활동</span>
        <strong>{activityLines.length ? activityLines[activityLines.length - 1] : '기록 없음'}</strong>
      </div>
      {error ? <div className="editor-error">{error}</div> : null}
      <div className="artifact-rail">
        <span>Artifacts</span>
        {artifacts.length ? artifacts.slice(0, 4).map(artifact => (
          <button
            type="button"
            key={artifact.id}
            disabled={!artifact.fileId || !(artifact.proposedContent || artifact.content)}
            onClick={() => onReviewArtifact(artifact)}
            title={artifact.fileId || artifact.kind}
          >
            {artifact.kind}{artifact.fileId ? ` · ${artifact.fileId}` : ''}
          </button>
        )) : <small>없음</small>}
      </div>
      <div className="terminal-host" ref={hostRef} />
      <div className="agent-composer">
        <div className="agent-controls">
          <label>
            <span>범위</span>
            <select value={contextModeOverride} onChange={event => setContextModeOverride(event.target.value)} disabled={sending}>
              <option value="auto">자동 ({contextModeLabel(automaticContextMode)})</option>
              <option value="minimal">최소</option>
              <option value="selection">선택 문맥</option>
              <option value="conversation">최근 대화</option>
              <option value="document">현재 문서</option>
              <option value="project">프로젝트</option>
              <option value="full">전체</option>
            </select>
          </label>
        </div>
        <textarea
          value={input}
          placeholder="Agent 세션에 메시지를 입력하세요."
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendTurn();
            }
          }}
        />
        {sending ? (
          <button type="button" className="stop-button" onClick={stopTurn}>중단</button>
        ) : (
          <button type="button" disabled={!input.trim()} onClick={sendTurn}>전송</button>
        )}
      </div>
    </aside>
  );
}

function runtimeLabel(runtime: AgentRuntime) {
  const mode = runtime.executionMode === 'node-pty' ? 'PTY 실행' : runtime.ptyAvailable ? 'PTY 준비됨' : 'Stream 모드';
  const command = runtime.commandMode === 'custom'
    ? `Claude ${runtime.claudeCommand} · Codex ${runtime.codexCommand}`
    : '기본 PATH';
  return `${runtime.rendererTerminal} · ${mode} · ${command}`;
}

function uniqueContextAttachments(items: SelectedContext[]) {
  const seen = new Set<string>();
  const out = [];
  for (const item of items) {
    const key = `${item.fileId}:${item.from}:${item.to}:${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'selection',
      fileId: item.fileId,
      label: item.fileId,
      source: 'chip',
      text: item.text,
      from: item.from,
      to: item.to,
    });
  }
  return out;
}
