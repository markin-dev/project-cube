// Юнит-тесты врагов (src/enemies.ts): границы арены и смерти, опора, появление, урон и движение
// к центру на headless-Rapier. Шаг симуляции фиксированный — тесты детерминированы.
import { describe, expect, it } from 'vitest';
import { config, type EnemyKindName } from '@/config';
import {
  damageEnemy,
  isEnemyAboveCeiling,
  isEnemyBelowFloor,
  isEnemyOverArena,
  isEnemySupported,
  limitInwardSpeed,
  moveEnemies,
  type Enemies,
  type Enemy,
} from '@/enemies';
import { addTestEnemy, createTestBody, createTestWorld, type TestWorld } from './fixtures';

const { world, scene } = await createTestWorld();

const STEP = 1 / 60;

// Прогон шагов: на каждом moveEnemies и (если isStepping) шаг физики. Без шага физики остаётся
// чистая математика moveEnemies — без гравитации, трения и перемещения.
const simulate = ({
  testWorld,
  enemies,
  seconds,
  isStepping = true,
}: {
  testWorld: TestWorld;
  enemies: Enemies;
  seconds: number;
  isStepping?: boolean;
}): void => {
  Array.from({ length: Math.round(seconds / STEP) }).forEach((): void => {
    moveEnemies({ world: testWorld.world, enemies, delta: STEP });

    if (isStepping) {
      testWorld.world.step();
    }
  });
};

// Скорость врага, разложенная на радиальную (к центру арены) и касательную (вдоль кольца).
const getSpeeds = (enemy: Enemy): { radial: number; tangential: number } => {
  const position = enemy.body.translation();
  const velocity = enemy.body.linvel();
  const distance = Math.hypot(position.x, position.z);
  const radialX = -position.x / distance;
  const radialZ = -position.z / distance;

  return {
    radial: velocity.x * radialX + velocity.z * radialZ,
    tangential: velocity.x * -radialZ + velocity.z * radialX,
  };
};

// Враг в точке (5, пол, 5) в своём мире, с параметрами движения из тестов: цель 1 м/с, разгон 3 м/с².
const createMovingEnemy = async (): Promise<{ testWorld: TestWorld; enemies: Enemies; enemy: Enemy }> => {
  config.ENEMY_SPEED = 1;
  config.ENEMY_ACCELERATION = 3;
  config.ENEMY_LINEAR_DAMPING = 0;
  config.ENEMY_ANGULAR_DAMPING = 0;

  const testWorld = await createTestWorld();
  const enemies: Enemies = new Map();
  const enemy = addTestEnemy({ ...testWorld, enemies, x: 5, y: 0.4, z: 5 });

  return { testWorld, enemies, enemy };
};

// Боковая скорость врага после секунды чистого гашения moveEnemies с заданной силой гашения.
const getDampedSpeeds = async (damping: number): Promise<{ radial: number; tangential: number }> => {
  const { testWorld, enemies, enemy } = await createMovingEnemy();
  const sideways = 2 / Math.SQRT2;

  config.ENEMY_TANGENTIAL_DAMPING = damping;
  enemy.body.setLinvel({ x: sideways, y: 0, z: -sideways }, true);
  simulate({ testWorld, enemies, seconds: 1, isStepping: false });

  return getSpeeds(enemy);
};

// Враг типа kindName в стороне от центра, появившийся в волне силы strength (см. spawnEnemy).
const spawnWithStrength = (kindName: EnemyKindName, strength: number): Enemy =>
  addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0, kindName, strength });

// Скорость врага в точке (x, пол, z) после limitInwardSpeed, если до неё скорость была velocity.
const getLimitedVelocity = ({ x, z, velocity }: { x: number; z: number; velocity: number[] }): number[] => {
  const enemies: Enemies = new Map();
  const enemy = addTestEnemy({ world, scene, enemies, x, y: 0.4, z });

  enemy.body.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  limitInwardSpeed(enemies);

  const { x: vx, y: vy, z: vz } = enemy.body.linvel();

  return [vx, vy, vz];
};

