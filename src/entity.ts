import type { ColliderHandle, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { Mesh, Object3D, Scene } from 'three';
import { FALL_REMOVE_HEIGHT } from './config';

// Игровой объект = физическое тело (Rapier) + видимый объект (Three.js).
// Физика двигает тело, а мы каждый кадр переносим его положение на видимый объект.
// Object3D — любой объект сцены: и отдельный меш (снаряд), и группа из нескольких (враг).
export type Entity = {
  body: RigidBody;
  object: Object3D;
};

// Объект с кубом, который вращается вместе с телом (враги и их призраки).
// Сам object при этом только двигается и не вращается — поэтому его дочерние объекты,
// например полоска здоровья, не кувыркаются вместе с кубом.
export type CubeEntity = Entity & {
  cube: Mesh;
};

// Все объекты одного вида (враги, снаряды) храним в Map.
// Ключ — handle коллайдера: это число, которое Rapier присылает в событиях столкновений.
// По нему сразу находим, с каким объектом что-то столкнулось.
// T — тип объекта: по умолчанию просто Entity, а у врагов — Enemy с дополнительными полями.
export type Entities<T extends Entity = Entity> = Map<ColliderHandle, T>;

// Набор, который нужен почти любой операции с объектами: физический мир, сцена и сам список объектов.
export type EntityContext<T extends Entity = Entity> = {
  world: World;
  scene: Scene;
  entities: Entities<T>;
};

// Удаляет объект отовсюду: из физики, со сцены и из списка.
// removeRigidBody удаляет и все коллайдеры, прикреплённые к телу, а scene.remove — объект вместе
// с его дочерними объектами (например, кубом и полоской здоровья врага).
// <T extends Entity> — функция работает со списком любых объектов: и снарядов, и врагов.
export const removeEntity = <T extends Entity>({
  world,
  scene,
  entities,
  handle,
}: EntityContext<T> & { handle: ColliderHandle }): void => {
  const entity = entities.get(handle);

  if (!entity) {
    return;
  }

  world.removeRigidBody(entity.body);
  scene.remove(entity.object);
  entities.delete(handle);
};

export const removeAllEntities = <T extends Entity>({ world, scene, entities }: EntityContext<T>): void => {
  // Удалять элементы Map прямо во время обхода в JS безопасно: удалённые просто не попадут в цикл.
  for (const handle of entities.keys()) {
    removeEntity({ world, scene, entities, handle });
  }
};

// Удаляет объекты, упавшие с арены ниже FALL_REMOVE_HEIGHT: дальше они падали бы вечно.
export const removeFallenEntities = <T extends Entity>({ world, scene, entities }: EntityContext<T>): void => {
  for (const [handle, { body }] of entities) {
    if (body.translation().y < FALL_REMOVE_HEIGHT) {
      removeEntity({ world, scene, entities, handle });
    }
  }
};

// Физика обновила тела, но видимые объекты об этом не знают — копируем положение вручную.
export const syncPositions = <T extends Entity>(entities: Entities<T>): void => {
  for (const { body, object } of entities.values()) {
    object.position.copy(body.translation());
  }
};

// Поворот тела копируем только на куб, а не на весь объект: см. CubeEntity.
// rotation() — поворот в виде кватерниона (четыре числа), Three.js понимает его напрямую.
export const syncCubeRotations = <T extends CubeEntity>(entities: Entities<T>): void => {
  for (const { body, cube } of entities.values()) {
    cube.quaternion.copy(body.rotation());
  }
};
