import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, DotsSixVertical, Plus, Trash, X } from '@phosphor-icons/react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  acknowledgeTerminalFrame,
  getTerminalSnapshot,
  listTerminalSessions,
  resizeTerminalSession,
  sendTerminalInput,
  startTerminalSession,
  stopTerminalSession,
  watchTerminalSession,
  type TerminalSessionSummary,
} from '../../shared/bridge-client';

type TerminalPaneProps = {
  position: 'left' | 'right' | 'top' | 'bottom';
  theme: 'light' | 'dark';
  onPositionChange: (position: 'left' | 'right' | 'top' | 'bottom') => void;
  onPanePointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPaneKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onClose: () => void;
};

const TERMINAL_THEME = {
  dark: {
    background: '#0d0f12',
    foreground: '#d7d9de',
    cursor: '#d7d9de',
    selectionBackground: '#33415580',
    black: '#17191e',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#d7d9de',
  },
  light: {
    background: '#fbfbfc',
    foreground: '#24262b',
    cursor: '#24262b',
    selectionBackground: '#bfdbfe99',
    black: '#24262b',
    red: '#b4233c',
    green: '#267344',
    yellow: '#8a5a00',
    blue: '#145dbf',
    magenta: '#7b3fa0',
    cyan: '#0c7080',
    white: '#f8f9fa',
  },
} as const;

const TERMINAL_FONT_FAMILY = '"MesloLGS NF", "JetBrainsMono Nerd Font", "Hack Nerd Font", "Symbols Nerd Font Mono", "Geist Mono", "SFMono-Regular", Menlo, monospace';