describe('isEnemyOverArena', () => {
  it.each([
    ['в центре', 0, 0, true],
    ['у края внутри ±15', 14, -14, true],
    ['за краем по X', 16, 0, false],
    ['за краем по Z', 0, -16, false],
  ])('Должен для врага %s вернуть %s', (_, x, z, expected) => {
    expect(isEnemyOverArena({ body: createTestBody({ world, x, y: 0.5, z }) })).toBe(expected);
  });
});

describe('isEnemySupported', () => {
  // Обычный враг ростом 0.8 м: на полу, пока центр ниже 0.9 роста — 0.72 м.
  it.each([
    ['на полу', 0, 0.4, true],
    ['на ребре: центр чуть ниже 0.9 роста', 0, 0.71, true],
    ['над полом: центр чуть выше 0.9 роста', 0, 0.73, false],
    ['под полом', 0, -1, false],
    ['за краем арены', 16, 0.4, false],
  ])('Должен определять опору врага %s', async (_, x, y, expected) => {
    const testWorld = await createTestWorld();
    const enemy = addTestEnemy({ ...testWorld, enemies: new Map(), x, y, z: 0 });

    // Шаг индексирует коллайдеры для луча опоры; потом возвращаем врага на проверяемую высоту.
    testWorld.world.step();
    enemy.body.setTranslation({ x, y, z: 0 }, true);

    expect(isEnemySupported(testWorld.world, enemy)).toBe(expected);
  });
});

describe('isEnemyAboveCeiling', () => {
  it.each([
    [10.5, true],
    [5, false],
  ])('Должен для центра на высоте %s вернуть %s', (y, expected) => {
    expect(isEnemyAboveCeiling({ body: createTestBody({ world, x: 0, y, z: 0 }) })).toBe(expected);
  });
});

describe('isEnemyBelowFloor', () => {
  it.each([
    [-0.1, true],
    [0.5, false],
  ])('Должен для центра на высоте %s вернуть %s', (y, expected) => {
    expect(isEnemyBelowFloor({ body: createTestBody({ world, x: 0, y, z: 0 }) })).toBe(expected);
  });
});

describe('spawnEnemy', () => {
  it('Должен создать врага с полным здоровьем его типа', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0, kindName: 'big' });

    expect(enemy.hp).toBe(config.ENEMY_KINDS.big.hp);
  });

  it('Должен скопировать тип, чтобы правка конфига не меняла живого врага', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0 });

    config.ENEMY_KINDS.normal.hp = 999;

    expect(enemy.kind.hp).toBe(40);
  });

  it('Должен умножить здоровье врага на силу волны', () => {
    const enemy = spawnWithStrength('big', 2.5);

    expect(enemy.hp).toBe(200);
  });

  it('Должен умножить опыт врага на силу волны', () => {
    const enemy = spawnWithStrength('big', 2.5);

    expect(enemy.kind.xp).toBe(100);
  });

  it('Должен оставить врагу хотя бы 1 HP при очень малой силе волны', () => {
    const enemy = spawnWithStrength('tiny', 0.01);

    expect(enemy.hp).toBe(1);
  });

  it('Должен создать врага без CCD — иначе быстрая пуля с CCD пролетала бы его насквозь', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0 });

    expect(enemy.body.isCcdEnabled()).toBe(false);
  });

  it.each([
    [true, true],
    [false, false],
  ])('Должен при isPinned = %s создать неподвижное тело: %s', (isPinned, expected) => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0, isPinned });

    expect(enemy.body.isFixed()).toBe(expected);
  });
});

describe('damageEnemy', () => {
  it('Должен отнять урон от здоровья', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0 });

    damageEnemy(enemy, 15);

    expect(enemy.hp).toBe(25);
  });

  it('Должен показать полоску здоровья раненого врага', () => {
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 5, y: 0.4, z: 0 });

    damageEnemy(enemy, 15);

    expect(enemy.hpBar.group.visible).toBe(true);
  });
});

