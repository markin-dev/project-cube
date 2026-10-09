// Юнит-тесты модели движения врагов (src/enemies.ts: moveEnemies и опора) на headless-Rapier.
//
// Раньше эти проверки жили в сырых браузерных E2E (enemy-acceleration / enemy-tangential / enemy-support)
// и флакили: они ловили мгновенные скорости в живой симуляции реального времени. Здесь физика крутится
// ДЕТЕРМИНИРОВАННО в Node: Rapier работает headless, кадры фиксированного шага DT, никакого браузера
// и таймингов. moveEnemies/isEnemySupported используют только enemy.body (тело Rapier) и enemy.kind.size,
// поэтому врага собираем минимальной фикстурой { body, kind } — меш и полоска здоровья не нужны.
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENEMY_GROUPS } from '../src/collision-groups';
import { config } from '../src/config';
import { createPhysics } from '../src/physics';
import { moveEnemies } from '../src/enemies';
import type { Enemies } from '../src/enemies';

// Шаг симуляции — как реальный кадр (60 FPS), но фиксированный: детерминизм.
const DT = 1 / 60;
const SIZE = 0.8;

// Минимальный враг: динамическое тело Rapier с коллайдером в группе ENEMY (как в spawnEnemy) плюс
// kind.size — единственное поле типа, которое движению нужно. Кладём в карту Enemies по handle.
const makeEnemy = (world: RAPIER.World, x: number, y: number, z: number): { body: RAPIER.RigidBody; kind: { size: number } } => {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(config.ENEMY_LINEAR_DAMPING)
      .setAngularDamping(config.ENEMY_ANGULAR_DAMPING),
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(SIZE / 2, SIZE / 2, SIZE / 2)
      .setMass(1)
      .setFriction(config.ENEMY_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(ENEMY_GROUPS),
    body,
  );

  return { body, kind: { size: SIZE } };
};

const toEnemies = (...list: Array<{ body: RAPIER.RigidBody; kind: { size: number } }>): Enemies =>
  new Map(list.map((enemy, index) => [index, enemy as never])) as Enemies;

// Прогон кадров: на каждом moveEnemies и (опционально) world.step. step:false — чистая математика
// moveEnemies без гравитации/трения/перемещения (удобно изолировать гашение касательной скорости).
const simulate = (world: RAPIER.World, enemies: Enemies, frames: number, step = true): void => {
  for (let frame = 0; frame < frames; frame++) {
    moveEnemies(world, enemies, DT);
    if (step) {
      world.step();
    }
  }
};

// Скорость врага, разложенная на радиальную (к центру арены) и касательную (вдоль кольца).
const speeds = (enemy: { body: RAPIER.RigidBody }): { radial: number; tangential: number } => {
  const p = enemy.body.translation();
  const v = enemy.body.linvel();
  const distance = Math.hypot(p.x, p.z);
  const radialX = -p.x / distance;
  const radialZ = -p.z / distance;

  return {
    radial: v.x * radialX + v.z * radialZ,
    tangential: v.x * -radialZ + v.z * radialX,
  };
};

describe('движение врагов (headless-Rapier)', () => {
  beforeEach(() => {
    config.ENEMY_SPEED = 1; // цель разгона
    config.ENEMY_ACCELERATION = 3;
    config.ENEMY_FRICTION = 0.6;
    config.ENEMY_TANGENTIAL_DAMPING = 0.5;
    config.ENEMY_LINEAR_DAMPING = 0;
    config.ENEMY_ANGULAR_DAMPING = 0;
  });

  it('враг с места разгоняется до ENEMY_SPEED, несмотря на трение пола (компенсация)', async () => {
    const { world } = await createPhysics();
    // Свежее появление на полу: центр на половине роста, под ним пол.
    const enemy = makeEnemy(world, 5, SIZE / 2, 5);
    const enemies = toEnemies(enemy);

    // Трение 0.6 даёт ~5.9 м/с² сопротивления — выше ускорения 3. Без компенсации враг с места
    // не сдвинулся бы; с ней чистый разгон ~3 м/с² и за 1 с доходит до цели (1 м/с).
    simulate(world, enemies, Math.round(1 / DT));

    expect(speeds(enemy).radial).toBeGreaterThan(0.7);
  });

  it('касательная скорость гасится по ENEMY_TANGENTIAL_DAMPING, а радиальная идёт к центру', async () => {
    const { world } = await createPhysics();

    const makeTangentialEnemy = () => {
      const enemy = makeEnemy(world, 5, SIZE / 2, 5);
      // Чисто боковой толчок 2 м/с (перпендикуляр радиусу) — как от удара пули.
      const p = enemy.body.translation();
      const distance = Math.hypot(p.x, p.z);
      const tangentialX = p.z / distance;
      const tangentialZ = -p.x / distance;
      enemy.body.setLinvel({ x: tangentialX * 2, y: 0, z: tangentialZ * 2 }, true);
      return enemy;
    };

    // Шаг 0 (без step): изолируем чистое гашение от moveEnemies, без трения пола.
    const runDamped = (damping: number, frames: number) => {
      config.ENEMY_TANGENTIAL_DAMPING = damping;
      const enemy = makeTangentialEnemy();
      simulate(world, toEnemies(enemy), frames, false);
      return speeds(enemy);
    };

    // Без гашения (0) боковая скорость почти не теряется за 1 с.
    const undamped = runDamped(0, Math.round(1 / DT));
    expect(undamped.tangential).toBeGreaterThan(1.5);
    // При сильном гашении (5) за 1 с боковая практически исчезает.
    const damped = runDamped(5, Math.round(1 / DT));
    expect(damped.tangential).toBeLessThan(0.2);
    // Радиальная составляющая в обоих случаях устремляется к ENEMY_SPEED — «идти к центру» цело.
    expect(undamped.radial).toBeGreaterThan(0.7);
    expect(damped.radial).toBeGreaterThan(0.7);
  });

  it('враг на вершине кучи управляем, а в воздухе — нет (опора)', async () => {
    const { world } = await createPhysics();

    // Стопка: нижний на полу, верхний стоит на его верхней грани (y = половина + рост).
    const lower = makeEnemy(world, 5, SIZE / 2, 5);
    const onStack = makeEnemy(world, 5, SIZE / 2 + SIZE, 5);
    // В воздухе: высокo, луч вниз ничего не находит.
    const airborne = makeEnemy(world, 8, 5, 8);

    // Один world.step нужен, чтобы Rapier проиндексировал коллайдеры в QueryPipeline — иначе
    // castRay (то, чем считается опора) до первого шага не видит вообще ничего. Стекка уже лежит
    // в упор (нижний — на полу, верхний — на его верхней грани), поэтому позиции почти не меняются.
    world.step();

    simulate(world, toEnemies(lower, onStack, airborne), Math.round(0.3 / DT), false);

    // Верхний опирается на нижнего (луч вниз его видит) — управляется и ползёт к центру.
    expect(speeds(onStack).radial).toBeGreaterThan(0.2);
    // В воздухе опоры нет — moveEnemies его не трогает, скорость остаётся нулевой.
    expect(speeds(airborne).radial).toBeCloseTo(0, 5);
    expect(Math.abs(speeds(airborne).tangential)).toBeCloseTo(0, 5);
  });
});
