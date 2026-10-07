import RAPIER, { type ColliderHandle } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PROJECTILE_GROUPS } from './collision-groups';
import {
  ARENA_SIZE,
  PROJECTILE_AIM_HEIGHT,
  PROJECTILE_COLOR,
  PROJECTILE_DAMAGE,
  PROJECTILE_MASS,
  PROJECTILE_SIZE,
  PROJECTILE_SPEED,
} from './config';
import type { Enemies, Enemy } from './enemies';
import { removeEntity, type Entities, type Entity, type EntityContext } from './entity';

// Снаряд помнит, в какого врага его выпустили, — чтобы не стрелять во врага,
// которого уже добьют летящие в него снаряды (см. findTarget).
export type Projectile = Entity & {
  targetHandle: ColliderHandle;
};

export type Projectiles = Entities<Projectile>;

// Цель выстрела: враг и handle его коллайдера (handle запоминаем в снаряде).
export type Target = {
  handle: ColliderHandle;
  enemy: Enemy;
};

// Снаряд, вылетевший дальше этого расстояния от центра по X или Z, точно промахнулся — удаляем.
const MAX_PROJECTILE_DISTANCE = ARENA_SIZE / 2 + 1;

const PROJECTILE_GEOMETRY = new THREE.BoxGeometry(PROJECTILE_SIZE, PROJECTILE_SIZE, PROJECTILE_SIZE);
const PROJECTILE_MATERIAL = new THREE.MeshLambertMaterial({ color: PROJECTILE_COLOR });

// Квадрат расстояния от объекта до центра арены по полу.
// Для сравнения «кто ближе» корень не нужен: от него порядок не меняется, а считать дешевле.
const getDistanceToCenterSquared = (entity: Entity): number => {
  const { x, z } = entity.body.translation();

  return x * x + z * z;
};

// Урон, который уже летит во врага: сколько выпущенных в него снарядов ещё в воздухе, × урон снаряда.
const getIncomingDamage = (projectiles: Projectiles, enemyHandle: ColliderHandle): number =>
  [...projectiles.values()].filter(({ targetHandle }) => targetHandle === enemyHandle).length * PROJECTILE_DAMAGE;

// Выбирает цель: ближайшего к игроку врага из тех, кого летящие снаряды ещё не добьют.
// Без этой проверки куб тратил бы снаряды впустую: снаряд летит до врага больше полсекунды,
// и пока добивающий снаряд в пути, куб успевает выпустить в того же врага ещё 2–3 лишних.
// undefined — стрелять не в кого: врагов нет или все уже «получат своё».
export const findTarget = ({ enemies, projectiles }: { enemies: Enemies; projectiles: Projectiles }): Target | undefined =>
  [...enemies]
    .filter(([handle, enemy]) => enemy.hp > getIncomingDamage(projectiles, handle))
    .map(([handle, enemy]) => ({ handle, enemy }))
    .reduce<Target | undefined>(
      (nearest, target) =>
        !nearest || getDistanceToCenterSquared(target.enemy) < getDistanceToCenterSquared(nearest.enemy)
          ? target
          : nearest,
      undefined,
    );

// Выпускает пулю из центра игрока в сторону цели — горизонтально, на высоте PROJECTILE_AIM_HEIGHT
// от роста цели (у маленьких врагов ниже, у больших выше). Упреждения нет: враги идут прямо на игрока,
// то есть навстречу пуле.
export const fireProjectile = ({
  world,
  scene,
  entities,
  target,
}: EntityContext<Projectile> & { target: Target }): void => {
  const { x, z } = target.enemy.body.translation();
  const distance = Math.hypot(x, z);
  const height = target.enemy.kind.size * PROJECTILE_AIM_HEIGHT;

  if (distance === 0) {
    return;
  }

  // Скорость задаём один раз при выстреле. setGravityScale(0) — гравитация на пулю не действует:
  // она летит по прямой, как очень быстрая пуля, у которой падение на таком расстоянии незаметно.
  // CCD (непрерывное определение столкновений) — пуля маленькая и быстрая: без него за один шаг
  // симуляции она успела бы глубоко влезть во врага, и физика выталкивала бы её с лишней силой.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, height, 0)
      .setLinvel((x / distance) * PROJECTILE_SPEED, 0, (z / distance) * PROJECTILE_SPEED)
      .setGravityScale(0)
      .setCcdEnabled(true),
  );

  // Пуля — твёрдое тело с массой: врезаясь во врага, она толкает его, как настоящая.
  // Сколько импульса передать, в какую сторону и с каким вращением — считает физический движок
  // по массам, скорости и точке контакта. После попадания пулю удаляем (см. applyHit в main.ts).
  // Группа столкновений пули — только враги: сквозь игрока, пол, другие пули и призраков она пролетает.
  // ActiveEvents.COLLISION_EVENTS — сообщать о столкновениях: так мы узнаём о попадании.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(PROJECTILE_SIZE / 2, PROJECTILE_SIZE / 2, PROJECTILE_SIZE / 2)
      .setMass(PROJECTILE_MASS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(PROJECTILE_GROUPS),
    body,
  );

  const mesh = new THREE.Mesh(PROJECTILE_GEOMETRY, PROJECTILE_MATERIAL);
  mesh.position.copy(body.translation());
  scene.add(mesh);
  entities.set(collider.handle, { body, object: mesh, targetHandle: target.handle });
};

// Удаляет снаряды, улетевшие за пределы арены, — иначе промахи копились бы бесконечно.
export const removeFarProjectiles = ({ world, scene, entities }: EntityContext<Projectile>): void => {
  for (const [handle, { body }] of entities) {
    const { x, z } = body.translation();
    const isFar = Math.abs(x) > MAX_PROJECTILE_DISTANCE || Math.abs(z) > MAX_PROJECTILE_DISTANCE;

    if (isFar) {
      removeEntity({ world, scene, entities, handle });
    }
  }
};
