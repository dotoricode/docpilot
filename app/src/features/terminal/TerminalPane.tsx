import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CaretDown, Check, DotsSixVertical, Plus, Trash, X } from '@phosphor-icons/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  acknowledgeTerminalFrame,
  getSettings,
  getTerminalShells,
  getTerminalSnapshot,
  installFishShell,
  listTerminalSessions,
  resizeTerminalSession,
  sendTerminalInput,
  startTerminalSession,
  stopTerminalSession,
  watchTerminalSession,
  type TerminalShell,
  type TerminalShellId,
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

const DEFAULT_TERMINAL_SHELL: TerminalShell = {
  id: 'default',
  label: 'Default shell',
  description: 'Use your macOS login shell',
  available: true,
  installable: false,
  path: '',
};

export function TerminalPane({ position, theme, onPositionChange, onPanePointerDown, onPaneKeyDown, onClose }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chooserRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const stopWatchingRef = useRef<(() => void) | null>(null);
  const viewIdRef = useRef(crypto.randomUUID());
  const lastSeqRef = useRef(0);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeId, setActiveId] = useState('');
  const [error, setError] = useState('');
  const [defaultTerminalShell, setDefaultTerminalShell] = useState<TerminalShellId>('default');
  const [terminalShells, setTerminalShells] = useState<TerminalShell[]>([DEFAULT_TERMINAL_SHELL]);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserMaxHeight, setChooserMaxHeight] = useState(320);
  const [installingFish, setInstallingFish] = useState(false);
  const [installMessage, setInstallMessage] = useState('');
  const activeSession = sessions.find(session => session.id === activeId) || null;
  const defaultShell = terminalShells.find(shell => shell.id === defaultTerminalShell) || DEFAULT_TERMINAL_SHELL;

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
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    let disposed = false;
    const input = terminal.onData(data => {
      if (activeId) void sendTerminalInput(activeId, data).catch(reportError);
    });
    const fit = () => {
      if (!disposed) fitTerminalToHost(terminal, fitAddon, hostRef.current, activeId);
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(hostRef.current);
    fit();
    void document.fonts.ready.then(fit);
    return () => {
      disposed = true;
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
    let cancelled = false;
    const refreshPreferences = () => {
      Promise.all([getSettings(), getTerminalShells()])
        .then(([settingsResponse, shells]) => {
          if (cancelled) return;
          setDefaultTerminalShell(settingsResponse.settings.defaultTerminalShell);
          setTerminalShells(shells.length ? shells : [DEFAULT_TERMINAL_SHELL]);
        })
        .catch(() => {});
    };
    const onSettingsSaved = (event: Event) => {
      const settings = (event as CustomEvent).detail?.settings;
      if (settings?.defaultTerminalShell) setDefaultTerminalShell(settings.defaultTerminalShell);
      void getTerminalShells().then(shells => {
        if (!cancelled && shells.length) setTerminalShells(shells);
      }).catch(() => {});
    };
    refreshPreferences();
    window.addEventListener('docpilot-settings-saved', onSettingsSaved);
    return () => {
      cancelled = true;
      window.removeEventListener('docpilot-settings-saved', onSettingsSaved);
    };
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

  async function createTerminal(shellId: TerminalShellId = defaultTerminalShell) {
    setError('');
    try {
      const result = await startTerminalSession({ title: `Terminal ${sessions.length + 1}`, shellId, cwd: '.' });
      setSessions(current => [...current, result.session]);
      setActiveId(result.session.id);
    } catch (cause) {
      reportError(cause);
    }
  }

  async function launchTerminal(shellId: TerminalShellId) {
    setChooserOpen(false);
    const shell = terminalShells.find(item => item.id === shellId);
    if (!shell?.available) {
      setError(`${shell?.label || 'Selected shell'} is not installed.`);
      return;
    }
    await createTerminal(shellId);
  }

  async function installFish() {
    if (!window.confirm('Homebrew로 fish 셸을 설치할까요?\n\n실행 명령: brew install fish')) return;
    setInstallingFish(true);
    setInstallMessage('Installing fish with Homebrew…');
    setError('');
    try {
      const result = await installFishShell();
      const shells = await getTerminalShells();
      setTerminalShells(shells.length ? shells : [DEFAULT_TERMINAL_SHELL]);
      setDefaultTerminalShell(result.settings.defaultTerminalShell);
      window.dispatchEvent(new CustomEvent('docpilot-settings-saved', { detail: { settings: result.settings } }));
      setInstallMessage('fish installed · Select it to open a terminal');
    } catch (cause) {
      setInstallMessage('');
      reportError(cause);
    } finally {
      setInstallingFish(false);
    }
  }

  function openTerminalChooser() {
    const control = chooserRef.current;
    const pane = control?.closest<HTMLElement>('.terminal-pane');
    if (control && pane) {
      const controlRect = control.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      setChooserMaxHeight(Math.max(80, Math.floor(paneRect.bottom - controlRect.bottom - 8)));
    }
    setChooserOpen(true);
    window.requestAnimationFrame(() => {
      chooserRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
  }

  async function closeTerminal(id: string) {
    setError('');
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
    <section className={`terminal-pane terminal-position-${position} ${chooserOpen ? 'terminal-chooser-open' : ''}`} aria-label="Terminal sessions">
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
          <div
            className="terminal-new-control"
            ref={chooserRef}
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setChooserOpen(false);
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setChooserOpen(false);
                chooserRef.current?.querySelector<HTMLButtonElement>('.terminal-new-menu-button')?.focus();
              }
            }}
          >
            <button
              className="terminal-icon-button terminal-new-primary"
              type="button"
              aria-label={`New terminal with ${defaultShell.label}`}
              title={`New terminal with ${defaultShell.label}`}
              disabled={!defaultShell.available}
              onClick={() => void launchTerminal(defaultShell.id)}
            >
              <Plus size={14} />
              <span>{terminalShellShortLabel(defaultShell)}</span>
            </button>
            <button
              className="terminal-icon-button terminal-new-menu-button"
              type="button"
              aria-label="Choose terminal shell"
              aria-haspopup="menu"
              aria-expanded={chooserOpen}
              title="Choose terminal shell"
              onClick={() => {
                if (chooserOpen) setChooserOpen(false);
                else openTerminalChooser();
              }}
            >
              <CaretDown size={10} weight="bold" />
            </button>
            {chooserOpen ? (
              <div
                className="terminal-shell-menu"
                role="menu"
                aria-label="Terminal shells"
                style={{ maxHeight: chooserMaxHeight }}
              >
                {terminalShells.map(shell => (
                  <button
                    key={shell.id}
                    type="button"
                    role="menuitem"
                    disabled={installingFish || (!shell.available && !shell.installable)}
                    onClick={() => {
                      if (shell.available) void launchTerminal(shell.id);
                      else if (shell.id === 'fish' && shell.installable) void installFish();
                    }}
                  >
                    <span>
                      <strong>{shell.label}</strong>
                      <small>{shell.description}{shell.available ? '' : ' · Not installed'}</small>
                    </span>
                    {shell.id === 'fish' && !shell.available && shell.installable
                      ? <span className="terminal-shell-action">{installingFish ? 'Installing…' : 'Install'}</span>
                      : shell.id === defaultTerminalShell ? <Check size={14} aria-label="Default shell" /> : null}
                  </button>
                ))}
                <div className={`terminal-shell-menu-hint ${installMessage ? 'active' : ''}`}>
                  {installMessage || 'Runs inside DocPilot · Change the default in Settings'}
                </div>
              </div>
            ) : null}
          </div>
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
        <div className="terminal-empty">
          <button className="terminal-empty-primary" type="button" disabled={!defaultShell.available} onClick={() => void launchTerminal(defaultShell.id)}>
            <Plus size={16} />
            <span>New terminal with {defaultShell.label}</span>
          </button>
          <button className="terminal-empty-choose" type="button" onClick={openTerminalChooser}>Choose shell…</button>
          <small>{defaultShell.available ? 'Opens inside DocPilot' : 'The default shell is not installed'}</small>
        </div>
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

function fitTerminalToHost(terminal: Terminal, fitAddon: FitAddon, host: HTMLDivElement | null, sessionId: string) {
  if (!host || !sessionId) return;
  fitAddon.fit();
  void resizeTerminalSession(sessionId, terminal.cols, terminal.rows).catch(() => {});
}

function shellName(shell: string) {
  return shell.split('/').filter(Boolean).pop() || 'shell';
}

function terminalShellShortLabel(shell: TerminalShell) {
  return shell.id === 'default' ? 'Default' : shell.label;
}
