import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ENEMY_COLOR, ENEMY_SIZE, ENEMY_SPEED } from './config';
import type { Entities, EntityContext } from './entity';
import type { Point } from './patterns';

// Геометрия и материал общие для всех врагов: незачем создавать новые для каждого,
// Three.js умеет рисовать много мешей с одной геометрией и одним материалом.
const ENEMY_GEOMETRY = new THREE.BoxGeometry(ENEMY_SIZE, ENEMY_SIZE, ENEMY_SIZE);
const ENEMY_MATERIAL = new THREE.MeshLambertMaterial({ color: ENEMY_COLOR });

// Создаёт врага в точке point на полу. Где именно — решают паттерны волны (src/patterns.ts).
export const spawnEnemy = ({ world, scene, entities, point }: EntityContext & { point: Point }): void => {
  const { x, z } = point;

  // dynamic — тело, которым управляет физика: его толкают другие тела, и оно толкает их.
  // Благодаря этому враги не проходят друг сквозь друга, а расталкиваются.
  // lockRotations — от толчков враг не будет кувыркаться.
  // enabledTranslations(true, false, true) — двигаться можно только по X и Z,
  // по Y нельзя: враги не подпрыгивают, когда упираются друг в друга.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, ENEMY_SIZE / 2, z)
      .lockRotations()
      .enabledTranslations(true, false, true),
  );

  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(ENEMY_SIZE / 2, ENEMY_SIZE / 2, ENEMY_SIZE / 2),
    body,
  );

  const mesh = new THREE.Mesh(ENEMY_GEOMETRY, ENEMY_MATERIAL);
  mesh.position.copy(body.translation());
  scene.add(mesh);
  entities.set(collider.handle, { body, mesh });
};

// Каждый кадр направляем всех врагов к центру арены, где стоит игрок.
export const moveEnemies = (enemies: Entities): void => {
  for (const { body } of enemies.values()) {
    const { x, z } = body.translation();

    // Вектор к центру — это (-x, -z). Делим его на длину, чтобы получить направление длиной 1,
    // и умножаем на скорость. Без деления дальние враги бежали бы быстрее ближних.
    const distance = Math.hypot(x, z);

    // В самом центре стоит игрок, враг туда не попадёт, но делить на ноль всё равно не будем.
    if (distance === 0) {
      continue;
    }

    // Скорость задаём заново каждый кадр: после толчков от соседей враг снова идёт точно к центру.
    // true «будит» тело: Rapier усыпляет неподвижные тела, и спящее не сдвинется даже со скоростью.
    body.setLinvel({ x: (-x / distance) * ENEMY_SPEED, y: 0, z: (-z / distance) * ENEMY_SPEED }, true);
  }
};
