// Юнит-тесты описания панели настроек (src/settings-panel.ts): каждый параметр конфига есть в панели,
// а значения из кода лежат внутри диапазонов своих ползунков.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, ENEMY_KIND_NAMES } from '../src/config';
import { KIND_SETTINGS, PANEL_CONFIG_KEYS, SECTIONS } from '../src/settings-panel';

const PANEL_KEYS = new Set<string>(PANEL_CONFIG_KEYS);

const SLIDERS = SECTIONS.flatMap(({ settings }) =>
  settings.map(({ key, min, max }): [string, number, number, number] => [key, DEFAULT_CONFIG[key], min, max]),
);

const KIND_SLIDERS = ENEMY_KIND_NAMES.flatMap((name) =>
  KIND_SETTINGS.map(({ key, min, max }): [string, number, number, number] => [
    `${name}.${key}`,
    DEFAULT_CONFIG.ENEMY_KINDS[name][key],
    min,
    max,
  ]),
);

const clamp = ({ value, min, max }: { value: number; min: number; max: number }): number =>
  Math.min(Math.max(value, min), max);

it('Должен показывать в панели каждый параметр конфига', () => {
  expect(Object.keys(DEFAULT_CONFIG).filter((key) => !PANEL_KEYS.has(key))).toEqual([]);
});

describe('диапазоны ползунков', () => {
  it.each([...SLIDERS, ...KIND_SLIDERS])('Должен держать %s = %s внутри [%s, %s]', (_, value, min, max) => {
    expect(clamp({ value, min, max })).toBe(value);
  });
});
