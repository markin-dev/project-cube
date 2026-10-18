// Юнит-тесты описания панели настроек (src/settings-panel.ts): каждый параметр конфига есть в панели,
// а значения из кода лежат внутри диапазонов своих ползунков.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, ENEMY_KIND_NAMES } from '@/config';
import { KIND_SETTINGS, PANEL_CONFIG_KEYS, RARITY_WEIGHT_MAX, SECTIONS, UPGRADE_VALUE_SETTINGS } from '@/settings-panel';
import { RARITIES } from '@/upgrades';

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

// Прибавки усилений по редкостям: низ ползунка — 0 («не выпадает»), верх — свой у каждого усиления.
const UPGRADE_SLIDERS = UPGRADE_VALUE_SETTINGS.flatMap(({ stat, max }) =>
  RARITIES.map((rarity): [string, number, number, number] => [
    `${stat}.${rarity}`,
    DEFAULT_CONFIG.UPGRADE_VALUES[stat][rarity],
    0,
    max,
  ]),
);

const RARITY_WEIGHT_SLIDERS = RARITIES.map((rarity): [string, number, number, number] => [
  `вес ${rarity}`,
  DEFAULT_CONFIG.UPGRADE_RARITY_WEIGHTS[rarity],
  0,
  RARITY_WEIGHT_MAX,
]);

const clamp = ({ value, min, max }: { value: number; min: number; max: number }): number =>
  Math.min(Math.max(value, min), max);

it('Должен показывать в панели каждый параметр конфига', () => {
  expect(Object.keys(DEFAULT_CONFIG).filter((key) => !PANEL_KEYS.has(key))).toEqual([]);
});

describe('диапазоны ползунков', () => {
  it.each([...SLIDERS, ...KIND_SLIDERS, ...UPGRADE_SLIDERS, ...RARITY_WEIGHT_SLIDERS])('Должен держать %s = %s внутри [%s, %s]', (_, value, min, max) => {
    expect(clamp({ value, min, max })).toBe(value);
  });
});
