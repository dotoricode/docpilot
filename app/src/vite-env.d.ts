/// <reference types="vite/client" />

interface Window {
  docpilot?: {
    getRecent?: () => Promise<string[]>;
    getAppVersion?: () => Promise<string>;
    openFolder?: (folderPath: string) => Promise<void>;
    chooseWorkspaceFolder?: () => Promise<string | null>;
    openLocalPath?: (targetPath: string) => Promise<boolean>;
    copyText?: (text: string) => Promise<boolean>;
  };
}
