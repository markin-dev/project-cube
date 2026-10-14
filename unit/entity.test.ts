// Юнит-тесты общих операций с объектами (src/entity.ts): удаление из физики, сцены и списка,
// уборка упавших и перенос положения и поворота тел на видимые объекты.
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import type { Enemies } from '../src/enemies';
import { removeAllEntities, removeEntity, removeFallenEntities, syncCubeRotations, syncPositions } from '../src/entity';
import { addTestEnemy, createTestWorld, getHandle } from './fixtures';

const { world, scene } = await createTestWorld();

const createEnemies = (heights: number[]): Enemies => {
  const enemies: Enemies = new Map();

  heights.forEach((y, index) => addTestEnemy({ world, scene, enemies, x: 3 + index, y, z: 0 }));

  return enemies;
};

describe('removeEntity', () => {
  it('Должен убрать объект из списка', () => {
    const enemies = createEnemies([0.4]);
    const [enemy] = enemies.values();

    removeEntity({ world, scene, entities: enemies, handle: getHandle(enemy) });

    expect(enemies.size).toBe(0);
  });

  it('Должен убрать объект со сцены', () => {
    const enemies = createEnemies([0.4]);
    const [enemy] = enemies.values();

    removeEntity({ world, scene, entities: enemies, handle: getHandle(enemy) });

    expect(enemy.object.parent).toBeNull();
  });
});

it('removeAllEntities: Должен убрать все объекты', () => {
  const enemies = createEnemies([0.4, 0.4, 0.4]);

  removeAllEntities({ world, scene, entities: enemies });

  expect(enemies.size).toBe(0);
});

it('removeFallenEntities: Должен убрать только объекты ниже FALL_REMOVE_HEIGHT', () => {
  const enemies = createEnemies([0.4, config.FALL_REMOVE_HEIGHT - 1]);

  removeFallenEntities({ world, scene, entities: enemies });

  expect(enemies.size).toBe(1);
});

it('syncPositions: Должен перенести положение тела на видимый объект', () => {
  const enemies = createEnemies([0.4]);
  const [enemy] = enemies.values();

  enemy.body.setTranslation({ x: 7, y: 2, z: -3 }, true);
  syncPositions(enemies);

  expect(enemy.object.position.toArray()).toEqual([7, 2, -3]);
});

it('syncCubeRotations: Должен перенести поворот тела на куб', () => {
  const enemies = createEnemies([0.4]);
  const [enemy] = enemies.values();

  enemy.body.setRotation({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, true);
  syncCubeRotations(enemies);

  expect(enemy.cube.quaternion.toArray()).toEqual([
    0,
    expect.closeTo(Math.SQRT1_2, 5),
    0,
    expect.closeTo(Math.SQRT1_2, 5),
  ]);
});
