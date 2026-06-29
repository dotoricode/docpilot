class AgentProcessManager {
  constructor() {
    this.activeTurns = new Map();
  }

  register(sessionId, turn) {
    if (!sessionId || !turn || !turn.turnId) throw new Error('sessionId and turnId are required');
    this.activeTurns.set(sessionId, turn);
    return turn;
  }

  get(sessionId) {
    return this.activeTurns.get(sessionId) || null;
  }

  has(sessionId) {
    return this.activeTurns.has(sessionId);
  }

  clear(sessionId) {
    return this.activeTurns.delete(sessionId);
  }

  stop(sessionId, reason = '중단되었습니다.') {
    const active = this.get(sessionId);
    if (!active) return null;
    if (typeof active.stop === 'function') active.stop(reason);
    else if (active.proc && typeof active.proc.kill === 'function') active.proc.kill();
    this.clear(sessionId);
    return active;
  }

  list() {
    return Array.from(this.activeTurns.entries()).map(([sessionId, turn]) => ({
      sessionId,
      turnId: turn.turnId,
    }));
  }
}

module.exports = {
  AgentProcessManager,
};
