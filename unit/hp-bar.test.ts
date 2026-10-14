// Юнит-тесты полоски здоровья (src/hp-bar.ts): скрыта при полном здоровье, укорачивается с уроном.
import { describe, expect, it } from 'vitest';
import { createHpBar, setHpBarValue } from '@/hp-bar';

describe('createHpBar', () => {
  it('Должен создать скрытую полоску: у нового врага здоровье полное', () => {
    expect(createHpBar().group.visible).toBe(false);
  });
});

describe('setHpBarValue', () => {
  it.each([
    [1, false],
    [0.5, true],
  ])('Должен при доле здоровья %s показывать полоску: %s', (fraction, expected) => {
    const hpBar = createHpBar();

    setHpBarValue(hpBar, fraction);

    expect(hpBar.group.visible).toBe(expected);
  });

  it.each([
    [0.25, 0.25],
    [-0.5, 0],
  ])('Должен при доле здоровья %s укоротить полоску до доли %s длины', (fraction, expected) => {
    const hpBar = createHpBar();

    setHpBarValue(hpBar, fraction);

    expect(hpBar.fill.scale.x).toBeCloseTo(hpBar.width * expected, 5);
  });
});