export function TerminalPane({ position, theme, onPositionChange, onPanePointerDown, onPaneKeyDown, onClose }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const stopWatchingRef = useRef<(() => void) | null>(null);
  const viewIdRef = useRef(crypto.randomUUID());
  const lastSeqRef = useRef(0);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeId, setActiveId] = useState('');
  const [error, setError] = useState('');
  const activeSession = sessions.find(session => session.id === activeId) || null;

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 1.28,
      scrollback: 5000,
      theme: TERMINAL_THEME[theme],
    });
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    const input = terminal.onData(data => {
      if (activeId) void sendTerminalInput(activeId, data).catch(reportError);
    });
    const resizeObserver = new ResizeObserver(() => resizeTerminalToHost(terminal, hostRef.current, activeId));
    resizeObserver.observe(hostRef.current);
    resizeTerminalToHost(terminal, hostRef.current, activeId);
    return () => {
      input.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [activeId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.theme = TERMINAL_THEME[theme];
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    listTerminalSessions()
      .then(result => {
        if (cancelled) return;
        setSessions(result.sessions);
        setActiveId(current => current || result.sessions[0]?.id || '');
      })
      .catch(reportError);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    stopWatchingRef.current?.();
    stopWatchingRef.current = null;
    lastSeqRef.current = 0;
    const terminal = terminalRef.current;
    if (!activeId || !terminal) {
      terminal?.reset();
      return;
    }
    terminal.reset();
    stopWatchingRef.current = watchTerminalSession(activeId, event => {
      if (event.type === 'terminal.snapshot' && event.snapshot) {
        terminal.reset();
        lastSeqRef.current = event.snapshot.lastSeq;
        terminal.write(event.snapshot.data, () => acknowledge(activeId, event.snapshot?.lastSeq || 0));
      } else if (event.type === 'terminal.frame' && event.data && event.seq && event.seq > lastSeqRef.current) {
        lastSeqRef.current = event.seq;
        terminal.write(event.data, () => acknowledge(activeId, event.seq || 0));
      } else if (event.type === 'terminal.restore-needed') {
        void restoreSnapshot(activeId, terminal);
      } else if (event.type === 'terminal.exit') {
        setSessions(current => current.map(session => session.id === activeId ? { ...session, status: 'closed' } : session));
      }
    }, () => setError('Terminal session connection lost'), lastSeqRef.current);
    return () => {
      stopWatchingRef.current?.();
      stopWatchingRef.current = null;
    };
  }, [activeId]);

  async function createTerminal() {
    setError('');
    try {
      const result = await startTerminalSession({ title: `Terminal ${sessions.length + 1}` });
      setSessions(current => [...current, result.session]);
      setActiveId(result.session.id);
    } catch (cause) {
      reportError(cause);
    }
  }

  async function closeTerminal(id: string) {
    try {
      await stopTerminalSession(id);
    } catch {}
    setSessions(current => {
      const remaining = current.filter(session => session.id !== id);
      if (activeId === id) setActiveId(remaining[0]?.id || '');
      return remaining;
    });
  }

  function reportError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }

  return (
    <section className="terminal-pane" aria-label="Terminal sessions">
      <header className="terminal-tabbar">
        <button
          className="terminal-pane-drag-handle"
          type="button"
          draggable={false}
          aria-label="Drag terminal pane. Use Alt plus arrow keys to move."
          title="Drag terminal pane"
          onPointerDown={onPanePointerDown}
          onKeyDown={onPaneKeyDown}
        >
          <DotsSixVertical size={16} weight="bold" />
        </button>
        <div className="terminal-tabs" role="tablist" aria-label="Open terminals">
          {sessions.map(session => (
            <button
              className={`terminal-tab ${session.id === activeId ? 'active' : ''}`}
              key={session.id}
              type="button"
              role="tab"
              aria-selected={session.id === activeId}
              onClick={() => setActiveId(session.id)}
            >
              <span>{session.title}</span>
              <X size={12} weight="bold" onClick={event => { event.stopPropagation(); void closeTerminal(session.id); }} />
            </button>
          ))}
          <button className="terminal-icon-button" type="button" aria-label="New terminal" title="New terminal" onClick={createTerminal}>
            <Plus size={14} />
          </button>
          <span
            className="terminal-tabbar-drag-surface"
            draggable={false}
            role="button"
            tabIndex={0}
            aria-label="Drag terminal pane from tab bar. Use Alt plus arrow keys to move."
            title="Drag terminal pane"
            onPointerDown={onPanePointerDown}
            onKeyDown={onPaneKeyDown}
          />
        </div>
        <div className="terminal-actions">
          {activeSession ? <span className="terminal-shell-label">{shellName(activeSession.shell)}</span> : null}
          <button className={`terminal-icon-button ${position === 'left' ? 'active' : ''}`} type="button" aria-label="Dock terminal left" title="Dock terminal left" onClick={() => onPositionChange('left')}>
            <ArrowLeft size={15} weight={position === 'left' ? 'bold' : 'regular'} />
          </button>
          <button className={`terminal-icon-button ${position === 'top' ? 'active' : ''}`} type="button" aria-label="Dock terminal above" title="Dock terminal above" onClick={() => onPositionChange('top')}>
            <ArrowUp size={15} weight={position === 'top' ? 'bold' : 'regular'} />
          </button>
          <button className={`terminal-icon-button ${position === 'bottom' ? 'active' : ''}`} type="button" aria-label="Dock terminal below" title="Dock terminal below" onClick={() => onPositionChange('bottom')}>
            <ArrowDown size={15} weight={position === 'bottom' ? 'bold' : 'regular'} />
          </button>
          <button className={`terminal-icon-button ${position === 'right' ? 'active' : ''}`} type="button" aria-label="Dock terminal right" title="Dock terminal right" onClick={() => onPositionChange('right')}>
            <ArrowRight size={15} weight={position === 'right' ? 'bold' : 'regular'} />
          </button>
          {activeSession ? (
            <button className="terminal-icon-button" type="button" aria-label="Delete terminal" title="Delete terminal" onClick={() => void closeTerminal(activeSession.id)}>
              <Trash size={15} />
            </button>
          ) : null}
          <button className="terminal-icon-button" type="button" aria-label="Close terminal pane" title="Close terminal pane" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </header>
      {error ? <div className="terminal-error">{error}</div> : null}
      {!sessions.length ? (
        <button className="terminal-empty" type="button" onClick={createTerminal}>
          <Plus size={16} />
          <span>New terminal</span>
          <small>Opens your default login shell</small>
        </button>
      ) : null}
      <div className="terminal-xterm-host" ref={hostRef} />
    </section>
  );

  function acknowledge(sessionId: string, seq: number) {
    if (!seq) return;
    void acknowledgeTerminalFrame(sessionId, viewIdRef.current, seq).catch(() => {});
  }

  async function restoreSnapshot(sessionId: string, terminal: Terminal) {
    try {
      const result = await getTerminalSnapshot(sessionId);
      terminal.reset();
      lastSeqRef.current = result.snapshot.lastSeq;
      terminal.write(result.snapshot.data, () => acknowledge(sessionId, result.snapshot.lastSeq));
    } catch (cause) {
      reportError(cause);
    }
  }
}

function resizeTerminalToHost(terminal: Terminal, host: HTMLDivElement | null, sessionId: string) {
  if (!host || !sessionId) return;
  const cols = Math.max(20, Math.floor(host.clientWidth / 7.3));
  const rows = Math.max(5, Math.floor(host.clientHeight / 16.5));
  if (terminal.cols === cols && terminal.rows === rows) return;
  terminal.resize(cols, rows);
  void resizeTerminalSession(sessionId, cols, rows).catch(() => {});
}

function shellName(shell: string) {
  return shell.split('/').filter(Boolean).pop() || 'shell';
}
