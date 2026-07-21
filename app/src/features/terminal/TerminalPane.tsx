import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
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
const MODIFIED_ENTER_SEQUENCE = '\x1b\r';
const TERMINAL_VERTICAL_ARROW_SEQUENCE = {
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
} as const;

const DEFAULT_TERMINAL_SHELL: TerminalShell = {
  id: 'default',
  label: 'Default shell',
  description: 'Use your macOS login shell',
  available: true,
  installable: false,
  path: '',
};

export function TerminalPane({ position, theme, onPositionChange, onPanePointerDown, onPaneKeyDown, onClose }: TerminalPaneProps) {
  const paneRef = useRef<HTMLElement | null>(null);
  const chooserRef = useRef<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeId, setActiveId] = useState('');
  const [primaryId, setPrimaryId] = useState('');
  const [secondaryId, setSecondaryId] = useState('');
  const [focusedView, setFocusedView] = useState<'primary' | 'secondary'>('primary');
  const [terminalSplitOrientation, setTerminalSplitOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
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
    let cancelled = false;
    listTerminalSessions()
      .then(result => {
        if (cancelled) return;
        setSessions(result.sessions);
        const firstId = result.sessions[0]?.id || '';
        setActiveId(current => current || firstId);
        setPrimaryId(current => current || firstId);
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
    const handleTerminalSplitShortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !paneRef.current?.contains(target)) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'd') return;
      event.preventDefault();
      event.stopPropagation();
      void splitTerminal(event.shiftKey ? 'vertical' : 'horizontal');
    };
    window.addEventListener('keydown', handleTerminalSplitShortcut, true);
    return () => window.removeEventListener('keydown', handleTerminalSplitShortcut, true);
  }, [activeId, defaultShell.available, defaultTerminalShell, primaryId, secondaryId, sessions.length]);

  async function createTerminal(shellId: TerminalShellId = defaultTerminalShell, targetView = focusedView) {
    setError('');
    try {
      const result = await startTerminalSession({ title: `Terminal ${sessions.length + 1}`, shellId, cwd: '.' });
      setSessions(current => [...current, result.session]);
      showSessionInView(result.session.id, targetView);
      return result.session;
    } catch (cause) {
      reportError(cause);
      return null;
    }
  }

  async function splitTerminal(orientation: 'horizontal' | 'vertical') {
    setTerminalSplitOrientation(orientation);
    if (secondaryId) return;
    if (!defaultShell.available) {
      setError('The default shell is not installed.');
      return;
    }
    setError('');
    try {
      let baseId = activeId || primaryId;
      if (!baseId) {
        const first = await startTerminalSession({ title: `Terminal ${sessions.length + 1}`, shellId: defaultTerminalShell, cwd: '.' });
        baseId = first.session.id;
        setSessions(current => [...current, first.session]);
        setPrimaryId(baseId);
        setFocusedView('primary');
        setActiveId(baseId);
      }
      const second = await startTerminalSession({ title: `Terminal ${sessions.length + (activeId || primaryId ? 1 : 2)}`, shellId: defaultTerminalShell, cwd: '.' });
      setSessions(current => [...current, second.session]);
      setPrimaryId(baseId);
      setSecondaryId(second.session.id);
      setFocusedView('secondary');
      setActiveId(second.session.id);
    } catch (cause) {
      reportError(cause);
    }
  }

  function showSessionInView(id: string, targetView = focusedView) {
    if (id === primaryId) {
      setFocusedView('primary');
    } else if (id === secondaryId) {
      setFocusedView('secondary');
    } else if (targetView === 'secondary' && secondaryId) {
      setSecondaryId(id);
      setFocusedView('secondary');
    } else {
      setPrimaryId(id);
      setFocusedView('primary');
    }
    setActiveId(id);
  }

  function focusTerminalView(view: 'primary' | 'secondary', id: string) {
    setFocusedView(view);
    setActiveId(id);
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
    const remaining = sessions.filter(session => session.id !== id);
    setSessions(remaining);
    if (id === secondaryId) {
      setSecondaryId('');
      setFocusedView('primary');
      setActiveId(primaryId || remaining[0]?.id || '');
      return;
    }
    if (id === primaryId) {
      const nextPrimary = secondaryId || remaining[0]?.id || '';
      setPrimaryId(nextPrimary);
      setSecondaryId('');
      setFocusedView('primary');
      setActiveId(nextPrimary);
      return;
    }
    if (activeId === id) setActiveId(primaryId || remaining[0]?.id || '');
  }

  function reportError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }

  return (
    <section ref={paneRef} className={`terminal-pane terminal-position-${position} ${chooserOpen ? 'terminal-chooser-open' : ''}`} aria-label="Terminal sessions">
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
              onClick={() => showSessionInView(session.id)}
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
      <div className="terminal-error" role={error ? 'alert' : undefined}>{error}</div>
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
      {primaryId ? (
        <div
          className={`terminal-view-layout ${secondaryId ? `split-${terminalSplitOrientation}` : 'single'}`}
          data-split-orientation={secondaryId ? terminalSplitOrientation : 'none'}
        >
          <TerminalViewport
            key={`primary-${primaryId}`}
            sessionId={primaryId}
            theme={theme}
            active={activeId === primaryId}
            fitSignal={`${position}:${terminalSplitOrientation}:${secondaryId ? 'split' : 'single'}`}
            onFocus={() => focusTerminalView('primary', primaryId)}
            onExit={() => setSessions(current => current.map(session => session.id === primaryId ? { ...session, status: 'closed' } : session))}
            onError={reportError}
          />
          {secondaryId ? <div className="terminal-view-divider" aria-hidden="true" /> : null}
          {secondaryId ? (
            <TerminalViewport
              key={`secondary-${secondaryId}`}
              sessionId={secondaryId}
              theme={theme}
              active={activeId === secondaryId}
              fitSignal={`${position}:${terminalSplitOrientation}:split`}
              onFocus={() => focusTerminalView('secondary', secondaryId)}
              onExit={() => setSessions(current => current.map(session => session.id === secondaryId ? { ...session, status: 'closed' } : session))}
              onError={reportError}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type TerminalViewportProps = {
  sessionId: string;
  theme: 'light' | 'dark';
  active: boolean;
  fitSignal: string;
  onFocus: () => void;
  onExit: () => void;
  onError: (cause: unknown) => void;
};

function TerminalViewport({ sessionId, theme, active, fitSignal, onFocus, onExit, onError }: TerminalViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitTerminalRef = useRef<() => void>(() => {});
  const stopWatchingRef = useRef<(() => void) | null>(null);
  const viewIdRef = useRef(crypto.randomUUID());
  const lastSeqRef = useRef(0);
  const onExitRef = useRef(onExit);
  const onErrorRef = useRef(onError);
  onExitRef.current = onExit;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
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
    let fitFrame = 0;
    let settleTimer = 0;
    terminal.attachCustomKeyEventHandler(event => {
      if (
        event.type === 'keydown'
        && !event.shiftKey
        && !event.ctrlKey
        && event.metaKey !== event.altKey
        && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        const sequence = event.key === 'ArrowUp' || event.key === 'ArrowDown'
          ? TERMINAL_VERTICAL_ARROW_SEQUENCE[event.key]
          : event.metaKey
            ? event.key === 'ArrowLeft' ? '\x01' : '\x05'
            : event.key === 'ArrowLeft' ? '\x1bb' : '\x1bf';
        event.preventDefault();
        void sendTerminalInput(sessionId, sequence).catch(onErrorRef.current);
        return false;
      }
      if (
        event.type === 'keydown'
        && event.key === 'Enter'
        && event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
      ) {
        event.preventDefault();
        void sendTerminalInput(sessionId, MODIFIED_ENTER_SEQUENCE).catch(onErrorRef.current);
        return false;
      }
      return true;
    });
    const input = terminal.onData(data => {
      void sendTerminalInput(sessionId, data).catch(onErrorRef.current);
    });
    const fitNow = () => {
      if (!disposed) fitTerminalToHost(terminal, fitAddon, hostRef.current, sessionId);
    };
    const fit = () => {
      window.cancelAnimationFrame(fitFrame);
      window.clearTimeout(settleTimer);
      fitFrame = window.requestAnimationFrame(() => {
        fitNow();
        fitFrame = window.requestAnimationFrame(fitNow);
      });
      settleTimer = window.setTimeout(fitNow, 120);
    };
    fitTerminalRef.current = fit;
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(hostRef.current);
    const layout = hostRef.current.closest<HTMLElement>('.terminal-view-layout');
    if (layout) resizeObserver.observe(layout);
    window.addEventListener('resize', fit);
    fit();
    void document.fonts.ready.then(fit);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(fitFrame);
      window.clearTimeout(settleTimer);
      input.dispose();
      resizeObserver.disconnect();
      window.removeEventListener('resize', fit);
      fitTerminalRef.current = () => {};
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [sessionId]);

  useLayoutEffect(() => {
    fitTerminalRef.current();
  }, [fitSignal]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = TERMINAL_THEME[theme];
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  }, [theme]);

  useEffect(() => {
    if (active) terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    stopWatchingRef.current?.();
    stopWatchingRef.current = null;
    lastSeqRef.current = 0;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    const acknowledge = (seq: number) => {
      if (seq) void acknowledgeTerminalFrame(sessionId, viewIdRef.current, seq).catch(() => {});
    };
    const restoreSnapshot = async () => {
      try {
        const result = await getTerminalSnapshot(sessionId);
        terminal.reset();
        lastSeqRef.current = result.snapshot.lastSeq;
        terminal.write(result.snapshot.data, () => acknowledge(result.snapshot.lastSeq));
      } catch (cause) {
        onErrorRef.current(cause);
      }
    };
    stopWatchingRef.current = watchTerminalSession(sessionId, event => {
      if (event.type === 'terminal.snapshot' && event.snapshot) {
        terminal.reset();
        lastSeqRef.current = event.snapshot.lastSeq;
        terminal.write(event.snapshot.data, () => acknowledge(event.snapshot?.lastSeq || 0));
      } else if (event.type === 'terminal.frame' && event.data && event.seq && event.seq > lastSeqRef.current) {
        lastSeqRef.current = event.seq;
        terminal.write(event.data, () => acknowledge(event.seq || 0));
      } else if (event.type === 'terminal.restore-needed') {
        void restoreSnapshot();
      } else if (event.type === 'terminal.exit') {
        onExitRef.current();
      }
    }, () => onErrorRef.current('Terminal session connection lost'), lastSeqRef.current);
    return () => {
      stopWatchingRef.current?.();
      stopWatchingRef.current = null;
    };
  }, [sessionId]);

  return (
    <div
      className={`terminal-view ${active ? 'active' : ''}`}
      data-session-id={sessionId}
      onFocusCapture={onFocus}
      onPointerDown={onFocus}
    >
      <div className="terminal-xterm-host" ref={hostRef} />
    </div>
  );
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
