import type { ColliderHandle, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { Mesh, Scene } from 'three';

// Игровой объект = физическое тело (Rapier) + видимый меш (Three.js).
// Физика двигает тело, а мы каждый кадр переносим его положение на меш.
export type Entity = {
  body: RigidBody;
  mesh: Mesh;
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
// removeRigidBody удаляет и все коллайдеры, прикреплённые к телу, а scene.remove — меш вместе
// с его дочерними объектами (например, полоской здоровья врага).
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
  scene.remove(entity.mesh);
  entities.delete(handle);
};

export const removeAllEntities = <T extends Entity>({ world, scene, entities }: EntityContext<T>): void => {
  // Удалять элементы Map прямо во время обхода в JS безопасно: удалённые просто не попадут в цикл.
  for (const handle of entities.keys()) {
    removeEntity({ world, scene, entities, handle });
  }
};

// Физика обновила тела, но меши об этом не знают — копируем положение вручную.
// Поворот не копируем: враги и снаряды в этой игре не вращаются.
export const syncMeshes = <T extends Entity>(entities: Entities<T>): void => {
  for (const { body, mesh } of entities.values()) {
    mesh.position.copy(body.translation());
  }
};
