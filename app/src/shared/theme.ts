import type { AppSettings } from './bridge-client';

export type ThemePreference = AppSettings['theme'];
export type EffectiveTheme = 'dark' | 'light';

export function resolveThemePreference(preference: ThemePreference): EffectiveTheme {
  if (preference === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function applyThemePreference(preference: ThemePreference) {
  const effective = resolveThemePreference(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = effective;
}
