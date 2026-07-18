const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TERMINAL_SHELLS,
  fishInstallSpec,
  normalizeTerminalShellId,
  preferredDefaultTerminalShellId,
  settingsWithFishDefault,
  terminalShellById,
  terminalShellCommand,
} = require('../shared/core/terminal-shells');

test('terminal shell ids are a fixed allowlist with the login shell as the safe default', () => {
  assert.deepEqual(TERMINAL_SHELLS.map(shell => shell.id), [
    'default',
    'fish',
    'zsh',
    'bash',
  ]);
  assert.equal(normalizeTerminalShellId('fish'), 'fish');
  assert.equal(normalizeTerminalShellId('../../arbitrary-command'), 'default');
  assert.equal(terminalShellById('../../arbitrary-command'), null);
});

test('fish installation uses the fixed Homebrew formula without a shell', () => {
  assert.deepEqual(fishInstallSpec('darwin'), {
    command: 'brew',
    args: ['install', 'fish'],
  });
  assert.equal(fishInstallSpec('win32'), null);
  assert.equal(fishInstallSpec('linux'), null);
});

test('fish is the initial and post-install default without resetting other settings', () => {
  assert.equal(preferredDefaultTerminalShellId(true), 'fish');
  assert.equal(preferredDefaultTerminalShellId(false), 'default');
  assert.deepEqual(settingsWithFishDefault({ theme: 'dark', autosave: true, defaultTerminalShell: 'zsh' }), {
    theme: 'dark',
    autosave: true,
    defaultTerminalShell: 'fish',
  });
});

test('shell choices resolve only to fixed commands inside the embedded terminal', () => {
  assert.equal(terminalShellCommand('default', '/custom/login-shell'), '/custom/login-shell');
  assert.equal(terminalShellCommand('fish', '/bin/zsh'), 'fish');
  assert.equal(terminalShellCommand('zsh', '/custom/login-shell'), 'zsh');
  assert.equal(terminalShellCommand('bash', '/custom/login-shell'), 'bash');
  assert.equal(terminalShellCommand('../../arbitrary-command', '/bin/zsh'), '/bin/zsh');
});
