import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ENEMY_GROUPS } from './collision-groups';
import {
  ENEMY_ACCELERATION,
  ENEMY_ANGULAR_DAMPING,
  ENEMY_COLOR,
  ENEMY_FRICTION,
  ENEMY_LINEAR_DAMPING,
  ENEMY_MASS,
  ENEMY_MAX_HP,
  ENEMY_RESTITUTION,
  ENEMY_SIZE,
  ENEMY_SPEED,
  HP_BAR_GAP,
} from './config';
import type { CubeEntity, Entities, EntityContext } from './entity';
import { createHpBar, setHpBarValue, turnToCamera, type HpBar } from './hp-bar';
import type { Point } from './patterns';

// Враг — куб, который вращается вместе с телом (см. CubeEntity), плюс здоровье и полоска здоровья.
export type Enemy = CubeEntity & {
  hp: number;
  hpBar: HpBar;
};

export type Enemies = Entities<Enemy>;

// Геометрия и материал общие для всех врагов: незачем создавать новые для каждого,
// Three.js умеет рисовать много мешей с одной геометрией и одним материалом.
const ENEMY_GEOMETRY = new THREE.BoxGeometry(ENEMY_SIZE, ENEMY_SIZE, ENEMY_SIZE);
const ENEMY_MATERIAL = new THREE.MeshLambertMaterial({ color: ENEMY_COLOR });

// Враг стоит на полу, а не летит, если его центр ниже этой высоты. Куб, лежащий на грани, держит центр
// на высоте половины стороны, а застывший на ребре или вершине — до ~0.87 стороны. Чуть выше — уже полёт.
const ON_FLOOR_HEIGHT = ENEMY_SIZE * 0.9;

// Создаёт врага в точке point на полу. Где именно — решают паттерны волны (src/patterns.ts).
export const spawnEnemy = ({ world, scene, entities, point }: EntityContext<Enemy> & { point: Point }): void => {
  const { x, z } = point;

  // dynamic — тело, которым управляет физика: оно падает, отлетает от ударов, кувыркается
  // и толкает других врагов. Затухание гасит полёт и вращение, как сопротивление воздуха.
  // CCD (непрерывное определение столкновений) не даёт быстро летящему врагу проскочить сквозь пол
  // между двумя шагами симуляции.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, ENEMY_SIZE / 2, z)
      .setLinearDamping(ENEMY_LINEAR_DAMPING)
      .setAngularDamping(ENEMY_ANGULAR_DAMPING)
      .setCcdEnabled(true),
  );

  // Масса задаётся явно: от неё зависит, насколько врага сдвинет пуля (см. PROJECTILE_MASS).
  // Момент инерции — то, насколько трудно раскрутить куб, — Rapier считает сам по форме и массе.
  // Трение и упругость при столкновении двух коллайдеров Rapier по умолчанию усредняет.
  // Правило Max берёт большее из двух значений: у пола они нулевые, поэтому о пол и о других врагов
  // работают ровно числа из конфига.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(ENEMY_SIZE / 2, ENEMY_SIZE / 2, ENEMY_SIZE / 2)
      .setMass(ENEMY_MASS)
      .setFriction(ENEMY_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(ENEMY_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(ENEMY_GROUPS),
    body,
  );

  // Видимый враг — группа, которая только двигается вместе с телом. Внутри неё:
  // куб — вращается вместе с телом (кувыркается);
  // полоска здоровья — не вращается и висит над центром врага, на полстороны куба плюс зазор выше.
  const cube = new THREE.Mesh(ENEMY_GEOMETRY, ENEMY_MATERIAL);
  const hpBar = createHpBar();
  hpBar.group.position.y = ENEMY_SIZE / 2 + HP_BAR_GAP;

  const object = new THREE.Group();
  object.add(cube, hpBar.group);
  object.position.copy(body.translation());
  scene.add(object);

  entities.set(collider.handle, { body, object, cube, hp: ENEMY_MAX_HP, hpBar });
};

// Отнимает здоровье и обновляет полоску. Что делать с погибшим (hp <= 0) — решает вызывающий код.
export const damageEnemy = (enemy: Enemy, damage: number): void => {
  enemy.hp -= damage;
  setHpBarValue(enemy.hpBar, enemy.hp / ENEMY_MAX_HP);
};

// Каждый кадр враги, стоящие на полу, разгоняются к центру арены, где стоит игрок.
// Скорость не задаётся жёстко, а меняется не больше чем на ENEMY_ACCELERATION × delta за кадр:
// иначе любой толчок от удара гасился бы в следующем же кадре. Враг в воздухе не управляется.
export const moveEnemies = (enemies: Enemies, delta: number): void => {
  for (const { body } of enemies.values()) {
    const position = body.translation();
    const isOnFloor = position.y < ON_FLOOR_HEIGHT;
    const distance = Math.hypot(position.x, position.z);

    // В самом центре стоит игрок, враг туда не попадёт, но делить на ноль всё равно не будем.
    if (!isOnFloor || distance === 0) {
      continue;
    }

    // Желаемая скорость — к центру, (-x, -z), длиной ENEMY_SPEED. Разница с текущей скоростью по полу —
    // сколько нужно добавить. Если это больше, чем разрешает ускорение, добавляем только часть.
    const velocity = body.linvel();
    const changeX = (-position.x / distance) * ENEMY_SPEED - velocity.x;
    const changeZ = (-position.z / distance) * ENEMY_SPEED - velocity.z;
    const change = Math.hypot(changeX, changeZ);
    const maxChange = ENEMY_ACCELERATION * delta;
    const fraction = change > maxChange ? maxChange / change : 1;

    // Вертикальную скорость не трогаем — ей управляет гравитация.
    // true «будит» тело: Rapier усыпляет неподвижные тела, и спящее не сдвинется даже со скоростью.
    body.setLinvel({ x: velocity.x + changeX * fraction, y: velocity.y, z: velocity.z + changeZ * fraction }, true);
  }
};

// Поворачиваем полоски здоровья всех врагов к камере.
export const turnHpBarsToCamera = (enemies: Enemies, camera: THREE.Camera): void => {
  for (const { hpBar } of enemies.values()) {
    turnToCamera(hpBar, camera);
  }
};
