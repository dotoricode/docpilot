import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import '@xterm/xterm/css/xterm.css';
import { contextModeLabel } from '../../../../shared/core/context-policy';
import type { ContextChip, SelectedContext } from '../../screens/App';
import {
  closeAgentSession,
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
  type AgentMessage,
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
  changedFilesPanel?: ReactNode;
  changedFilesCount?: number;
  settingsPanel?: ReactNode;
  onClearContextChips: () => void;
  onReviewArtifact: (artifact: AgentArtifact) => void;
  onTurnStart?: (context: TurnLifecycleContext) => Promise<void> | void;
  onTurnSettled?: (context: TurnLifecycleContext) => Promise<void> | void;
  onCollapse?: () => void;
};

type TurnLifecycleContext = {
  message: string;
  attachments: unknown[];
  outputHints: Record<string, unknown>;
};

type AgentPhase = 'idle' | 'preparing' | 'thinking' | 'streaming' | 'working' | 'done' | 'stopped' | 'error';

type TimelineStep = {
  id: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
};

export function AgentPanel({
  selectedContext,
  contextChips,
  changedFilesPanel,
  changedFilesCount = 0,
  settingsPanel,
  onClearContextChips,
  onReviewArtifact,
  onTurnStart,
  onTurnSettled,
  onCollapse,
}: AgentPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalSessionIdRef = useRef('');
  const terminalStreamStopRef = useRef<(() => void) | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const terminalWriteBufferRef = useRef('');
  const terminalWriteFrameRef = useRef<number | null>(null);
  const liveAssistantTextRef = useRef('');
  const liveAssistantFrameRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const runningTurnSessionIdRef = useRef('');
  const lastStreamStatusAtRef = useRef(0);
  const streamActivityPushedRef = useRef(false);
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
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rawLogOpen, setRawLogOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<'instant' | 'clarify'>('instant');
  const [clarifierAnswer, setClarifierAnswer] = useState('');
  const [clarifierDraft, setClarifierDraft] = useState<{ original: string; question: string } | null>(null);
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
      if (terminalWriteFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalWriteFrameRef.current);
        terminalWriteFrameRef.current = null;
      }
      if (liveAssistantFrameRef.current !== null) {
        window.cancelAnimationFrame(liveAssistantFrameRef.current);
        liveAssistantFrameRef.current = null;
      }
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
    if (runningTurnSessionIdRef.current === sessionId) return;
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
      setMessages(detail.messages || []);
      setLiveAssistantText('');
      liveAssistantTextRef.current = '';
      setAgentPhase(detail.session.status === 'running' ? 'working' : detail.session.status === 'errored' ? 'error' : 'idle');
      setStatusText(detail.session.status === 'running' ? '작업 중' : detail.session.status === 'errored' ? '오류' : '대기 중');
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
      setAgentPhase('idle');
      setCanRestart(false);
      setMessages([]);
      setLiveAssistantText('');
      liveAssistantTextRef.current = '';
      setArtifacts([]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function closeSelectedSession() {
    if (!selectedSessionId || sending) return;
    const closingId = selectedSessionId;
    const closingIndex = sessions.findIndex(session => session.id === closingId);
    try {
      const data = await closeAgentSession(closingId);
      const nextSessions = data.sessions || [];
      setSessions(nextSessions);
      const nextSelected = nextSessions[Math.min(Math.max(closingIndex, 0), Math.max(nextSessions.length - 1, 0))]?.id || '';
      setSelectedSessionId(nextSelected);
      if (!nextSelected) {
        setMessages([]);
        setArtifacts([]);
        setActivityLines([]);
        setCanRestart(false);
        setStatusText('대기 중');
        setAgentPhase('idle');
      }
      if (terminalSessionId) await stopInteractiveTerminal();
      pushActivity('세션 닫힘');
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

  function flushTerminalWrites() {
    if (terminalWriteFrameRef.current !== null) {
      window.cancelAnimationFrame(terminalWriteFrameRef.current);
      terminalWriteFrameRef.current = null;
    }
    const pending = terminalWriteBufferRef.current;
    terminalWriteBufferRef.current = '';
    if (pending) terminalRef.current?.write(pending);
  }

  function queueTerminalWrite(text: string) {
    if (!text) return;
    terminalWriteBufferRef.current += text.replace(/\n/g, '\r\n');
    if (terminalWriteFrameRef.current !== null) return;
    terminalWriteFrameRef.current = window.requestAnimationFrame(flushTerminalWrites);
  }

  function cancelLiveAssistantFlush() {
    if (liveAssistantFrameRef.current !== null) {
      window.cancelAnimationFrame(liveAssistantFrameRef.current);
      liveAssistantFrameRef.current = null;
    }
  }

  function flushLiveAssistantText() {
    liveAssistantFrameRef.current = null;
    setLiveAssistantText(liveAssistantTextRef.current);
  }

  function scheduleLiveAssistantFlush() {
    if (liveAssistantFrameRef.current !== null) return;
    liveAssistantFrameRef.current = window.requestAnimationFrame(flushLiveAssistantText);
  }

  function handleTurnEvent(event: SessionTurnEvent) {
    const terminal = terminalRef.current;
    if (event.type === 'turn.started') {
      flushTerminalWrites();
      cancelLiveAssistantFlush();
      lastStreamStatusAtRef.current = 0;
      streamActivityPushedRef.current = false;
      setAgentPhase('thinking');
      setLiveAssistantText('');
      liveAssistantTextRef.current = '';
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
      const streaming = event.phase === 'streaming';
      setAgentPhase(streaming ? 'streaming' : 'thinking');
      setStatusText(`${streaming ? '응답 작성 중' : '생각 중'} · ${seconds}초`);
      if (seconds > 0 && seconds % 10 === 0) pushActivity(`${event.phase === 'streaming' ? '응답 수신 중' : '응답 대기 중'} ${seconds}초`);
      return;
    }
    if (event.type === 'turn.delta' && event.text) {
      const now = Date.now();
      if (now - lastStreamStatusAtRef.current > 250) {
        lastStreamStatusAtRef.current = now;
        setStatusText('응답 작성 중');
      }
      setAgentPhase('streaming');
      if (!streamActivityPushedRef.current) {
        streamActivityPushedRef.current = true;
        pushActivity('응답 스트리밍');
      }
      liveAssistantTextRef.current += event.text || '';
      scheduleLiveAssistantFlush();
      queueTerminalWrite(event.text);
      return;
    }
    if (event.type === 'artifact.created') {
      flushTerminalWrites();
      terminal?.writeln('');
      terminal?.writeln(`artifact: ${event.artifact?.title || event.artifact?.kind || 'created'}`);
      setAgentPhase('working');
      setStatusText('결과 정리 중');
      pushActivity(`결과물 생성 ${event.artifact?.kind || ''}`.trim());
      if (event.artifact) setArtifacts(current => [event.artifact as AgentArtifact, ...current.filter(item => item.id !== event.artifact?.id)]);
      return;
    }
    if (event.type === 'turn.done') {
      flushTerminalWrites();
      if (liveAssistantFrameRef.current !== null) {
        window.cancelAnimationFrame(liveAssistantFrameRef.current);
        flushLiveAssistantText();
      }
      setStatusText('완료');
      setAgentPhase('done');
      if (event.session) {
        setSessions(current => current.map(item => item.id === event.session?.id ? event.session : item));
      }
      if (event.message) {
        setMessages(current => [...current.filter(message => message.id !== event.message?.id), event.message as AgentMessage]);
      } else if (liveAssistantTextRef.current.trim()) {
        setMessages(current => [...current, {
          id: `assistant-${Date.now()}`,
          turnId: event.turnId || '',
          role: 'assistant',
          text: liveAssistantTextRef.current,
          createdAt: new Date().toISOString(),
        }]);
      }
      setLiveAssistantText('');
      liveAssistantTextRef.current = '';
      terminal?.writeln('');
      terminal?.writeln('✓ done');
      pushActivity('응답 완료');
      return;
    }
    if (event.type === 'turn.error') {
      flushTerminalWrites();
      setStatusText('오류');
      setAgentPhase('error');
      setError(event.error || '세션 실행 중 오류가 발생했습니다.');
      terminal?.writeln('');
      terminal?.writeln(`error: ${event.error || 'unknown error'}`);
      pushActivity(`오류 ${event.error || ''}`.trim());
      return;
    }
    if (event.type === 'turn.stopped') {
      flushTerminalWrites();
      cancelLiveAssistantFlush();
      setStatusText('중단됨');
      setAgentPhase('stopped');
      setLiveAssistantText('');
      liveAssistantTextRef.current = '';
      terminal?.writeln('');
      terminal?.writeln('stopped');
      pushActivity('사용자 중단');
    }
  }

  function clearComposerInput() {
    setInput('');
    window.setTimeout(() => setInput(''), 0);
    window.setTimeout(() => setInput(''), 30);
  }

  async function runTurn(message: string, attachments: unknown[], outputHints: Record<string, unknown>, options: { clearInput?: boolean } = {}) {
    if (!message.trim() || sending) return false;
    let sessionId = selectedSessionId;
    setSending(true);
    setError('');
    setAgentPhase('preparing');
    let succeeded = false;
    try {
      if (!sessionId) {
        const data = await createAgentSession('claude', { type: 'project' });
        sessionId = data.session.id;
        runningTurnSessionIdRef.current = sessionId;
        setSessions(current => [data.session, ...current]);
        setSelectedSessionId(sessionId);
      } else {
        runningTurnSessionIdRef.current = sessionId;
      }
      const turnContext = { message, attachments, outputHints };
      await onTurnStart?.(turnContext);
      setMessages(current => [...current, {
        id: `user-${Date.now()}`,
        turnId: '',
        role: 'user',
        text: message,
        attachments,
        outputHints,
        createdAt: new Date().toISOString(),
      }]);
      terminalRef.current?.writeln('');
      terminalRef.current?.writeln(`› ${message}`);
      if (options.clearInput) {
        clearComposerInput();
        setClarifierDraft(null);
        setClarifierAnswer('');
      }
      const controller = new AbortController();
      turnAbortRef.current = controller;
      await sendSessionTurn(sessionId, {
        message,
        attachments,
        outputHints,
      }, handleTurnEvent, controller.signal);
      await onTurnSettled?.(turnContext);
      await refreshSessions();
      setCanRestart(true);
      succeeded = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatusText('중단됨');
        setAgentPhase('stopped');
      } else {
        setAgentPhase('error');
        setError(err instanceof Error ? err.message : String(err));
      }
      await onTurnSettled?.({ message, attachments, outputHints });
    } finally {
      turnAbortRef.current = null;
      if (runningTurnSessionIdRef.current === sessionId) runningTurnSessionIdRef.current = '';
      setSending(false);
    }
    return succeeded;
  }

  async function sendTurn() {
    const message = input.trim();
    if (!message || sending) return;
    if (composeMode === 'clarify' && !clarifierDraft) {
      setClarifierDraft(createClarifierDraft(message));
      setClarifierAnswer('');
      return;
    }
    const attachments = uniqueContextAttachments([
      ...contextChips,
      ...(selectedContext ? [selectedContext] : []),
    ]);
    const outgoingMessage = clarifierDraft
      ? buildClarifiedPrompt(clarifierDraft.original, clarifierDraft.question, clarifierAnswer)
      : message;
    const sent = await runTurn(
      outgoingMessage,
      attachments,
      {
        contextMode,
        turnType: contextMode === 'project' ? 'project' : attachments.length ? 'selection' : 'chat',
        composeMode,
        originalInput: clarifierDraft?.original,
        clarificationQuestion: clarifierDraft?.question,
        clarificationAnswer: clarifierAnswer,
      },
      { clearInput: true },
    );
    if (sent && contextChips.length && attachments.length) onClearContextChips();
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
        if (event.type === 'terminal.data' && event.data) queueTerminalWrite(event.data);
        if (event.type === 'terminal.exit') {
          flushTerminalWrites();
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
      flushTerminalWrites();
      pushActivity('Interactive terminal 종료');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedSession = sessions.find(item => item.id === selectedSessionId);
  const visibleMessages = liveAssistantText
    ? [...messages, {
      id: 'live-assistant',
      turnId: '',
      role: 'assistant' as const,
      text: liveAssistantText,
      createdAt: new Date().toISOString(),
    }]
    : messages;
  const timeline = buildTimeline(agentPhase, statusText, artifacts.length, changedFilesCount);
  const contextChars = contextChips.reduce((sum, item) => sum + item.text.length, 0);
  const sendActionLabel = clarifierDraft
    ? '최종 프롬프트 보내기'
    : composeMode === 'clarify'
      ? '확인 질문 만들기'
      : '보내기';

  return (
    <aside className="agent-panel">
      <div className="agent-workspace-header">
        <div>
          <span>AI 대화</span>
          <small>{selectedSession ? `${selectedSession.agent === 'claude' ? 'Claude' : 'Codex'} · ${statusText}` : statusText}</small>
        </div>
        <div className="agent-header-actions">
          <button type="button" onClick={() => newSession('claude')}>새 Claude</button>
          <button type="button" onClick={() => newSession('codex')}>새 Codex</button>
          <button type="button" disabled={!selectedSessionId || sending} onClick={closeSelectedSession}>세션 닫기</button>
          <button type="button" onClick={() => setSettingsOpen(true)}>설정</button>
          {onCollapse ? <button type="button" onClick={onCollapse}>접기</button> : null}
        </div>
      </div>

      <div className="session-list redesigned">
        {sessions.map(session => (
          <div className={`session-row-wrap ${session.id === selectedSessionId ? 'active' : ''} ${session.agent}`} key={session.id}>
            <button type="button" onClick={() => setSelectedSessionId(session.id)}>
              <span>{session.agent === 'claude' ? 'Claude' : 'Codex'}</span>
              <small>{session.status || 'idle'}</small>
            </button>
          </div>
        ))}
        {!sessions.length ? <span className="empty-note">세션 없음</span> : null}
      </div>

      {error ? <div className="editor-error">{error}</div> : null}

      <div className="agent-tab-body conversation-only">
        <section className="agent-tab-panel active">
          <div className={`agent-status-card ${agentPhase}`}>
            <span className="agent-status-pulse" aria-hidden="true" />
            <div>
              <strong>{phaseLabel(agentPhase)}</strong>
              <small>{statusText}</small>
            </div>
            {sending ? <button type="button" className="stop-button" onClick={stopTurn}>응답 중단</button> : null}
          </div>
          <div className="agent-compact-steps" aria-label="AI 진행 단계">
            {timeline.map(step => (
              <span className={`agent-step-chip ${step.state}`} key={step.id}>{step.label}</span>
            ))}
          </div>
          <section className={`agent-conversation-section ${conversationOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="agent-conversation-toggle"
              aria-expanded={conversationOpen}
              onClick={() => setConversationOpen(current => !current)}
            >
              <span>AI 대화</span>
              <small>{visibleMessages.length ? `${visibleMessages.length}개` : '접힘'}</small>
            </button>
            {conversationOpen ? (
              <div className="agent-conversation" aria-label="AI 대화">
                {visibleMessages.length ? visibleMessages.map(message => (
                  <article
                    className={`agent-message ${message.role} ${message.role === 'assistant' ? selectedSession?.agent || 'claude' : ''}`}
                    key={message.id}
                  >
                    <header>{message.role === 'user' ? '나' : selectedSession?.agent === 'codex' ? 'Codex' : 'Claude'}</header>
                    <div className="agent-message-body">
                      {message.role === 'assistant'
                        ? renderAgentMarkdown(message.text || '(내용 없음)')
                        : <p>{message.text || '(내용 없음)'}</p>}
                    </div>
                  </article>
                )) : (
                  <div className="agent-empty-chat" aria-hidden="true" />
                )}
                {changedFilesCount > 0 && changedFilesPanel ? (
                  <article className="agent-message assistant review-result">
                    <header>변경 결과</header>
                    <div className="agent-review-result-card">
                      <div className="agent-review-result-summary">
                        <strong>AI가 바꾼 파일 {changedFilesCount}건을 검토할 수 있습니다.</strong>
                        <span>필요한 변경만 열어서 비교하고 저장하세요.</span>
                      </div>
                      <div className="embedded-changed-files">
                        {changedFilesPanel}
                      </div>
                    </div>
                  </article>
                ) : null}
              </div>
            ) : null}
          </section>
          <details className="agent-advanced-details">
            <summary>실행 정보와 고급 로그</summary>
            <div className="agent-run-metadata">
              <span>{activityLines.length ? activityLines[activityLines.length - 1] : '아직 실행 기록이 없습니다.'}</span>
              <small>
                입력 {input.trim().length.toLocaleString()}자
                {promptChars ? ` · 마지막 전체 ${promptChars.toLocaleString()}자` : ' · 마지막 전체 0자'}
                {inputChars ? ` · 마지막 입력 ${inputChars.toLocaleString()}자` : ''}
                {promptMeta ? ` · ${promptMeta}` : ''}
              </small>
            </div>
            {artifacts.length ? (
              <div className="artifact-results">
                <div className="result-section-title">
                  <span>결과물</span>
                  <small>{artifacts.length}개</small>
                </div>
                {artifacts.map(artifact => (
                  <button
                    type="button"
                    className="artifact-card"
                    key={artifact.id}
                    disabled={!artifact.fileId || !(artifact.proposedContent || artifact.content)}
                    onClick={() => onReviewArtifact(artifact)}
                    title={artifact.fileId || artifact.kind}
                  >
                    <strong>{artifact.title || artifact.kind}</strong>
                    <small>{artifact.fileId || '검토 가능한 파일 없음'}</small>
                  </button>
                ))}
              </div>
            ) : null}
            <div className={`raw-log-panel ${rawLogOpen ? 'open' : ''}`}>
              <div className="terminal-toolbar">
                <div>
                  <strong>고급 로그</strong>
                  <small>{runtime ? runtimeLabel(runtime) : '런타임 확인 중'}</small>
                </div>
                <button type="button" onClick={() => setRawLogOpen(current => !current)}>
                  {rawLogOpen ? '로그 접기' : '로그 보기'}
                </button>
                {rawLogOpen ? (
                  terminalSessionId ? (
                    <button type="button" onClick={stopInteractiveTerminal}>터미널 닫기</button>
                  ) : (
                    <button type="button" disabled={sending} onClick={startInteractiveTerminal}>터미널 열기</button>
                  )
                ) : null}
              </div>
              <div className="terminal-host" ref={hostRef} />
            </div>
          </details>
        </section>
      </div>

      <section className="context-reference-panel compact">
        <div className="context-strip redesigned">
          <span>
            <strong>참고 내용</strong>
            {contextChips.length
              ? `추가한 내용 ${contextChips.length}개 · ${contextChars.toLocaleString()}자`
              : selectedContext
                ? `${selectedContext.fileId} · ${selectedContext.text.length.toLocaleString()}자 선택됨`
                : '없음'}
          </span>
          <em>{contextModeDisplayLabel(contextModeOverride, contextMode)}</em>
        </div>
      </section>
      <div className="agent-composer">
        <div className="agent-controls">
          <label>
            <span>참고 범위</span>
            <select value={contextModeOverride} onChange={event => setContextModeOverride(event.target.value)} disabled={sending}>
              <option value="auto">자동</option>
              <option value="selection">추가한 참고 내용만</option>
              <option value="document">현재 문서 전체</option>
              <option value="project">프로젝트 전체</option>
            </select>
          </label>
          <label>
            <span>보내는 방식</span>
            <select
              value={composeMode}
              onChange={event => {
                setComposeMode(event.target.value === 'clarify' ? 'clarify' : 'instant');
                setClarifierDraft(null);
                setClarifierAnswer('');
              }}
              disabled={sending}
            >
              <option value="instant">바로 보내기</option>
              <option value="clarify">보내기 전에 확인 질문 받기</option>
            </select>
          </label>
        </div>
        {clarifierDraft ? (
          <div className="prompt-package-preview">
            <strong>프롬프트 패키지 확인</strong>
            <span>원본 입력</span>
            <p>{clarifierDraft.original}</p>
            <span>확인 질문</span>
            <p>{clarifierDraft.question}</p>
            <textarea
              value={clarifierAnswer}
              placeholder="답변을 입력하면 최종 프롬프트에 반영됩니다."
              onChange={event => setClarifierAnswer(event.currentTarget.value)}
            />
            <span>최종 전달 프롬프트</span>
            <pre>{buildClarifiedPrompt(clarifierDraft.original, clarifierDraft.question, clarifierAnswer)}</pre>
          </div>
        ) : null}
        <textarea
          value={input}
          placeholder="무엇을 도와주면 될지 입력하세요."
          onChange={event => setInput(event.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || composingRef.current)) {
              event.preventDefault();
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendTurn();
            }
          }}
        />
        {sending ? (
          <button type="button" className="stop-button" onClick={stopTurn}>응답 중단</button>
        ) : (
          <button type="button" className="icon-send-button" disabled={!input.trim()} onClick={sendTurn} aria-label={sendActionLabel} title={sendActionLabel}>
            <SendActionIcon mode={clarifierDraft || composeMode === 'clarify' ? 'clarify' : 'send'} />
            <span className="sr-only">{sendActionLabel}</span>
          </button>
        )}
      </div>
      <div className="agent-secondary-actions">
        <button type="button" disabled={!selectedSessionId || sending || !canRestart} onClick={restartLastTurn}>마지막 요청 다시 실행</button>
      </div>
      {settingsOpen ? (
        <div className="agent-settings-modal" role="dialog" aria-label="AI 설정">
          <div className="agent-settings-backdrop" onClick={() => setSettingsOpen(false)} />
          <div className="agent-settings-surface">
            <header>
              <span>설정</span>
              <button type="button" onClick={() => setSettingsOpen(false)}>닫기</button>
            </header>
            {settingsPanel}
          </div>
        </div>
      ) : null}
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

function createClarifierDraft(original: string) {
  const question = isAmbiguousRequest(original)
    ? '목표, 원하는 출력 형식, 반드시 지켜야 할 제약 중 빠진 부분을 알려주세요.'
    : '최종 전달 전에 추가로 반영할 조건이 있으면 적어주세요.';
  return { original, question };
}

function buildClarifiedPrompt(original: string, question: string, answer: string) {
  const parts = [
    '다음 요청을 사용자의 확인 답변까지 반영해 수행하세요.',
    '',
    '원본 요청:',
    original.trim(),
    '',
    '확인 질문:',
    question.trim(),
  ];
  if (answer.trim()) {
    parts.push('', '사용자 답변:', answer.trim());
  }
  return parts.join('\n');
}

function isAmbiguousRequest(text: string) {
  const normalized = text.trim();
  if (normalized.length < 24) return true;
  return /(좋게|개선|정리|해줘|만들어줘|고쳐줘|알아서|적당히)$/u.test(normalized);
}

function renderAgentMarkdown(text: string): ReactNode[] {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let index = 0;

  const takeParagraph = () => {
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (isBlockStart(lines[index], lines[index + 1])) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length) {
      nodes.push(<p key={`p-${index}`}>{renderInlineMarkdown(paragraph.join('\n'), `p-${index}`)}</p>);
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```(\w+)?/);
    if (fence) {
      const lang = fence[1] || '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <pre className="agent-markdown-code" key={`code-${index}`}>
          <code data-lang={lang}>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInlineMarkdown(heading[2], `h-${index}`);
      if (level === 1) nodes.push(<h2 key={`h-${index}`}>{content}</h2>);
      else if (level === 2) nodes.push(<h3 key={`h-${index}`}>{content}</h3>);
      else nodes.push(<h4 key={`h-${index}`}>{content}</h4>);
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      nodes.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    if (isTableStart(line, lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        tableLines.push(lines[index]);
        index += 1;
      }
      nodes.push(renderMarkdownTable(tableLines, `table-${index}`));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      nodes.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item, `ul-${index}-${itemIndex}`)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
        index += 1;
      }
      nodes.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item, `ol-${index}-${itemIndex}`)}</li>)}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      nodes.push(<blockquote key={`quote-${index}`}>{renderInlineMarkdown(quote.join('\n'), `quote-${index}`)}</blockquote>);
      continue;
    }

    takeParagraph();
  }

  return nodes.length ? nodes : [<p key="empty">(내용 없음)</p>];
}

