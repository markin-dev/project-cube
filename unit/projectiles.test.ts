// Юнит-тесты снарядов (src/projectiles.ts): урон и криты, выбор целей, упреждение прицела,
// отсчёт до залпа, выстрел, отскок и уборка промахов. Враги и снаряды — настоящие объекты на headless-Rapier.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, MIN_FIRE_INTERVAL } from '@/config';
import type { Enemies, Enemy } from '@/enemies';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  applyCritToDamage,
  bounceProjectile,
  createProjectileHooks,
  findBounceTarget,
  findTargets,
  fireProjectiles,
  isCritRolled,
  predictPosition,
  refreshProjectileColor,
  removeFarProjectiles,
  rollDamage,
  runFireTimer,
  type Projectile,
  type Projectiles,
} from '@/projectiles';
import { createBonuses, getCombatStats, type CombatStats } from '@/upgrades';
import { addTestEnemy, createTestWorld, getHandle } from './fixtures';

const { world, scene } = await createTestWorld();

const ROLLS_COUNT = 2000;
const SIMULATED_SECONDS = 30;

// Центр куба игрока — откуда вылетает пуля (см. fireOneProjectile).
const getMuzzle = (): THREE.Vector3 => new THREE.Vector3(0, config.PLAYER_SIZE / 2, 0);

const rollMany = (roll: () => number): number[] => Array.from({ length: ROLLS_COUNT }, roll);

// Боевые характеристики без усилений — база из текущего config.
const getBaseStats = (): CombatStats => getCombatStats(createBonuses());

// Выпускает снаряд в enemy (с характеристиками stats, по умолчанию — база) и возвращает список снарядов.
const fireAt = (enemy: Enemy, stats: CombatStats = getBaseStats()): Projectiles => {
  const projectiles: Projectiles = new Map();

  fireProjectiles({ world, scene, entities: projectiles, targets: [{ handle: getHandle(enemy), enemy }], stats });

  return projectiles;
};

// Сколько залпов в секунду выходит при шаге step, если стрелять всегда есть в кого.
const getVolleysPerSecond = (step: number): number => {
  const fireVolley = vi.fn((): number => 1);

  Array.from({ length: Math.round(SIMULATED_SECONDS / step) }).reduce<number>(
    (timer) => runFireTimer({ timer, delta: step, interval: config.FIRE_INTERVAL, fireVolley }),
    0,
  );

  return fireVolley.mock.calls.length / SIMULATED_SECONDS;
};

// Свечение снаряда (emissiveIntensity его материала): материал общий на все обычные и на все
// крит-пули, поэтому у меша материала два разных вида. Материал — не Mesh и не Lambert — свечения нет.
const getGlowIntensity = (projectile: Projectile): number => {
  const { object } = projectile;

  if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshLambertMaterial)) {
    return 0;
  }

  return object.material.emissiveIntensity;
};

// Два врага и снаряд, выпущенный в первого, с bounces отскоками — для bounceProjectile.
type BounceCase = {
  enemies: Enemies;
  first: Enemy;
  second: Enemy;
  projectile: Projectile;
};

const createBounceCase = (bounces: number): BounceCase => {
  config.PROJECTILE_BOUNCES = bounces;

  const enemies: Enemies = new Map();
  const first = addTestEnemy({ world, scene, enemies, x: 5, y: 0.4, z: 0 });
  const second = addTestEnemy({ world, scene, enemies, x: 5, y: 0.4, z: 3 });
  const [projectile] = fireAt(first).values();

  return { enemies, first, second, projectile };
};

// Хуки шага физики для одного снаряда (handle PROJECTILE_HANDLE), который пролетает сквозь врага
// PASS_THROUGH_HANDLE; OTHER_HANDLE — любой другой враг.
const PROJECTILE_HANDLE = 1;
const PASS_THROUGH_HANDLE = 2;
const OTHER_HANDLE = 3;

const createHooks = (): ReturnType<typeof createProjectileHooks> => {
  const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0 });
  const [projectile] = fireAt(enemy).values();

  return createProjectileHooks(
    new Map([[PROJECTILE_HANDLE, { ...projectile, passThroughHandle: PASS_THROUGH_HANDLE }]]),
  );
};

// Точка, откуда ищем цель отскока, — центр врага в (5, пол, 0).
const BOUNCE_FROM = { x: 5, y: 0.4, z: 0 };

afterEach(() => vi.clearAllMocks());

