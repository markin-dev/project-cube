// Юнит-тесты призраков (src/corpses.ts): погибший враг переходит в призраки и сталкивается только
// с полом, враг за краем арены, выше потолка или под полом погибает сразу, призрак сжимается и исчезает.
import { describe, expect, it } from 'vitest';
import { CORPSE_GROUPS } from '../src/collision-groups';
import { config } from '../src/config';
import { turnIntoCorpse, turnOutOfArenaIntoCorpses, updateCorpses, type Corpses } from '../src/corpses';
import type { Enemies } from '../src/enemies';
import { addTestEnemy, createTestWorld, getHandle } from './fixtures';

const { world, scene } = await createTestWorld();

// Список призраков из одного врага, сразу превращённого в призрака.
const createCorpses = (): Corpses => {
  const enemies: Enemies = new Map();
  const corpses: Corpses = new Map();
  const enemy = addTestEnemy({ world, scene, enemies, x: 5, y: 0.4, z: 0 });

  turnIntoCorpse({ world, enemies, corpses, handle: getHandle(enemy) });

  return corpses;
};

describe('turnIntoCorpse', () => {
  it('Должен перенести врага из живых в призраки', () => {
    const enemies: Enemies = new Map();
    const corpses: Corpses = new Map();
    const handle = getHandle(addTestEnemy({ world, scene, enemies, x: 5, y: 0.4, z: 0 }));

    turnIntoCorpse({ world, enemies, corpses, handle });

    expect([enemies.has(handle), corpses.has(handle)]).toEqual([false, true]);
  });

  it('Должен оставить призраку столкновения только с полом', () => {
    const [handle] = createCorpses().keys();

    expect(world.getCollider(handle).collisionGroups()).toBe(CORPSE_GROUPS);
  });
});

describe('turnOutOfArenaIntoCorpses', () => {
  it.each([
    ['за краем арены', 16, 0.4, 0, 1],
    ['выше потолка смерти', 5, 11, 0, 1],
    ['под полом', 5, -0.5, 0, 1],
    ['над ареной', 5, 0.4, 0, 0],
  ])('Должен для врага %s сделать %s призраков', (_, x, y, z, expected) => {
    const enemies: Enemies = new Map();
    const corpses: Corpses = new Map();

    addTestEnemy({ world, scene, enemies, x, y, z });
    turnOutOfArenaIntoCorpses({ world, enemies, corpses });

    expect(corpses.size).toBe(expected);
  });
});

describe('updateCorpses', () => {
  it('Должен сжимать призрака после CORPSE_LIFETIME', () => {
    const corpses = createCorpses();
    const [corpse] = corpses.values();
    const delta = config.CORPSE_LIFETIME + config.CORPSE_SHRINK_DURATION / 2;

    updateCorpses({ world, scene, entities: corpses, delta });

    expect(corpse.cube.scale.x).toBeCloseTo(corpse.size / 2, 5);
  });

  it('Должен удалить призрака после сжатия', () => {
    const corpses = createCorpses();
    const delta = config.CORPSE_LIFETIME + config.CORPSE_SHRINK_DURATION + 0.01;

    updateCorpses({ world, scene, entities: corpses, delta });

    expect(corpses.size).toBe(0);
  });
});
