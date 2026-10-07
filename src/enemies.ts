import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ENEMY_COLOR, ENEMY_MAX_HP, ENEMY_SIZE, ENEMY_SPEED, HP_BAR_GAP } from './config';
import type { Entities, Entity, EntityContext } from './entity';
import { createHpBar, setHpBarValue, turnToCamera, type HpBar } from './hp-bar';
import type { Point } from './patterns';

// Враг — обычный игровой объект плюс здоровье и полоска здоровья над ним.
export type Enemy = Entity & {
  hp: number;
  hpBar: HpBar;
};

export type Enemies = Entities<Enemy>;

// Геометрия и материал общие для всех врагов: незачем создавать новые для каждого,
// Three.js умеет рисовать много мешей с одной геометрией и одним материалом.
const ENEMY_GEOMETRY = new THREE.BoxGeometry(ENEMY_SIZE, ENEMY_SIZE, ENEMY_SIZE);
const ENEMY_MATERIAL = new THREE.MeshLambertMaterial({ color: ENEMY_COLOR });

// Создаёт врага в точке point на полу. Где именно — решают паттерны волны (src/patterns.ts).
export const spawnEnemy = ({ world, scene, entities, point }: EntityContext<Enemy> & { point: Point }): void => {
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

  // Полоска здоровья — дочерний объект меша: её позиция отсчитывается от центра врага,
  // поэтому она сама двигается вместе с ним и удаляется со сцены вместе с ним.
  // Поднимаем её над верхней гранью куба (центр врага — на половине его высоты).
  const hpBar = createHpBar();
  hpBar.group.position.y = ENEMY_SIZE / 2 + HP_BAR_GAP;
  mesh.add(hpBar.group);

  scene.add(mesh);
  entities.set(collider.handle, { body, mesh, hp: ENEMY_MAX_HP, hpBar });
};

// Отнимает здоровье и обновляет полоску. Удалять погибшего врага (hp <= 0) — дело вызывающего кода.
export const damageEnemy = (enemy: Enemy, damage: number): void => {
  enemy.hp -= damage;
  setHpBarValue(enemy.hpBar, enemy.hp / ENEMY_MAX_HP);
};

// Каждый кадр направляем всех врагов к центру арены, где стоит игрок.
export const moveEnemies = (enemies: Enemies): void => {
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

// Поворачиваем полоски здоровья всех врагов к камере.
export const turnHpBarsToCamera = (enemies: Enemies, camera: THREE.Camera): void => {
  for (const { hpBar } of enemies.values()) {
    turnToCamera(hpBar, camera);
  }
};
