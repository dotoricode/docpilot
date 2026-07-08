const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'app/src/features/agent-panel/AgentPanel.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app/src/screens/App.tsx'), 'utf8');

assert(panel.includes('terminalWriteBufferRef'), 'AgentPanel must buffer terminal stream writes');
assert(panel.includes('window.requestAnimationFrame(flushTerminalWrites)'), 'AgentPanel must flush stream writes on animation frames');
assert(panel.includes('liveAssistantFrameRef'), 'AgentPanel must buffer live assistant text renders');
assert(panel.includes('window.requestAnimationFrame(flushLiveAssistantText)'), 'AgentPanel must flush live assistant text on animation frames');
assert(panel.includes('runningTurnSessionIdRef'), 'AgentPanel must track the active turn session');
assert(panel.includes('if (runningTurnSessionIdRef.current === sessionId) return;'), 'AgentPanel must not reload and clear a running session');
assert(panel.includes('lastStreamStatusAtRef'), 'AgentPanel must throttle streaming status updates');
assert(panel.includes('streamActivityPushedRef'), 'AgentPanel must avoid per-delta activity state updates');
assert(!panel.includes("pushActivity('응답 스트리밍');\n      terminal?.write"), 'AgentPanel must not update activity and write xterm for every delta inline');
assert(!panel.includes('setLiveAssistantText(liveAssistantTextRef.current);\n      queueTerminalWrite(event.text);'), 'AgentPanel must not set live text state for every delta');
assert(!panel.includes("setActiveTab('results')"), 'AgentPanel must not switch away from the conversation while a turn is settling artifacts');
assert(!panel.includes('agent-tabs'), 'AgentPanel must not require a separate progress/results tab UI');
assert(panel.includes('conversation-results'), 'AgentPanel must render results inside the conversation flow');

assert(app.includes('shouldCollectTurnChanges'), 'App must gate expensive AI turn snapshot collection');
assert(app.includes("outputHints.turnType === 'project'"), 'App must keep project turns eligible for workspace change collection');
assert(app.includes("preferArtifacts.includes('file-ops')"), 'App must keep file-ops artifact turns eligible for workspace change collection');
assert(app.includes('turnBaselineRef.current = null;'), 'App must clear skipped baselines');

console.log('streaming responsiveness checks passed');
