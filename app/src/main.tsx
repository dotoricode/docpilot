import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/noto-sans-kr';
import '@fontsource-variable/space-grotesk';
import { App } from './screens/App';
import './styles.css';
import './workbench-final.css';

const launchQuery = new URLSearchParams(window.location.search);
const requestedPreference = launchQuery.get('preference');
const preference = requestedPreference === 'light' || requestedPreference === 'dark' || requestedPreference === 'system'
  ? requestedPreference
  : 'system';
const systemTheme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
const requestedTheme = launchQuery.get('theme');
document.documentElement.dataset.themePreference = preference;
document.documentElement.dataset.theme = requestedTheme === 'light' || requestedTheme === 'dark'
  ? requestedTheme
  : preference === 'system' ? systemTheme : preference;

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
