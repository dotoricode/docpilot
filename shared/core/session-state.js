function createSessionState(seed = {}) {
  return {
    sessions: Array.isArray(seed.sessions) ? seed.sessions : [],
    activeSessionId: seed.activeSessionId || '',
    sessionMessages: seed.sessionMessages || {},
    sessionArtifacts: seed.sessionArtifacts || {},
    sessionStreams: seed.sessionStreams || {},
    sessionTurnStartedAt: seed.sessionTurnStartedAt || {},
    sessionProgress: seed.sessionProgress || {},
    sessionPromptPackages: seed.sessionPromptPackages || {},
  };
}

function upsertSession(state, session) {
  if (!session || !session.id) return state;
  const sessions = [...state.sessions];
  const idx = sessions.findIndex(item => item.id === session.id);
  if (idx === -1) sessions.unshift(session);
  else sessions[idx] = { ...sessions[idx], ...session };
  return { ...state, sessions };
}

function setSessionDetail(state, sessionId, { session, messages, artifacts } = {}) {
  let next = session ? upsertSession(state, session) : state;
  if (Array.isArray(messages)) {
    next = { ...next, sessionMessages: { ...next.sessionMessages, [sessionId]: messages } };
  }
  if (Array.isArray(artifacts)) {
    next = { ...next, sessionArtifacts: { ...next.sessionArtifacts, [sessionId]: artifacts } };
  }
  return next;
}

function selectSession(state, sessionId) {
  return { ...state, activeSessionId: sessionId || '' };
}

function deleteSessionState(state, sessionId) {
  const sessions = state.sessions.filter(item => item.id !== sessionId);
  const removeKey = map => {
    const next = { ...map };
    delete next[sessionId];
    return next;
  };
  return {
    ...state,
    sessions,
    activeSessionId: state.activeSessionId === sessionId ? '' : state.activeSessionId,
    sessionMessages: removeKey(state.sessionMessages),
    sessionArtifacts: removeKey(state.sessionArtifacts),
    sessionStreams: removeKey(state.sessionStreams),
    sessionTurnStartedAt: removeKey(state.sessionTurnStartedAt),
    sessionProgress: removeKey(state.sessionProgress),
    sessionPromptPackages: removeKey(state.sessionPromptPackages),
  };
}

function clearSessionState(state) {
  return {
    ...state,
    sessions: [],
    activeSessionId: '',
    sessionMessages: {},
    sessionArtifacts: {},
    sessionStreams: {},
    sessionTurnStartedAt: {},
    sessionProgress: {},
    sessionPromptPackages: {},
  };
}

function startSessionTurn(state, sessionId, userMessage, startedAt = Date.now()) {
  const messages = [...(state.sessionMessages[sessionId] || []), userMessage].filter(Boolean);
  const sessions = state.sessions.map(session => (
    session.id === sessionId ? { ...session, status: 'running' } : session
  ));
  return {
    ...state,
    sessions,
    sessionMessages: { ...state.sessionMessages, [sessionId]: messages },
    sessionStreams: { ...state.sessionStreams, [sessionId]: '' },
    sessionTurnStartedAt: { ...state.sessionTurnStartedAt, [sessionId]: startedAt },
    sessionProgress: { ...state.sessionProgress, [sessionId]: '요청 전송 중' },
  };
}

function applySessionEvent(state, sessionId, event, now = Date.now()) {
  const ev = event || {};
  if (ev.type === 'turn.started') {
    let next = ev.session ? upsertSession(state, ev.session) : state;
    return {
      ...next,
      sessionTurnStartedAt: { ...next.sessionTurnStartedAt, [sessionId]: next.sessionTurnStartedAt[sessionId] || now },
      sessionProgress: { ...next.sessionProgress, [sessionId]: '프롬프트 패키지 준비됨' },
      sessionPromptPackages: ev.promptPackage
        ? { ...next.sessionPromptPackages, [sessionId]: ev.promptPackage }
        : next.sessionPromptPackages,
    };
  }
  if (ev.type === 'turn.delta') {
    return {
      ...state,
      sessionProgress: { ...state.sessionProgress, [sessionId]: '응답 수신 중' },
      sessionStreams: {
        ...state.sessionStreams,
        [sessionId]: `${state.sessionStreams[sessionId] || ''}${ev.text || ''}`,
      },
    };
  }
  if (ev.type === 'turn.progress') {
    const elapsed = Math.max(0, Math.floor(Number(ev.elapsedMs || 0) / 1000));
    const label = ev.phase === 'streaming' ? `스트리밍 중 · ${elapsed}초` : `CLI 응답 대기 · ${elapsed}초`;
    return {
      ...state,
      sessionProgress: { ...state.sessionProgress, [sessionId]: label },
    };
  }
  if (ev.type === 'artifact.created') {
    return {
      ...state,
      sessionProgress: { ...state.sessionProgress, [sessionId]: '변경안 정리 중' },
      sessionArtifacts: {
        ...state.sessionArtifacts,
        [sessionId]: [...(state.sessionArtifacts[sessionId] || []), ev.artifact].filter(Boolean),
      },
    };
  }
  if (ev.type === 'turn.done') {
    let next = ev.session ? upsertSession(state, ev.session) : state;
    const messages = ev.message
      ? [...(next.sessionMessages[sessionId] || []), ev.message]
      : (next.sessionMessages[sessionId] || []);
    const remove = map => {
      const copy = { ...map };
      delete copy[sessionId];
      return copy;
    };
    return {
      ...next,
      sessionMessages: { ...next.sessionMessages, [sessionId]: messages },
      sessionStreams: { ...next.sessionStreams, [sessionId]: '' },
      sessionTurnStartedAt: remove(next.sessionTurnStartedAt),
      sessionProgress: remove(next.sessionProgress),
      sessionPromptPackages: remove(next.sessionPromptPackages),
    };
  }
  if (ev.type === 'turn.error') {
    const sessions = state.sessions.map(session => (
      session.id === sessionId ? { ...session, status: 'errored' } : session
    ));
    const remove = map => {
      const copy = { ...map };
      delete copy[sessionId];
      return copy;
    };
    return {
      ...state,
      sessions,
      sessionStreams: { ...state.sessionStreams, [sessionId]: ev.error || '세션 오류' },
      sessionTurnStartedAt: remove(state.sessionTurnStartedAt),
      sessionProgress: remove(state.sessionProgress),
      sessionPromptPackages: remove(state.sessionPromptPackages),
    };
  }
  return state;
}

module.exports = {
  createSessionState,
  upsertSession,
  setSessionDetail,
  selectSession,
  deleteSessionState,
  clearSessionState,
  startSessionTurn,
  applySessionEvent,
};