describe('rollDamage', () => {
  it('Должен бросать целый урон в пределах [MIN, MAX]', () => {
    const outOfRange = rollMany(rollDamage).filter((value) => !Number.isInteger(value) || value < 10 || value > 20);

    expect(outOfRange).toEqual([]);
  });

  it('Должен давать разный урон', () => {
    expect(new Set(rollMany(rollDamage)).size).toBeGreaterThanOrEqual(8);
  });

  it('Должен упорядочивать перепутанные границы', () => {
    config.PROJECTILE_DAMAGE_MIN = 20;
    config.PROJECTILE_DAMAGE_MAX = 10;

    const outOfRange = rollMany(rollDamage).filter((value) => value < 10 || value > 20);

    expect(outOfRange).toEqual([]);
  });

  it('Должен бросать ровно MIN при равных границах', () => {
    config.PROJECTILE_DAMAGE_MIN = 7;
    config.PROJECTILE_DAMAGE_MAX = 7;

    expect(new Set(rollMany(rollDamage))).toEqual(new Set([7]));
  });
});

describe('isCritRolled', () => {
  it.each([
    [0, 0],
    [1, ROLLS_COUNT],
  ])('Должен при шансе %s давать %s критов', (chance, expected) => {
    expect(rollMany(() => Number(isCritRolled(chance))).filter(Boolean).length).toBe(expected);
  });

  it('Должен при шансе 0.5 давать криты примерно в половине бросков', () => {
    const crits = Array.from({ length: 20000 }, () => isCritRolled(0.5)).filter(Boolean).length;

    expect(crits / 20000).toBeCloseTo(0.5, 1);
  });
});

describe('applyCritToDamage', () => {
  it.each([
    [15, false, 2, 15],
    [15, true, 2, 30],
    [10.4, true, 2, 21],
    [10, true, 3, 30],
  ])('Должен из урона %s (крит: %s, множитель %s) получить %s', (damage, isCrit, multiplier, expected) => {
    expect(applyCritToDamage({ damage, isCrit, multiplier })).toBe(expected);
  });
});

describe('findTargets', () => {
  it('Должен выбрать ближайших к центру врагов, не больше count', () => {
    const enemies: Enemies = new Map();

    const ranked = [1, 5, 10].map((x) => addTestEnemy({ world, scene, enemies, x, y: 0.4, z: 0 }));
    const targets = findTargets({ enemies, projectiles: new Map(), count: 2 });

    expect(targets.map(({ enemy }) => ranked.indexOf(enemy))).toEqual([0, 1]);
  });

  it('Должен пропустить врага, которого летящие снаряды уже добьют', () => {
    config.PROJECTILE_DAMAGE_MIN = 15;
    config.PROJECTILE_DAMAGE_MAX = 15;
    config.CRIT_CHANCE = 0;

    const enemies: Enemies = new Map();
    const doomed = addTestEnemy({ world, scene, enemies, x: 1, y: 0.4, z: 0 });
    const survivor = addTestEnemy({ world, scene, enemies, x: 5, y: 0.4, z: 0 });

    doomed.hp = 10;

    const targets = findTargets({ enemies, projectiles: fireAt(doomed), count: 5 });

    expect(targets.map(({ enemy }) => enemy === survivor)).toEqual([true]);
  });

  it('Должен вернуть пустой список без врагов', () => {
    expect(findTargets({ enemies: new Map(), projectiles: new Map(), count: 3 })).toEqual([]);
  });
});

describe('predictPosition', () => {
  it('Должен целиться в текущий центр неподвижного врага на полу', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0 });

    expect(predictPosition({ world, enemy, muzzle: getMuzzle(), speed: config.PROJECTILE_SPEED }).toArray()).toEqual([
      expect.closeTo(5, 5),
      expect.closeTo(0.4, 5),
      expect.closeTo(0, 5),
    ]);
  });

  it('Должен упреждать движение поперёк линии выстрела, но не вдоль неё', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0 });

    // Враг бежит вдоль Z со скоростью 3, пуля летит до него ~1/3 с — смещение по Z ≈ 1.
    enemy.body.setLinvel({ x: 0, y: 0, z: 3 }, true);

    expect(predictPosition({ world, enemy, muzzle: getMuzzle(), speed: config.PROJECTILE_SPEED }).toArray()).toEqual([
      expect.closeTo(5, 3),
      expect.closeTo(0.4, 3),
      expect.closeTo(1, 3),
    ]);
  });

  it('Должен опускать прогноз падающего врага', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 3, z: 0 });

    expect(predictPosition({ world, enemy, muzzle: getMuzzle(), speed: config.PROJECTILE_SPEED }).y).toBeLessThan(3);
  });

  it('Должен не опускать прогноз ниже половины роста врага', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 14, y: 1.5, z: 0 });

    expect(predictPosition({ world, enemy, muzzle: getMuzzle(), speed: config.PROJECTILE_SPEED }).y).toBeCloseTo(0.4, 5);
  });

  it('Должен целиться в центр врага, стоящего на другом враге, без поправки на падение', async () => {
    const stack = await createTestWorld();
    const enemies: Enemies = new Map();

    addTestEnemy({ ...stack, enemies, x: 10, y: 0.4, z: 0 });

    const onStack = addTestEnemy({ ...stack, enemies, x: 10, y: 1.2, z: 0 });

    // Один шаг — чтобы Rapier проиндексировал коллайдеры для луча опоры.
    stack.world.step();

    const expectedY = onStack.body.translation().y;

    const predicted = predictPosition({
      world: stack.world,
      enemy: onStack,
      muzzle: getMuzzle(),
      speed: config.PROJECTILE_SPEED,
    });

    expect(predicted.y).toBeCloseTo(expectedY, 2);
  });
});

