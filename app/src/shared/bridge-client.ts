export type WorkspaceRoot = {
  id: string;
  name: string;
  path: string;
};

export type WorkspaceFilesResponse = {
  files: string[];
  folders?: string[];
  roots: WorkspaceRoot[];
};

export type FileReadResponse = {
  id: string;
  content: string;
};

export type FilePathResponse = {
  id: string;
  path: string;
};

export type FileStatus = 'new' | 'modified';

export type FileStatusResponse = {
  statuses: Record<string, FileStatus>;
};

export type WorkspaceSnapshotFile = {
  id: string;
  hash: string;
  content: string;
};

export type WorkspaceSnapshot = {
  files: WorkspaceSnapshotFile[];
  roots: WorkspaceRoot[];
  createdAt: string;
};

export type AgentName = 'claude' | 'codex';

export type Instruction = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  sourceType?: string;
  sourceRef?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type InstructionSet = {
  id: string;
  scope: 'project' | 'global';
  name: string;
  instructionIds?: string[];
  instructions?: Instruction[];
  createdAt?: string;
  updatedAt?: string;
};

export type InstructionsResponse = {
  instructions: Instruction[];
  projectSets: InstructionSet[];
  globalSets: InstructionSet[];
  activeSetId?: string;
  globalActiveSetId?: string;
};

export type AgentSessionSummary = {
  id: string;
  agent: AgentName;
  title: string;
  status: string;
  scope?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  lastTurnId?: string;
  summary?: string;
  summaryChars?: number;
  summaryMessageCount?: number;
  summaryUpdatedAt?: string;
};

export type AgentMessage = {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: unknown[];
  outputHints?: Record<string, unknown>;
  promptPackageSummary?: PromptPackageSummary;
  createdAt?: string;
};

export type PromptPackageSummary = {
  mode?: string;
  contextMode?: string;
  turnType?: string;
  agent?: string;
  sessionId?: string;
  targetFileId?: string;
  inputChars?: number;
  totalPromptChars?: number;
  summaryChars?: number;
  included?: {
    transcriptMessages?: number;
    attachments?: number;
    summaryChars?: number;
  };
  omitted?: {
    transcriptMessages?: number;
    attachments?: number;
  };
  scope?: {
    type?: string;
    id?: string;
    currentFileId?: string;
  };
};

export type AgentArtifact = {
  id: string;
  kind: string;
  fileId?: string;
  title?: string;
  turnId?: string;
  proposedContent?: string;
  content?: string;
  summary?: string;
  promptPackageSummary?: PromptPackageSummary;
};

export type AgentSessionDetail = {
  session: AgentSessionSummary;
  messages: AgentMessage[];
  artifacts: AgentArtifact[];
};

export type AgentSessionLogEntry = {
  ts: string;
  sessionId: string;
  type: string;
  turnId?: string;
  [key: string]: unknown;
};

export type SessionTurnEvent = {
  type: 'turn.started' | 'turn.delta' | 'turn.progress' | 'artifact.created' | 'turn.done' | 'turn.error' | 'turn.stopped' | string;
  text?: string;
  error?: string;
  phase?: string;
  elapsedMs?: number;
  promptPackage?: Record<string, unknown>;
  runtime?: AgentRuntime;
  message?: AgentMessage;
  session?: AgentSessionSummary | null;
  artifact?: AgentArtifact;
  promptPackageSummary?: PromptPackageSummary;
};

export type WatchEvent = {
  type: 'watch.ready' | 'watch.ping' | 'files.changed' | string;
  reason?: string;
  ts?: number;
};

export type BridgePing = {
  ok: boolean;
  root: string;
  pid: number;
};

export type AppSettings = {
  version: number;
  autosave: boolean;
  theme: 'dark' | 'system';
  agentCommandMode: 'auto' | 'custom';
  claudeCommand: string;
  codexCommand: string;
  fileWatcherIgnore: string;
  recentWorkspaces: string[];
};

export type AppDiagnostics = {
  root: string;
  docpilotDir: string;
  settingsFile: string;
  sessionsFile: string;
  sessionLogsDir: string;
  sessionLogCount: number;
  bridgePid: number;
  port: number;
};

export type AgentRuntime = {
  rendererTerminal: string;
  executionMode: string;
  ptyAvailable: boolean;
  ptyModule: string;
  fallbackMode: string;
  claudeCommand: string;
  codexCommand: string;
  commandMode: 'auto' | 'custom';
  cwd: string;
};

