import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ENEMY_GROUPS } from './collision-groups';
import {
  ENEMY_ACCELERATION,
  ENEMY_ANGULAR_DAMPING,
  ENEMY_FRICTION,
  ENEMY_KINDS,
  ENEMY_LINEAR_DAMPING,
  ENEMY_RESTITUTION,
  ENEMY_SPEED,
  HP_BAR_GAP,
  type EnemyKind,
  type EnemyKindName,
} from './config';
import type { CubeEntity, Entities, EntityContext } from './entity';
import { createHpBar, setHpBarValue, turnToCamera, type HpBar } from './hp-bar';
import type { Point } from './patterns';

// Враг — куб, который вращается вместе с телом (см. CubeEntity), плюс его тип (размер, масса,
// здоровье, цвет — см. ENEMY_KINDS в config.ts), текущее здоровье и полоска здоровья.
export type Enemy = CubeEntity & {
  kind: EnemyKind;
  hp: number;
  hpBar: HpBar;
};

export type Enemies = Entities<Enemy>;

// Проверка «это строка — имя типа врага?». Возвращает boolean, а запись `name is EnemyKindName`
// сообщает TypeScript: если проверка прошла, дальше name — именно EnemyKindName.
const isEnemyKindName = (name: string): name is EnemyKindName => name in ENEMY_KINDS;

// Имена всех типов врагов. Object.keys возвращает просто строки, фильтр с проверкой выше
// превращает их в список имён типов, понятный TypeScript.
export const ENEMY_KIND_NAMES = Object.keys(ENEMY_KINDS).filter(isEnemyKindName);

// Геометрия и материал — общие для всех врагов одного типа: незачем создавать новые для каждого,
// Three.js умеет рисовать много мешей с одной геометрией и одним материалом.
// Создаём их один раз на каждый тип и храним по имени типа.
const KIND_LOOKS = Object.fromEntries(
  ENEMY_KIND_NAMES.map((name) => {
    const { size, color } = ENEMY_KINDS[name];

    return [
      name,
      { geometry: new THREE.BoxGeometry(size, size, size), material: new THREE.MeshLambertMaterial({ color }) },
    ];
  }),
);

// Враг стоит на полу, а не летит, если его центр ниже этой доли его размера. Куб, лежащий на грани,
// держит центр на высоте половины стороны, а застывший на ребре или вершине — до ~0.87 стороны.
// Чуть выше — уже полёт.
const ON_FLOOR_HEIGHT_FRACTION = 0.9;

// Создаёт врага типа kindName в точке point на полу. Где и какого типа — решает описание волны
// (src/waves.ts, src/patterns.ts).
export const spawnEnemy = ({
  world,
  scene,
  entities,
  point,
  kindName,
}: EntityContext<Enemy> & { point: Point; kindName: EnemyKindName }): void => {
  const { x, z } = point;
  const kind = ENEMY_KINDS[kindName];
  const { size, mass, hp } = kind;

  // dynamic — тело, которым управляет физика: оно падает, отлетает от ударов, кувыркается
  // и толкает других врагов. Затухание гасит полёт и вращение, как сопротивление воздуха.
  // CCD (непрерывное определение столкновений) не даёт быстро летящему врагу проскочить сквозь пол
  // между двумя шагами симуляции.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, size / 2, z)
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
    RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
      .setMass(mass)
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
  const { geometry, material } = KIND_LOOKS[kindName];
  const cube = new THREE.Mesh(geometry, material);
  const hpBar = createHpBar();
  hpBar.group.position.y = size / 2 + HP_BAR_GAP;

  const object = new THREE.Group();
  object.add(cube, hpBar.group);
  object.position.copy(body.translation());
  scene.add(object);

  entities.set(collider.handle, { body, object, cube, kind, hp, hpBar });
};

// Отнимает здоровье и обновляет полоску. Что делать с погибшим (hp <= 0) — решает вызывающий код.
export const damageEnemy = (enemy: Enemy, damage: number): void => {
  enemy.hp -= damage;
  setHpBarValue(enemy.hpBar, enemy.hp / enemy.kind.hp);
};

// Каждый кадр враги, стоящие на полу, разгоняются к центру арены, где стоит игрок.
// Скорость не задаётся жёстко, а меняется не больше чем на ENEMY_ACCELERATION × delta за кадр:
// иначе любой толчок от удара гасился бы в следующем же кадре. Враг в воздухе не управляется.
export const moveEnemies = (enemies: Enemies, delta: number): void => {
  for (const { body, kind } of enemies.values()) {
    const position = body.translation();
    const isOnFloor = position.y < kind.size * ON_FLOOR_HEIGHT_FRACTION;
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
