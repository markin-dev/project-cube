// Юнит-тесты урона и критов (src/projectiles.ts): бросок урона, бросок крита, применение
// множителя и выбор целей. Функции чистые (читают config), поэтому тесты детерминированы —
// никакого браузера, физики или реального времени.
import { describe, expect, it, beforeEach } from 'vitest';
import { config } from '../src/config';
import { applyCritToDamage, findTargets, rollCrit, rollDamage } from '../src/projectiles';

// Фейковый враг: findTargets использует только hp, kind.size и body.translation() —
// реальное тело Rapier не нужно. Располагаем врага на полу (y = половина роста).
const makeEnemy = (x: number, z: number, hp: number, size = 0.8) => ({
  hp,
  kind: { size },
  body: { translation: () => ({ x, y: size / 2, z }) },
});

describe('rollDamage', () => {
  beforeEach(() => {
    config.PROJECTILE_DAMAGE_MIN = 10;
    config.PROJECTILE_DAMAGE_MAX = 20;
  });

  it('все броски — целые в [MIN, MAX]', () => {
    const values = Array.from({ length: 2000 }, rollDamage);

    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }

    // «Случайный» урон должен быть действительно разным, а не прилипать к одному числу.
    expect(new Set(values).size).toBeGreaterThanOrEqual(8);
  });

  it('перепутанные границы упорядочиваются (MIN > MAX)', () => {
    config.PROJECTILE_DAMAGE_MIN = 20;
    config.PROJECTILE_DAMAGE_MAX = 10;

    const values = Array.from({ length: 500 }, rollDamage);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it('равные границы — урон без рандома', () => {
    config.PROJECTILE_DAMAGE_MIN = 7;
    config.PROJECTILE_DAMAGE_MAX = 7;

    const values = Array.from({ length: 100 }, rollDamage);
    expect(new Set(values)).toEqual(new Set([7]));
  });
});

describe('rollCrit', () => {
  it('шанс 0 — никогда не крит', () => {
    config.CRIT_CHANCE = 0;
    const crits = Array.from({ length: 1000 }, rollCrit).filter(Boolean).length;
    expect(crits).toBe(0);
  });

  it('шанс 1 — всегда крит', () => {
    config.CRIT_CHANCE = 1;
    const crits = Array.from({ length: 1000 }, rollCrit).filter(Boolean).length;
    expect(crits).toBe(1000);
  });

  it('шанс 0.5 — доля критов около половины (большая выборка)', () => {
    config.CRIT_CHANCE = 0.5;
    const samples = 20000;
    const crits = Array.from({ length: samples }, rollCrit).filter(Boolean).length;
    const fraction = crits / samples;

    // При 20000 выборках стандартное отклонение ~0.0035 — границы ±0.04 это ~11σ, стабильно.
    expect(fraction).toBeGreaterThan(0.46);
    expect(fraction).toBeLessThan(0.54);
  });
});

describe('applyCritToDamage', () => {
  beforeEach(() => {
    config.CRIT_MULTIPLIER = 2;
  });

  it('обычное попадание — урон без изменений', () => {
    expect(applyCritToDamage(15, false)).toBe(15);
  });

  it('крит — урон × множитель, округлённый до целого', () => {
    expect(applyCritToDamage(15, true)).toBe(30);
    // 10.4 × 2 = 20.8 → 21 (округление до целого, hp целые).
    expect(applyCritToDamage(10.4, true)).toBe(21);
  });

  it('уважает настроенный множитель', () => {
    config.CRIT_MULTIPLIER = 3;
    expect(applyCritToDamage(10, true)).toBe(30);
  });
});

describe('findTargets', () => {
  it('берёт ближайших к центру врагов, не больше count', () => {
    const enemies = new Map([
      [1, makeEnemy(10, 0, 100)], // дальний
      [2, makeEnemy(5, 0, 100)], // средний
      [3, makeEnemy(1, 0, 100)], // ближний
    ]);

    const targets = findTargets({ enemies, projectiles: new Map(), count: 2 });

    // Двое ближайших: handle 3 (d=1) и 2 (d=5), дальний (d=10) отсечён.
    expect(targets.map((t) => t.handle)).toEqual([3, 2]);
  });

  it('не выбирает врага, которого летящие снаряды уже добьют', () => {
    const enemies = new Map([
      [1, makeEnemy(1, 0, 10)], // hp 10, в него летит снаряд с уроном 15 — «получит своё»
      [2, makeEnemy(5, 0, 100)],
    ]);

    // Снаряд handle-а 100 летит в врага 1 с уроном 15 > его hp.
    const projectiles = new Map([[100, { targetHandle: 1, damage: 15 }]]);

    const targets = findTargets({ enemies, projectiles, count: 5 });

    expect(targets.map((t) => t.handle)).toEqual([2]);
  });

  it('пусто, когда целей нет', () => {
    expect(findTargets({ enemies: new Map(), projectiles: new Map(), count: 3 })).toEqual([]);
  });
});
