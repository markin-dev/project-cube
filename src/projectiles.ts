import RAPIER, { type ColliderHandle } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  ARENA_SIZE,
  PLAYER_SIZE,
  PROJECTILE_COLOR,
  PROJECTILE_DAMAGE,
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

// Выпускает снаряд из центра игрока в сторону текущей позиции цели.
// Упреждения нет: враги идут прямо на игрока, то есть навстречу снаряду, и он и так попадает.
export const fireProjectile = ({
  world,
  scene,
  entities,
  target,
}: EntityContext<Projectile> & { target: Target }): void => {
  const { x, z } = target.enemy.body.translation();
  const distance = Math.hypot(x, z);

  if (distance === 0) {
    return;
  }

  // Скорость задаём один раз при выстреле: гравитации и трения нет, так что дальше снаряд
  // летит по прямой с постоянной скоростью. Высота — центр игрока, чтобы снаряд задевал врагов.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, PLAYER_SIZE / 2, 0)
      .setLinvel((x / distance) * PROJECTILE_SPEED, 0, (z / distance) * PROJECTILE_SPEED),
  );

  // Сенсор — коллайдер, который ни с чем не сталкивается физически (не толкает и не отскакивает),
  // а только сообщает о пересечениях. Так снаряд не сдвинет врага, а мы узнаем о попадании.
  // Он же не застревает в игроке, хотя появляется прямо внутри него.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(PROJECTILE_SIZE / 2, PROJECTILE_SIZE / 2, PROJECTILE_SIZE / 2)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );

  const mesh = new THREE.Mesh(PROJECTILE_GEOMETRY, PROJECTILE_MATERIAL);
  mesh.position.copy(body.translation());
  scene.add(mesh);
  entities.set(collider.handle, { body, mesh, targetHandle: target.handle });
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