function isBlockStart(line = '', nextLine = '') {
  const trimmed = line.trim();
  return Boolean(
    trimmed.startsWith('```')
    || /^(#{1,4})\s+/.test(trimmed)
    || /^---+$/.test(trimmed)
    || /^\s*[-*]\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || /^>\s?/.test(line)
    || isTableStart(line, nextLine),
  );
}

function isTableStart(line = '', nextLine = '') {
  return line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(nextLine);
}

function renderMarkdownTable(tableLines: string[], key: string) {
  const rows = tableLines
    .filter((_, index) => index !== 1)
    .map(line => splitMarkdownTableRow(line));
  const [head = [], ...body] = rows;
  return (
    <div className="agent-markdown-table-wrap" key={key}>
      <table>
        <thead>
          <tr>{head.map((cell, index) => <th key={index}>{renderInlineMarkdown(cell, `${key}-h-${index}`)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {head.map((_, cellIndex) => (
                <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] || '', `${key}-${rowIndex}-${cellIndex}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function splitMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(...renderTextWithBreaks(text.slice(lastIndex, match.index), `${keyPrefix}-t-${lastIndex}`));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{renderInlineMarkdown(token.slice(2, -2), `${key}-strong`)}</strong>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(link ? <a href={link[2]} key={key}>{link[1]}</a> : token);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(...renderTextWithBreaks(text.slice(lastIndex), `${keyPrefix}-t-${lastIndex}`));
  return nodes;
}

function renderTextWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split('\n');
  const nodes: ReactNode[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    nodes.push(parts[index]);
    if (index < parts.length - 1) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
  }
  return nodes;
}

function phaseLabel(phase: AgentPhase) {
  if (phase === 'preparing') return '요청 준비 중';
  if (phase === 'thinking') return '생각 중';
  if (phase === 'streaming') return '응답 작성 중';
  if (phase === 'working') return '작업 중';
  if (phase === 'done') return '완료';
  if (phase === 'stopped') return '중단됨';
  if (phase === 'error') return '오류';
  return '대기 중';
}

function buildTimeline(phase: AgentPhase, statusText: string, artifactCount: number, changedFilesCount: number): TimelineStep[] {
  const order: AgentPhase[] = ['preparing', 'thinking', 'streaming', 'working', 'done'];
  const activeIndex = Math.max(0, order.indexOf(phase));
  const stateFor = (index: number): TimelineStep['state'] => {
    if (phase === 'error') return index <= Math.max(activeIndex, 1) ? 'error' : 'pending';
    if (phase === 'stopped') return index <= Math.max(activeIndex, 1) ? 'done' : 'pending';
    if (phase === 'idle') return 'pending';
    if (phase === 'done') return 'done';
    if (index < activeIndex) return 'done';
    if (index === activeIndex) return 'active';
    return 'pending';
  };
  return [
    { id: 'prepare', label: '요청 준비', state: stateFor(0), detail: '문맥과 프롬프트 구성' },
    { id: 'think', label: '생각 중', state: stateFor(1), detail: statusText },
    { id: 'stream', label: '응답 작성', state: stateFor(2), detail: '답변을 화면에 표시' },
    { id: 'result', label: '결과 정리', state: stateFor(3), detail: `${artifactCount + changedFilesCount}개 결과` },
    { id: 'done', label: phase === 'error' ? '오류' : phase === 'stopped' ? '중단' : '완료', state: stateFor(4), detail: statusText },
  ];
}

function contextModeDisplayLabel(mode: string, effectiveMode: string) {
  if (mode === 'auto') return '자동';
  if (effectiveMode === 'selection') return '추가한 참고 내용만';
  if (effectiveMode === 'document') return '현재 문서 전체';
  if (effectiveMode === 'project') return '프로젝트 전체';
  return '참고 내용 없음';
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

function SendActionIcon({ mode }: { mode: 'send' | 'clarify' }) {
  if (mode === 'clarify') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M9.5 9a2.7 2.7 0 0 1 5.1 1.2c0 2.1-2.7 2.3-2.7 4.2" />
        <path d="M12 18h.01" />
        <path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m4 12 16-8-5 16-3-7-8-1Z" />
      <path d="m12 13 8-9" />
    </svg>
  );
}
