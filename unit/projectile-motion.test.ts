// Юнит-тесты полёта снаряда (src/projectiles.ts): упреждение прицела и подбор промахов.
//
// Две стороны жизни снаряда вне залпа/критов (они уже в unit/crit-damage.test.ts):
//   predictPosition — КУДА целится пуля: прогноз центра врага к моменту прилёта, со смещением
//     ПОПЕРЁК линии выстрела (вдоль линии упреждать не нужно — враг всё равно на пути) и падением
//     под гравитацией, если под врагом нет опоры. Детерминирован заданной скоростью врага — без рандома.
//   removeFarProjectiles — промахи подчищаются: пуля, отлетевшая дальше ARENA_SIZE от центра
//     арены, удаляется, иначе куб считал бы её «летящей в цель» и не стрелял бы в того же врага.
//
// Опору прицел проверяет лучом по физическому миру, поэтому враги — настоящие тела Rapier
// в группе врагов; Rapier и сцена Three.js работают и в Node без браузера.
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ENEMY_GROUPS } from '../src/collision-groups';
import { config } from '../src/config';
import { createPhysics } from '../src/physics';
import { predictPosition, removeFarProjectiles, type Projectile, type Projectiles } from '../src/projectiles';

// Враг для прицела: тело с коллайдером в группе врагов (луч опоры видит только её) и тип с размером.
const createEnemy = ({
  world,
  x,
  y,
  z,
  vx = 0,
  vz = 0,
  size = 1,
}: {
  world: RAPIER.World;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vz?: number;
  size?: number;
}) => {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, 0, vz));

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setCollisionGroups(ENEMY_GROUPS),
    body,
  );

  return { body, kind: { size, mass: 1, hp: 40, color: '#ffffff' } };
};

// Центр куба игрока — откуда вылетает пуля (см. fireOneProjectile).
const muzzle = (): THREE.Vector3 => new THREE.Vector3(0, config.PLAYER_SIZE / 2, 0);

describe('прицел: прогноз центра врага (упреждение)', () => {
  beforeEach(() => {
    config.PROJECTILE_SPEED = 15;
    config.PROJECTILE_LEAD = 1;
    config.GRAVITY = 9.81;
    config.PLAYER_SIZE = 1;
    config.ARENA_SIZE = 30;
  });

  it('неподвижный враг на полу: прогноз совпадает с текущим центром', async () => {
    const { world } = await createPhysics();
    const enemy = createEnemy({ world, x: 5, y: 0.5, z: 0 });
    const position = predictPosition({ world, enemy, muzzle: muzzle() });

    expect(position.x).toBeCloseTo(5, 5);
    expect(position.y).toBeCloseTo(0.5, 5);
    expect(position.z).toBeCloseTo(0, 5);
  });

  it('движущийся враг: смещение идёт ПОПЕРЁК линии выстрела, а не вдоль неё', async () => {
    const { world } = await createPhysics();

    // Враг справа от игрока (линия выстрела — ось X), бежит вдоль Z (строго поперёк).
    const enemy = createEnemy({ world, x: 5, y: 0.5, z: 0, vz: 3 });
    const position = predictPosition({ world, enemy, muzzle: muzzle() });

    // Время полёта ≈ дистанция / скорость = 5 / 15 = 1/3 с → смещение по Z ≈ 3 × 1/3 = 1.
    expect(position.z).toBeCloseTo(1, 5);
    // Составляющая вдоль линии выстрела (X) из смещения убрана — цель не «уходит за спину».
    expect(position.x).toBeCloseTo(5, 5);
  });

  it('враг в воздухе: прогноз падает под гравитацией, но не ниже половины роста', async () => {
    const { world } = await createPhysics();
    const airborneY = 10;
    const enemy = createEnemy({ world, x: 5, y: airborneY, z: 0 });
    const position = predictPosition({ world, enemy, muzzle: muzzle() });

    // Опоры нет (высоко, луч вниз пуст) → добавлено падение g·t²/2, цель прогнозируется ниже.
    expect(position.y).toBeLessThan(airborneY);
    // Но центр не может опуститься ниже половины роста врага.
    expect(position.y).toBeGreaterThanOrEqual(0.5);
  });

  it('Должен целиться в центр врага, стоящего на другом враге, без поправки на падение', async () => {
    const { world } = await createPhysics();

    createEnemy({ world, x: 10, y: 0.5, z: 0 });

    const onStack = createEnemy({ world, x: 10, y: 1.5, z: 0 });

    // Один шаг — чтобы Rapier проиндексировал коллайдеры для луча опоры.
    world.step();

    const expectedY = onStack.body.translation().y;

    expect(predictPosition({ world, enemy: onStack, muzzle: muzzle() }).y).toBeCloseTo(expectedY, 2);
  });
});

describe('жизненный цикл снаряда', () => {
  beforeEach(() => {
    config.ARENA_SIZE = 30;
  });

  it('removeFarProjectiles: промах дальше арены удаляется, близкий — остаётся', async () => {
    const { world } = await createPhysics();
    const scene = new THREE.Scene();
    const projectiles: Projectiles = new Map();

    const spawnProjectile = (x: number, y: number, z: number): Projectile =>
      ({
        body: world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)),
        object: new THREE.Mesh(),
        targetHandle: 0,
        damage: 10,
        isCrit: false,
      }) as Projectile;

    const near = spawnProjectile(1, 0.5, 1); // в пределах арены
    const far = spawnProjectile(config.ARENA_SIZE + 5, 0, 0); // промах за краем
    projectiles.set(0, near);
    projectiles.set(1, far);

    removeFarProjectiles({ world, scene, entities: projectiles });

    expect(projectiles.size).toBe(1);
    expect(projectiles.get(0)).toBe(near); // близкий снаряд цел
  });
});
