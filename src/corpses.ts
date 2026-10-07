// Призраки погибших врагов. После смертельного удара враг продолжает лететь и кувыркаться по физике,
// но сталкивается только с полом: враги, снаряды и игрок его больше не замечают.
// Через CORPSE_LIFETIME секунд призрак сжимается и исчезает.
import type { ColliderHandle, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CORPSE_GROUPS } from './collision-groups';
import { CORPSE_COLOR, CORPSE_LIFETIME, CORPSE_OPACITY, CORPSE_SHRINK_DURATION } from './config';
import type { Enemies } from './enemies';
import { removeEntity, type CubeEntity, type Entities, type EntityContext } from './entity';

export type Corpse = CubeEntity & {
  // Сколько секунд прошло с гибели.
  age: number;
};

export type Corpses = Entities<Corpse>;

// transparent + opacity — полупрозрачный материал. depthWrite: false — призрак не «закрывает» собой
// то, что за ним, иначе сквозь него не было бы видно других врагов.
const CORPSE_MATERIAL = new THREE.MeshLambertMaterial({
  color: CORPSE_COLOR,
  transparent: true,
  opacity: CORPSE_OPACITY,
  depthWrite: false,
});

// Превращает врага в призрака: переносит из списка врагов в список призраков, меняет группу
// столкновений и материал, убирает полоску здоровья. Тело остаётся тем же — со всей его скоростью
// и вращением, поэтому призрак продолжает лететь после удара.
export const turnIntoCorpse = ({
  world,
  enemies,
  corpses,
  handle,
}: {
  world: World;
  enemies: Enemies;
  corpses: Corpses;
  handle: ColliderHandle;
}): void => {
  const enemy = enemies.get(handle);

  if (!enemy) {
    return;
  }

  world.getCollider(handle).setCollisionGroups(CORPSE_GROUPS);
  enemy.cube.material = CORPSE_MATERIAL;
  enemy.hpBar.group.removeFromParent();
  enemies.delete(handle);
  corpses.set(handle, { body: enemy.body, object: enemy.object, cube: enemy.cube, age: 0 });
};

// Старит призраков: отлежав CORPSE_LIFETIME секунд, призрак за CORPSE_SHRINK_DURATION секунд
// сжимается до нуля и удаляется. Сжимается только картинка — коллайдер прежнего размера, но он и так
// касается одного пола.
export const updateCorpses = ({ world, scene, entities, delta }: EntityContext<Corpse> & { delta: number }): void => {
  for (const [handle, corpse] of entities) {
    corpse.age += delta;

    // 0 — сжатие только началось, 1 — закончилось. Отрицательное — ещё рано.
    const shrinkProgress = (corpse.age - CORPSE_LIFETIME) / CORPSE_SHRINK_DURATION;

    if (shrinkProgress >= 1) {
      removeEntity({ world, scene, entities, handle });

      continue;
    }

    if (shrinkProgress > 0) {
      corpse.cube.scale.setScalar(1 - shrinkProgress);
    }
  }
};