describe('runFireTimer', () => {
  it.each([
    ['1/30 (×8 или 30 FPS)', 1 / 30],
    ['1/60 (×1 на 60 Гц)', 1 / 60],
    ['1/144 (×1 на 144 Гц)', 1 / 144],
  ])('Должен давать 10 залпов в секунду при шаге %s', (_, step) => {
    // Частый темп — заметнее, если шаг съедает или добавляет залпы.
    config.FIRE_INTERVAL = 0.1;

    expect(getVolleysPerSecond(step)).toBeCloseTo(10, 1);
  });

  it('Должен выпускать несколько залпов за шаг, если пауза короче шага', () => {
    config.FIRE_INTERVAL = 0.025;

    expect(getVolleysPerSecond(1 / 30)).toBeCloseTo(40, 1);
  });

  it('Должен стрелять не чаще MIN_FIRE_INTERVAL', () => {
    config.FIRE_INTERVAL = 0.0001;

    expect(getVolleysPerSecond(1 / 30)).toBeCloseTo(1 / MIN_FIRE_INTERVAL, 1);
  });

  it('Должен держать отсчёт на нуле, пока стрелять не в кого', () => {
    expect(runFireTimer({ timer: 0, delta: 1 / 30, interval: 0.5, fireVolley: (): number => 0 })).toBe(0);
  });

  it('Должен выпустить один залп, когда цель появилась после ожидания', () => {
    const fireVolley = vi.fn((): number => 1);

    runFireTimer({ timer: 0, delta: 1 / 30, interval: 0.5, fireVolley });

    expect(fireVolley).toHaveBeenCalledTimes(1);
  });
});

describe('fireProjectiles', () => {
  it('Должен выпустить по снаряду в каждую цель', () => {
    const enemies: Enemies = new Map();

    [3, 6, 9].forEach((x) => addTestEnemy({ world, scene, enemies, x, y: 0.4, z: 0 }));

    const projectiles: Projectiles = new Map();
    const targets = [...enemies].map(([handle, enemy]) => ({ handle, enemy }));

    fireProjectiles({ world, scene, entities: projectiles, targets, stats: getBaseStats() });

    expect(projectiles.size).toBe(3);
  });

  it('Должен направить снаряд во врага', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });
    const [projectile] = fireAt(enemy).values();

    expect(projectile.body.linvel().x).toBeGreaterThan(14.5);
  });

  describe('характеристики снаряда', () => {
    it('Должен умножить урон снаряда на усиление урона', () => {
      config.PROJECTILE_DAMAGE_MIN = 10;
      config.PROJECTILE_DAMAGE_MAX = 10;

      const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });
      const [projectile] = fireAt(enemy, { ...getBaseStats(), damageMultiplier: 1.5, critChance: 0 }).values();

      expect(projectile.damage).toBe(15);
    });

    it('Должен запустить снаряд со скоростью из характеристик', () => {
      const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });
      const [projectile] = fireAt(enemy, { ...getBaseStats(), projectileSpeed: 30 }).values();
      const { x, y, z } = projectile.body.linvel();

      expect(Math.hypot(x, y, z)).toBeCloseTo(30, 3);
    });

    it('Должен дать снаряду массу из характеристик', () => {
      const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });
      const [projectile] = fireAt(enemy, { ...getBaseStats(), projectileMass: 0.5, critChance: 0 }).values();

      expect(projectile.body.mass()).toBeCloseTo(0.5, 5);
    });
  });

  it('Должен дать снаряду PROJECTILE_BOUNCES отскоков', () => {
    config.PROJECTILE_BOUNCES = 3;

    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });
    const [projectile] = fireAt(enemy).values();

    expect(projectile.bouncesLeft).toBe(3);
  });

  it('Должен утяжелять крит-снаряд в CRIT_MASS_MULTIPLIER раз', () => {
    config.CRIT_CHANCE = 1;

    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });
    const [projectile] = fireAt(enemy).values();

    expect(projectile.body.mass()).toBeCloseTo(config.PROJECTILE_MASS * config.CRIT_MASS_MULTIPLIER, 5);
  });

  it('Должен светить крит-снаряд ярче обычного на CRIT_PROJECTILE_GLOW_MULTIPLIER', () => {
    config.PROJECTILE_GLOW = 1.5;

    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });

    // Материалы общие для всех обычных и для всех крит-снарядов — перекрашиваем под тестовые
    // значения, как это делает панель настроек (applyLiveConfig).
    config.CRIT_CHANCE = 1;
    refreshProjectileColor();
    const [critProjectile] = fireAt(enemy).values();

    config.CRIT_CHANCE = 0;
    const [normalProjectile] = fireAt(enemy).values();

    expect([getGlowIntensity(normalProjectile), getGlowIntensity(critProjectile)]).toEqual([
      config.PROJECTILE_GLOW,
      config.PROJECTILE_GLOW * config.CRIT_PROJECTILE_GLOW_MULTIPLIER,
    ]);
  });
});

