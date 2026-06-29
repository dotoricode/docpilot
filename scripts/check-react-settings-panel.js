const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'bridge.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'app/src/shared/bridge-client.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app/src/screens/App.tsx'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'app/src/features/settings/SettingsPanel.tsx'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'app/src/shared/theme.ts'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'app/src/styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const viteEnv = fs.readFileSync(path.join(root, 'app/src/vite-env.d.ts'), 'utf8');

assert(bridge.includes('SETTINGS_FILE'), 'bridge must define a project settings file');
assert(bridge.includes('readSettingsStore'), 'bridge must read settings');
assert(bridge.includes('writeSettingsStore'), 'bridge must write settings');
assert(bridge.includes('rememberWorkspaceInSettings'), 'bridge must remember current workspace in settings');
assert(bridge.includes('readDiagnostics'), 'bridge must report diagnostic paths');
assert(bridge.includes("url.pathname === '/settings'"), 'bridge must expose /settings');
assert(bridge.includes("url.pathname === '/diagnostics'"), 'bridge must expose /diagnostics');
assert(bridge.includes("settings.agentCommandMode === 'custom'"), 'agent spawn must respect custom command mode');
assert(bridge.includes('codexExecArgs(codexCommand)'), 'codex command must be configurable');
assert(bridge.includes("[claudeCommand, '-p', prompt]"), 'claude command must be configurable');

assert(client.includes('export type AppSettings'), 'bridge client must export AppSettings');
assert(client.includes('getSettings'), 'bridge client must expose getSettings');
assert(client.includes('getDiagnostics'), 'bridge client must expose getDiagnostics');
assert(client.includes('openLocalPath'), 'bridge client must expose openLocalPath');
assert(client.includes('saveSettings'), 'bridge client must expose saveSettings');
assert(main.includes("ipcMain.handle('open-local-path'"), 'main process must expose open-local-path IPC');
assert(main.includes('shell.showItemInFolder'), 'main process must reveal files in Finder');
assert(preload.includes('openLocalPath'), 'preload must expose openLocalPath');
assert(viteEnv.includes('openLocalPath?: (targetPath: string) => Promise<boolean>'), 'vite env must type openLocalPath');

assert(app.includes('SettingsPanel'), 'app shell must render SettingsPanel');
assert(app.includes('applyThemePreference'), 'app shell must apply persisted theme preference');
assert(app.includes('docpilot-settings-saved'), 'app shell must react to settings save events');
assert(theme.includes('resolveThemePreference'), 'theme helper must resolve system theme preference');
assert(theme.includes('document.documentElement.dataset.theme'), 'theme helper must write effective theme to the document root');
assert(panel.includes('Agent 실행'), 'settings panel must expose agent command mode');
assert(panel.includes('Claude 명령'), 'settings panel must expose Claude command');
assert(panel.includes('Codex 명령'), 'settings panel must expose Codex command');
assert(panel.includes('파일 감시 제외'), 'settings panel must expose watcher ignore field');
assert(panel.includes('최근 작업공간'), 'settings panel must show recent workspaces');
assert(panel.includes('진단 및 로그'), 'settings panel must show diagnostics and logs');
assert(panel.includes('revealPath'), 'settings panel must be able to reveal diagnostic paths');
assert(panel.includes('saveSettings(draft)'), 'settings panel must persist draft settings');
assert(panel.includes('applyThemePreference(theme)'), 'settings panel must apply theme changes immediately');
assert(panel.includes('docpilot-settings-saved'), 'settings panel must broadcast saved settings');
assert(styles.includes('.settings-panel'), 'settings panel must be styled');
assert(styles.includes('.settings-form'), 'settings form must be styled');
assert(styles.includes('.settings-recent'), 'settings recent workspace list must be styled');
assert(styles.includes('.settings-diagnostics'), 'settings diagnostics must be styled');
assert(styles.includes(':root[data-theme="light"]'), 'styles must define a light theme');
assert(styles.includes(':root[data-theme="light"] .cm-editor'), 'light theme must reach the CodeMirror editor');

console.log('react settings panel checks passed');
