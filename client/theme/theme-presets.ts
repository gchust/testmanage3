export const themePresets = [
  { id: 'compact', labelKey: 'appearance.themes.compact' },
  { id: 'default', labelKey: 'appearance.themes.default' },
  { id: 'ocean', labelKey: 'appearance.themes.ocean' },
] as const;

export type ThemePresetId = (typeof themePresets)[number]['id'];
export const defaultThemePreset: ThemePresetId = 'compact';