describe('findBounceTarget', () => {
  it('Должен выбрать ближайшего к точке врага, кроме исключённого', () => {
    const enemies: Enemies = new Map();
    const excluded = addTestEnemy({ world, scene, enemies, x: 5, y: 0.4, z: 0 });
    const near = addTestEnemy({ world, scene, enemies, x: 7, y: 0.4, z: 0 });

    addTestEnemy({ world, scene, enemies, x: 9, y: 0.4, z: 0 });

    const target = findBounceTarget({ enemies, from: BOUNCE_FROM, excludedHandle: getHandle(excluded) });

    expect(target?.handle).toBe(getHandle(near));
  });

  it('Должен не найти цель, если кроме исключённого врагов нет', () => {
    const enemies: Enemies = new Map();
    const excluded = addTestEnemy({ world, scene, enemies, x: 5, y: 0.4, z: 0 });

    expect(findBounceTarget({ enemies, from: BOUNCE_FROM, excludedHandle: getHandle(excluded) })).toBeUndefined();
  });
});

describe('bounceProjectile', () => {
  it('Должен перенацелить снаряд в следующего врага', () => {
    const { enemies, first, second, projectile } = createBounceCase(1);

    bounceProjectile({ world, projectile, hitHandle: getHandle(first), enemies });

    expect(projectile.targetHandle).toBe(getHandle(second));
  });

  it('Должен пропускать сквозь себя только что задетого врага', () => {
    const { enemies, first, projectile } = createBounceCase(1);

    bounceProjectile({ world, projectile, hitHandle: getHandle(first), enemies });

    expect(projectile.passThroughHandle).toBe(getHandle(first));
  });

  it('Должен потратить один отскок', () => {
    const { enemies, first, projectile } = createBounceCase(2);

    bounceProjectile({ world, projectile, hitHandle: getHandle(first), enemies });

    expect(projectile.bouncesLeft).toBe(1);
  });

  it('Должен отказаться от отскока, когда отскоков не осталось', () => {
    const { enemies, first, projectile } = createBounceCase(0);

    expect(bounceProjectile({ world, projectile, hitHandle: getHandle(first), enemies })).toBe(false);
  });
});

describe('createProjectileHooks', () => {
  it.each([
    ['снаряд + задетый враг', PROJECTILE_HANDLE, PASS_THROUGH_HANDLE, null],
    ['задетый враг + снаряд', PASS_THROUGH_HANDLE, PROJECTILE_HANDLE, null],
    ['снаряд + другой враг', PROJECTILE_HANDLE, OTHER_HANDLE, RAPIER.SolverFlags.COMPUTE_IMPULSE],
  ])('Должен для пары «%s» вернуть %s', (_, collider1, collider2, expected) => {
    expect(createHooks().filterContactPair(collider1, collider2, 0, 0)).toBe(expected);
  });
});

describe('removeFarProjectiles', () => {
  it.each([
    ['в пределах арены', 1, 1],
    ['дальше ARENA_SIZE от центра', 35, 0],
  ])('Должен для снаряда %s оставить %s снарядов', (_, x, expected) => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });
    const projectiles = fireAt(enemy);

    for (const { body } of projectiles.values()) {
      body.setTranslation({ x, y: 0.5, z: 0 }, true);
    }

    removeFarProjectiles({ world, scene, entities: projectiles });

    expect(projectiles.size).toBe(expected);
  });
});
