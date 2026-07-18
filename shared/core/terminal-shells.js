'use strict';

const TERMINAL_SHELLS = Object.freeze([
  Object.freeze({
    id: 'default',
    label: 'Default shell',
    command: '',
    description: 'Use your macOS login shell',
  }),
  Object.freeze({
    id: 'fish',
    label: 'fish',
    command: 'fish',
    description: 'Built-in autosuggestions · Ctrl+F to accept',
  }),
  Object.freeze({
    id: 'zsh',
    label: 'zsh',
    command: 'zsh',
    description: 'Load your interactive zsh configuration',
  }),
  Object.freeze({
    id: 'bash',
    label: 'bash',
    command: 'bash',
    description: 'Load your interactive bash configuration',
  }),
]);

const TERMINAL_SHELL_IDS = new Set(TERMINAL_SHELLS.map(shell => shell.id));

function terminalShellById(value) {
  const id = String(value || '');
  return TERMINAL_SHELLS.find(shell => shell.id === id) || null;
}

function normalizeTerminalShellId(value) {
  const id = String(value || '');
  return TERMINAL_SHELL_IDS.has(id) ? id : 'default';
}

function terminalShellCommand(value, loginShell = process.env.SHELL || '/bin/zsh') {
  const shell = terminalShellById(normalizeTerminalShellId(value));
  return shell?.command || String(loginShell || '/bin/zsh');
}

function fishInstallSpec(platform = process.platform) {
  if (platform !== 'darwin') return null;
  return {
    command: 'brew',
    args: ['install', 'fish'],
  };
}

function preferredDefaultTerminalShellId(fishAvailable) {
  return fishAvailable ? 'fish' : 'default';
}

function settingsWithFishDefault(settings) {
  return { ...settings, defaultTerminalShell: 'fish' };
}

module.exports = {
  TERMINAL_SHELLS,
  fishInstallSpec,
  normalizeTerminalShellId,
  preferredDefaultTerminalShellId,
  settingsWithFishDefault,
  terminalShellById,
  terminalShellCommand,
};