describe('moveEnemies', () => {
  it('Должен разгонять врага с места до ENEMY_SPEED, несмотря на трение пола', async () => {
    const { testWorld, enemies, enemy } = await createMovingEnemy();

    // Трение 0.6 даёт ~5.9 м/с² сопротивления — больше ускорения 3: без компенсации враг стоял бы.
    simulate({ testWorld, enemies, seconds: 1 });

    expect(getSpeeds(enemy).radial).toBeGreaterThan(0.7);
  });

  it('Должен гасить откат после удара ускорением и трением, без компенсации трения', async () => {
    const { testWorld, enemies, enemy } = await createMovingEnemy();
    const outward = 3 / Math.SQRT2;

    // Удар отбросил врага от центра: 3 м/с наружу. Торможение a + μg ≈ 8.9 м/с²: за 0.25 с откат
    // ещё не погашен (≈ −0.8 м/с). С лишней компенсацией было бы a + 2μg ≈ 14.8 м/с².
    enemy.body.setLinvel({ x: outward, y: 0, z: outward }, true);
    simulate({ testWorld, enemies, seconds: 0.25 });

    expect(getSpeeds(enemy).radial).toBeLessThan(-0.3);
  });

  it.each([
    ['не гасить боковую скорость без гашения', 0, (tangential: number): boolean => tangential > 1.5],
    ['почти погасить боковую скорость при гашении 5', 5, (tangential: number): boolean => tangential < 0.2],
  ])('Должен %s', async (_, damping, isExpected) => {
    const { tangential } = await getDampedSpeeds(damping);

    expect(isExpected(tangential)).toBe(true);
  });

  it.each([[0], [5]])('Должен вести врага к центру при гашении боковой скорости %s', async (damping) => {
    const { radial } = await getDampedSpeeds(damping);

    expect(radial).toBeGreaterThan(0.7);
  });

  it('Должен управлять врагом на вершине кучи', async () => {
    const { testWorld, enemies } = await createMovingEnemy();
    const onStack = addTestEnemy({ ...testWorld, enemies, x: 5, y: 1.2, z: 5 });

    // Один шаг — чтобы Rapier проиндексировал коллайдеры для луча опоры.
    testWorld.world.step();
    simulate({ testWorld, enemies, seconds: 0.3, isStepping: false });

    expect(getSpeeds(onStack).radial).toBeGreaterThan(0.2);
  });

  it('Не должен управлять врагом в воздухе', async () => {
    const { testWorld, enemies } = await createMovingEnemy();
    const airborne = addTestEnemy({ ...testWorld, enemies, x: 8, y: 5, z: 8 });

    testWorld.world.step();
    airborne.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    simulate({ testWorld, enemies, seconds: 0.3, isStepping: false });

    expect(Math.hypot(getSpeeds(airborne).radial, getSpeeds(airborne).tangential)).toBeCloseTo(0, 5);
  });
});

describe('limitInwardSpeed', () => {
  // Враг в (5, 0) или (3, 4) — оба в 5 м от куба; ENEMY_SPEED по умолчанию 2 м/с.
  it.each([
    { name: 'к кубу быстрее бега', x: 5, z: 0, velocity: [-10, 0, 0], expected: [-2, 0, 0] },
    { name: 'к кубу по диагонали', x: 3, z: 4, velocity: [-6, 0, -8], expected: [-1.2, 0, -1.6] },
    { name: 'к кубу, вбок и вверх', x: 5, z: 0, velocity: [-10, 3, 4], expected: [-2, 3, 4] },
    { name: 'от куба', x: 5, z: 0, velocity: [10, 0, 0], expected: [10, 0, 0] },
    { name: 'к кубу медленнее бега', x: 5, z: 0, velocity: [-1.5, 0, 0], expected: [-1.5, 0, 0] },
  ])('Должен для скорости «$name» оставить $expected', ({ x, z, velocity, expected }) => {
    expect(getLimitedVelocity({ x, z, velocity })).toEqual(expected.map((value) => expect.closeTo(value, 5)));
  });
});