export type TerminalSessionSummary = {
  id: string;
  agent: AgentName;
  status: string;
  mode: string;
  createdAt: string;
  cwd: string;
};

export type TerminalSessionEvent = {
  type: 'terminal.ready' | 'terminal.data' | 'terminal.exit' | string;
  id?: string;
  data?: string;
  code?: number;
  reason?: string;
  session?: TerminalSessionSummary;
  runtime?: AgentRuntime;
};

function bridgePort() {
  const params = new URLSearchParams(window.location.search);
  return params.get('port') || '7474';
}

export function bridgeBaseUrl() {
  return `http://localhost:${bridgePort()}`;
}

export async function bridgeJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${bridgeBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function listWorkspaceFiles() {
  return bridgeJson<WorkspaceFilesResponse>('/files');
}

export function listFileStatuses() {
  return bridgeJson<FileStatusResponse>('/file-status');
}

export function getWorkspaceSnapshot() {
  return bridgeJson<WorkspaceSnapshot>('/workspace-snapshot');
}

export function readWorkspaceFile(id: string) {
  return bridgeJson<FileReadResponse>(`/file?id=${encodeURIComponent(id)}`);
}

export function saveWorkspaceFile(id: string, content: string) {
  return bridgeJson<{ ok: true }>('/save', {
    method: 'POST',
    body: JSON.stringify({ id, content }),
  });
}

export function getWorkspaceFilePath(id: string) {
  return bridgeJson<FilePathResponse>(`/file-path?id=${encodeURIComponent(id)}`);
}

export function readWorkspaceFileBase(id: string) {
  return bridgeJson<FileReadResponse & { source: string }>(`/file-base?id=${encodeURIComponent(id)}`);
}

export function createWorkspaceFile(dir: string, name: string, content = '') {
  return bridgeJson<WorkspaceFilesResponse & { ok: true; id: string }>('/file-create', {
    method: 'POST',
    body: JSON.stringify({ dir, name, content }),
  });
}

export function createWorkspaceFolder(dir: string, name: string) {
  return bridgeJson<WorkspaceFilesResponse & { ok: true; id: string }>('/folder-create', {
    method: 'POST',
    body: JSON.stringify({ dir, name }),
  });
}

export function renameWorkspaceFile(id: string, name: string) {
  return bridgeJson<WorkspaceFilesResponse & { ok: true; id: string }>('/file-rename', {
    method: 'POST',
    body: JSON.stringify({ id, name }),
  });
}

export function attachWorkspaceRoot(folderPath: string) {
  return bridgeJson<WorkspaceFilesResponse & { ok: true; root: WorkspaceRoot }>('/workspace-roots', {
    method: 'POST',
    body: JSON.stringify({ path: folderPath }),
  });
}

export function detachWorkspaceRoot(id: string) {
  return bridgeJson<WorkspaceFilesResponse & { ok: true }>('/workspace-roots', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  });
}

export function chooseWorkspaceFolder() {
  return window.docpilot?.chooseWorkspaceFolder?.() || Promise.resolve(null);
}

export function getRecentFolders() {
  return window.docpilot?.getRecent?.() || Promise.resolve([]);
}

export function openWorkspaceFolder(folderPath: string) {
  return window.docpilot?.openFolder?.(folderPath) || Promise.resolve();
}

export function openLocalPath(targetPath: string) {
  return window.docpilot?.openLocalPath?.(targetPath) || Promise.resolve(false);
}

export function copyText(text: string) {
  return window.docpilot?.copyText?.(text) || Promise.resolve(false);
}

export function pingBridge() {
  return bridgeJson<BridgePing>('/ping');
}

export function getSettings() {
  return bridgeJson<{ settings: AppSettings }>('/settings');
}

export function getDiagnostics() {
  return bridgeJson<{ diagnostics: AppDiagnostics }>('/diagnostics');
}

export function getAgentRuntime() {
  return bridgeJson<{ runtime: AgentRuntime }>('/agent-runtime');
}

export function startTerminalSession(agent: AgentName) {
  return bridgeJson<{ session: TerminalSessionSummary; runtime: AgentRuntime }>('/terminal-sessions', {
    method: 'POST',
    body: JSON.stringify({ agent }),
  });
}

