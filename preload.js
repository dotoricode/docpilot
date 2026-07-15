const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('docpilot', {
  getRecent:        ()       => ipcRenderer.invoke('get-recent'),
  getAppVersion:    ()       => ipcRenderer.invoke('get-app-version'),
  getLaunchPreferences: ()   => ipcRenderer.invoke('get-launch-preferences'),
  openFolderDialog: ()       => ipcRenderer.invoke('open-folder-dialog'),
  chooseWorkspaceFolder: ()  => ipcRenderer.invoke('choose-workspace-folder'),
  chooseInstructionFile: ()   => ipcRenderer.invoke('choose-instruction-file'),
  openFolder:       (p)      => ipcRenderer.invoke('open-folder', p),
  removeRecent:     (p)      => ipcRenderer.invoke('remove-recent', p),
  copyText:         (text)    => ipcRenderer.invoke('copy-text', text),
  openUrl:          (url)    => ipcRenderer.invoke('open-url', url),
  openLocalPath:    (p)      => ipcRenderer.invoke('open-local-path', p),
  toggleMaximize:   ()       => ipcRenderer.invoke('window-toggle-maximize'),
  setWindowTheme:   (theme)  => ipcRenderer.invoke('set-window-theme', theme),
  onMenuCommand:    (cb)     => ipcRenderer.on('menu-command', (_, command) => cb(command)),
  onUpdateAvailable:(cb)     => ipcRenderer.on('update-available', (_, d) => cb(d)),
});
