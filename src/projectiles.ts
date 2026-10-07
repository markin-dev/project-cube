import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ARENA_SIZE, PLAYER_SIZE, PROJECTILE_COLOR, PROJECTILE_SIZE, PROJECTILE_SPEED } from './config';
import { removeEntity, type Entities, type Entity, type EntityContext } from './entity';

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

// Ищет врага, ближайшего к игроку (к центру арены). undefined — врагов нет.
// reduce проходит по всем врагам и оставляет того, кто ближе, чем лучший найденный до него.
export const findNearestEnemy = (enemies: Entities): Entity | undefined =>
  [...enemies.values()].reduce<Entity | undefined>(
    (nearest, enemy) =>
      !nearest || getDistanceToCenterSquared(enemy) < getDistanceToCenterSquared(nearest) ? enemy : nearest,
    undefined,
  );

// Выпускает снаряд из центра игрока в сторону текущей позиции цели.
// Упреждения нет: враги идут прямо на игрока, то есть навстречу снаряду, и он и так попадает.
export const fireProjectile = ({ world, scene, entities, target }: EntityContext & { target: Entity }): void => {
  const { x, z } = target.body.translation();
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
  entities.set(collider.handle, { body, mesh });
};

// Удаляет снаряды, улетевшие за пределы арены, — иначе промахи копились бы бесконечно.
export const removeFarProjectiles = ({ world, scene, entities }: EntityContext): void => {
  for (const [handle, { body }] of entities) {
    const { x, z } = body.translation();
    const isFar = Math.abs(x) > MAX_PROJECTILE_DISTANCE || Math.abs(z) > MAX_PROJECTILE_DISTANCE;

    if (isFar) {
      removeEntity({ world, scene, entities, handle });
    }
  }
};
