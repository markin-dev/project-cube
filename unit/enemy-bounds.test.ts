// Юнит-тесты границ состояния врага (src/enemies.ts): где арена кончается и где враг погибает.
//
// Три предиката границ смерти читают только body.translation(), поэтому врага описываем заглушкой
// { body: { translation } }. Проверка опоры (isEnemySupported) выше пола спрашивает физику лучом —
// для неё враг настоящий, тело Rapier в мире с полом.
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENEMY_GROUPS } from '../src/collision-groups';
import { config } from '../src/config';
import { isEnemyAboveCeiling, isEnemyBelowFloor, isEnemyOverArena, isEnemySupported } from '../src/enemies';
import type { Enemy } from '../src/enemies';
import { createPhysics } from '../src/physics';

// Заглушка врага: функции-предикаты трогают только translation() тела.
const enemyAt = (x: number, y: number, z: number): Pick<Enemy, 'body'> =>
  ({ body: { translation: () => ({ x, y, z }) } }) as unknown as Pick<Enemy, 'body'>;

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

  it('isEnemyAboveCeiling: центр поднялся выше потолка смерти', () => {
    expect(isEnemyAboveCeiling(enemyAt(0, 10.5, 0))).toBe(true); // DEATH_CEILING_HEIGHT = 10
    expect(isEnemyAboveCeiling(enemyAt(0, 5, 0))).toBe(false);
  });

  it('isEnemyBelowFloor: центр ушёл под верхнюю поверхность пола', () => {
    expect(isEnemyBelowFloor(enemyAt(0, -0.1, 0))).toBe(true);
    expect(isEnemyBelowFloor(enemyAt(0, 0.5, 0))).toBe(false); // стоит на полу
  });
});

describe('isEnemySupported', () => {
  beforeEach(() => {
    config.ARENA_SIZE = 30;
  });

  it.each([
    ['на полу', 0, 0.5, true],
    ['на ребре: центр чуть ниже 0.9 роста', 0, 0.89, true],
    ['над полом: центр чуть выше 0.9 роста', 0, 0.91, false],
    ['под полом', 0, -1, false],
    ['за краем арены', 16, 0.5, false],
  ])('Должен определять опору врага %s', async (_, x, y, expected) => {
    const { world } = await createPhysics();
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0));

    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setCollisionGroups(ENEMY_GROUPS), body);
    world.step();

    // Шаг сдвинул тело под гравитацией — возвращаем на проверяемую высоту.
    body.setTranslation({ x, y, z: 0 }, true);

    expect(isEnemySupported(world, { body, kind: { size: 1, mass: 1, hp: 40, color: '#ffffff' } })).toBe(expected);
  });
});