export function sendTerminalInput(sessionId: string, data: string) {
  return bridgeJson<{ ok: true }>(`/terminal-sessions/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
}

export function resizeTerminalSession(sessionId: string, cols: number, rows: number) {
  return bridgeJson<{ ok: true; cols: number; rows: number }>(`/terminal-sessions/${encodeURIComponent(sessionId)}/resize`, {
    method: 'POST',
    body: JSON.stringify({ cols, rows }),
  });
}

export function stopTerminalSession(sessionId: string) {
  return bridgeJson<{ ok: true; session: TerminalSessionSummary }>(`/terminal-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export function watchTerminalSession(sessionId: string, onEvent: (event: TerminalSessionEvent) => void, onError?: (error: Event) => void) {
  const source = new EventSource(`${bridgeBaseUrl()}/terminal-sessions/${encodeURIComponent(sessionId)}/stream`);
  source.onmessage = message => {
    try { onEvent(JSON.parse(message.data) as TerminalSessionEvent); } catch {}
  };
  source.onerror = event => {
    onError?.(event);
  };
  return () => source.close();
}

export function saveSettings(settings: Partial<AppSettings>) {
  return bridgeJson<{ ok: true; settings: AppSettings }>('/settings', {
    method: 'POST',
    body: JSON.stringify({ settings }),
  });
}

export function listInstructions() {
  return bridgeJson<InstructionsResponse>('/instructions');
}

export function saveInstruction(input: Partial<Instruction> & { body: string }) {
  return bridgeJson<InstructionsResponse & { ok: true; instruction: Instruction }>('/instructions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteInstruction(id: string) {
  return bridgeJson<InstructionsResponse & { ok: true }>('/instructions/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export function saveInstructionSet(name: string, scope: 'project' | 'global', instructionIds?: string[]) {
  return bridgeJson<InstructionsResponse & { ok: true }>('/instruction-sets/save', {
    method: 'POST',
    body: JSON.stringify({ name, scope, instructionIds }),
  });
}

export function applyInstructionSet(id: string, scope: 'project' | 'global') {
  return bridgeJson<InstructionsResponse & { ok: true }>('/instruction-sets/apply', {
    method: 'POST',
    body: JSON.stringify({ id, scope }),
  });
}

export function deleteInstructionSet(id: string, scope: 'project' | 'global') {
  return bridgeJson<InstructionsResponse & { ok: true }>('/instruction-sets/delete', {
    method: 'POST',
    body: JSON.stringify({ id, scope }),
  });
}

export function listAgentSessions() {
  return bridgeJson<{ sessions: AgentSessionSummary[] }>('/sessions');
}

export function createAgentSession(agent: AgentName, scope?: Record<string, unknown>) {
  return bridgeJson<{ session: AgentSessionSummary }>('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      agent,
      title: `${agent === 'claude' ? 'Claude' : 'Codex'} 세션`,
      scope: scope || {},
    }),
  });
}

export function getAgentSessionDetail(sessionId: string) {
  return bridgeJson<AgentSessionDetail>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export function getAgentSessionLogs(sessionId: string, limit = 200) {
  return bridgeJson<{ session: AgentSessionSummary; logs: AgentSessionLogEntry[] }>(
    `/sessions/${encodeURIComponent(sessionId)}/logs?limit=${encodeURIComponent(String(limit))}`,
  );
}

export async function sendSessionTurn(
  sessionId: string,
  payload: { message: string; attachments?: unknown[]; outputHints?: Record<string, unknown> },
  onEvent: (event: SessionTurnEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${bridgeBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error('stream body missing');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const eventText of events) {
      const data = eventText
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
      if (!data) continue;
      onEvent(JSON.parse(data) as SessionTurnEvent);
    }
  }
}

export function stopSessionTurn(sessionId: string) {
  return bridgeJson<{ ok: true; sessionId: string; turnId: string }>(`/sessions/${encodeURIComponent(sessionId)}/turn/stop`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function watchProject(onEvent: (event: WatchEvent) => void, onError?: (error: Event) => void) {
  const source = new EventSource(`${bridgeBaseUrl()}/watch`);
  source.onmessage = event => {
    try {
      onEvent(JSON.parse(event.data) as WatchEvent);
    } catch {
      onEvent({ type: 'watch.invalid' });
    }
  };
  source.onerror = error => {
    if (onError) onError(error);
  };
  return () => source.close();
}
