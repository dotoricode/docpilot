/// <reference types="vite/client" />

declare module '@fontsource-variable/geist';
declare module '@fontsource-variable/geist-mono';
declare module '@fontsource-variable/noto-sans-kr';

type DocPilotUpdateState = {
  status: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseUrl?: string;
  fileName?: string;
  size?: number;
  received?: number;
  percent?: number;
  digest?: string;
  error?: string;
};

interface Window {
  docpilot?: {
    getRecent?: () => Promise<string[]>;
    getAppVersion?: () => Promise<string>;
    getLaunchPreferences?: () => Promise<{
      appName: string;
      version: string;
      themePreference: 'light' | 'dark' | 'system';
      effectiveTheme: 'light' | 'dark';
    }>;
    openFolder?: (folderPath: string) => Promise<void>;
    chooseWorkspaceFolder?: () => Promise<string | null>;
    openLocalPath?: (targetPath: string) => Promise<boolean>;
    openUrl?: (url: string) => Promise<boolean>;
    copyText?: (text: string) => Promise<boolean>;
    setWindowTheme?: (theme: 'light' | 'dark' | 'system') => Promise<boolean>;
    getUpdateState?: () => Promise<DocPilotUpdateState>;
    downloadUpdate?: () => Promise<DocPilotUpdateState>;
    openDownloadedUpdate?: () => Promise<boolean>;
    onMenuCommand?: (callback: (command: string) => void) => () => void;
    onUpdateState?: (callback: (state: DocPilotUpdateState) => void) => () => void;
  };
}
