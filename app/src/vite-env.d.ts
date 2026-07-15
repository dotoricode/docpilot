/// <reference types="vite/client" />

declare module '@fontsource-variable/geist';
declare module '@fontsource-variable/geist-mono';

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
    copyText?: (text: string) => Promise<boolean>;
    setWindowTheme?: (theme: 'light' | 'dark' | 'system') => Promise<boolean>;
  };
}
