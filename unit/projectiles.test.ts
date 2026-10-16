// Юнит-тесты снарядов (src/projectiles.ts): урон и криты, выбор целей, упреждение прицела,
// отсчёт до залпа, выстрел и уборка промахов. Враги и снаряды — настоящие объекты на headless-Rapier.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, MIN_FIRE_INTERVAL } from '@/config';
import type { Enemies, Enemy } from '@/enemies';
import {
  applyCritToDamage,
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
import { addTestEnemy, createTestWorld, getHandle } from './fixtures';

const { world, scene } = await createTestWorld();

const ROLLS_COUNT = 2000;
const SIMULATED_SECONDS = 30;

// Центр куба игрока — откуда вылетает пуля (см. fireOneProjectile).
const getMuzzle = (): THREE.Vector3 => new THREE.Vector3(0, config.PLAYER_SIZE / 2, 0);

const rollMany = (roll: () => number): number[] => Array.from({ length: ROLLS_COUNT }, roll);

// Выпускает снаряд в enemy и возвращает список снарядов.
const fireAt = (enemy: Enemy): Projectiles => {
  const projectiles: Projectiles = new Map();

  fireProjectiles({ world, scene, entities: projectiles, targets: [{ handle: getHandle(enemy), enemy }] });

  return projectiles;
};

// Сколько залпов в секунду выходит при шаге step, если стрелять всегда есть в кого.
const getVolleysPerSecond = (step: number): number => {
  const fireVolley = vi.fn((): number => 1);

  Array.from({ length: Math.round(SIMULATED_SECONDS / step) }).reduce<number>(
    (timer) => runFireTimer({ timer, delta: step, fireVolley }),
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
    config.CRIT_CHANCE = chance;

    expect(rollMany(() => Number(isCritRolled())).filter(Boolean).length).toBe(expected);
  });

  it('Должен при шансе 0.5 давать криты примерно в половине бросков', () => {
    config.CRIT_CHANCE = 0.5;

    const crits = Array.from({ length: 20000 }, isCritRolled).filter(Boolean).length;

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
    config.CRIT_MULTIPLIER = multiplier;

    expect(applyCritToDamage(damage, isCrit)).toBe(expected);
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

    expect(predictPosition({ world, enemy, muzzle: getMuzzle() }).toArray()).toEqual([
      expect.closeTo(5, 5),
      expect.closeTo(0.4, 5),
      expect.closeTo(0, 5),
    ]);
  });

  it('Должен упреждать движение поперёк линии выстрела, но не вдоль неё', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0 });

    // Враг бежит вдоль Z со скоростью 3, пуля летит до него ~1/3 с — смещение по Z ≈ 1.
    enemy.body.setLinvel({ x: 0, y: 0, z: 3 }, true);

    expect(predictPosition({ world, enemy, muzzle: getMuzzle() }).toArray()).toEqual([
      expect.closeTo(5, 3),
      expect.closeTo(0.4, 3),
      expect.closeTo(1, 3),
    ]);
  });

  it('Должен опускать прогноз падающего врага', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 3, z: 0 });

    expect(predictPosition({ world, enemy, muzzle: getMuzzle() }).y).toBeLessThan(3);
  });

  it('Должен не опускать прогноз ниже половины роста врага', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 14, y: 1.5, z: 0 });

    expect(predictPosition({ world, enemy, muzzle: getMuzzle() }).y).toBeCloseTo(0.4, 5);
  });

  it('Должен целиться в центр врага, стоящего на другом враге, без поправки на падение', async () => {
    const stack = await createTestWorld();
    const enemies: Enemies = new Map();

    addTestEnemy({ ...stack, enemies, x: 10, y: 0.4, z: 0 });

    const onStack = addTestEnemy({ ...stack, enemies, x: 10, y: 1.2, z: 0 });

    // Один шаг — чтобы Rapier проиндексировал коллайдеры для луча опоры.
    stack.world.step();

    const expectedY = onStack.body.translation().y;

    expect(predictPosition({ world: stack.world, enemy: onStack, muzzle: getMuzzle() }).y).toBeCloseTo(expectedY, 2);
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
    expect(runFireTimer({ timer: 0, delta: 1 / 30, fireVolley: (): number => 0 })).toBe(0);
  });

  it('Должен выпустить один залп, когда цель появилась после ожидания', () => {
    const fireVolley = vi.fn((): number => 1);

    runFireTimer({ timer: 0, delta: 1 / 30, fireVolley });

    expect(fireVolley).toHaveBeenCalledTimes(1);
  });
});

describe('fireProjectiles', () => {
  it('Должен выпустить по снаряду в каждую цель', () => {
    const enemies: Enemies = new Map();

    [3, 6, 9].forEach((x) => addTestEnemy({ world, scene, enemies, x, y: 0.4, z: 0 }));

    const projectiles: Projectiles = new Map();
    const targets = [...enemies].map(([handle, enemy]) => ({ handle, enemy }));

    fireProjectiles({ world, scene, entities: projectiles, targets });

    expect(projectiles.size).toBe(3);
  });

  it('Должен направить снаряд во врага', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 10, y: 0.4, z: 0 });
    const [projectile] = fireAt(enemy).values();

    expect(projectile.body.linvel().x).toBeGreaterThan(14.5);
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
