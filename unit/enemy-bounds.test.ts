// Юнит-тесты границ состояния врага (src/enemies.ts): где арена кончается и где враг погибает.
//
// Четыре чистых предиката без физики и браузера — они решают, жив ли враг ещё (границы смерти)
// и куда целится пуля (упреждение прицела смотрит isEnemyOnFloor). Каждый читает только
// body.translation() (плюс kind.size у isEnemyOnFloor), поэтому врага описываем минимальной
// заглушкой { body: { translation }, kind: { size } } — меш/полоска/тело Rapier не нужны.
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { isEnemyAboveCeiling, isEnemyBelowFloor, isEnemyOnFloor, isEnemyOverArena } from '../src/enemies';
import type { Enemy } from '../src/enemies';

// Заглушка врага: функции-предикаты трогают только translation() тела и size типа.
const enemyAt = (x: number, y: number, z: number, size = 1): Pick<Enemy, 'body' | 'kind'> =>
  ({ body: { translation: () => ({ x, y, z }) }, kind: { size } }) as unknown as Pick<Enemy, 'body' | 'kind'>;

describe('границы состояния врага', () => {
  beforeEach(() => {
    config.ARENA_SIZE = 30; // край арены на ±15
    config.DEATH_CEILING_HEIGHT = 10;
  });

  it('isEnemyOverArena: враг над площадью арены, а не за краем', () => {
    expect(isEnemyOverArena(enemyAt(0, 0.5, 0))).toBe(true);
    expect(isEnemyOverArena(enemyAt(14, 0.5, -14))).toBe(true); // внутри ±15

    expect(isEnemyOverArena(enemyAt(16, 0.5, 0))).toBe(false); // за краем по X
    expect(isEnemyOverArena(enemyAt(0, 0.5, -16))).toBe(false); // за краем по Z
  });

  it('isEnemyOnFloor: на полу — да; в воздухе, под полом или за краем — нет', () => {
    // Куб, лежащий на грани, держит центр на половине роста.
    expect(isEnemyOnFloor(enemyAt(0, 0.5, 0))).toBe(true);

    expect(isEnemyOnFloor(enemyAt(0, 5, 0))).toBe(false); // высоко — летит
    expect(isEnemyOnFloor(enemyAt(0, -1, 0))).toBe(false); // под полом — сорвался
    expect(isEnemyOnFloor(enemyAt(16, 0.5, 0))).toBe(false); // за краем арены — управления нет
    // Центр на границе «на полу/летит»: size × 0.9 = 0.9 — ещё пол, выше 0.9 уже полёт.
    expect(isEnemyOnFloor(enemyAt(0, 0.89, 0))).toBe(true);
    expect(isEnemyOnFloor(enemyAt(0, 0.91, 0))).toBe(false);
  });

  it('isEnemyAboveCeiling: центр поднялся выше потолка смерти', () => {
    expect(isEnemyAboveCeiling(enemyAt(0, 10.5, 0))).toBe(true); // DEATH_CEILING_HEIGHT = 10
    expect(isEnemyAboveCeiling(enemyAt(0, 5, 0))).toBe(false);
  });

  it('isEnemyBelowFloor: центр ушёл под верхнюю поверхность пола', () => {
    expect(isEnemyBelowFloor(enemyAt(0, -0.1, 0))).toBe(true);
    expect(isEnemyBelowFloor(enemyAt(0, 0.5, 0))).toBe(false); // стоит на полу
  });
});
