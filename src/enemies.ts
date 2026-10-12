import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ENEMY_GROUPS } from './collision-groups';
import { config, type EnemyKind, type EnemyKindName } from './config';
import type { CubeEntity, Entities, EntityContext } from './entity';
import { createHpBar, setHpBarValue, turnToCamera, type HpBar } from './hp-bar';

// Враг — куб, который вращается вместе с телом (см. CubeEntity), плюс его тип (размер, масса,
// здоровье, цвет — см. ENEMY_KINDS в config.ts), текущее здоровье и полоска здоровья.
// kind — копия типа на момент появления: правка типа в панели настроек касается только новых врагов.
export type Enemy = CubeEntity & {
  kind: EnemyKind;
  hp: number;
  hpBar: HpBar;
};

export type Enemies = Entities<Enemy>;

// Проверка «это строка — имя типа врага?». Возвращает boolean, а запись `name is EnemyKindName`
// сообщает TypeScript: если проверка прошла, дальше name — именно EnemyKindName.
const isEnemyKindName = (name: string): name is EnemyKindName => name in config.ENEMY_KINDS;

// Имена всех типов врагов. Object.keys возвращает просто строки, фильтр с проверкой выше
// превращает их в список имён типов, понятный TypeScript.
export const ENEMY_KIND_NAMES = Object.keys(config.ENEMY_KINDS).filter(isEnemyKindName);

// Геометрия — одна на всех врагов: куб со стороной 1, а нужный размер задаётся масштабом меша (scale).
// Так размер типа можно менять в панели настроек, не пересоздавая геометрию.
// Three.js умеет рисовать много мешей с одной геометрией.
const ENEMY_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);

// Материал — общий для всех врагов одного типа. Создаём по одному на тип и храним по имени типа;
// цвет можно поменять на ходу (refreshEnemyColors).
const KIND_MATERIALS = Object.fromEntries(
  ENEMY_KIND_NAMES.map((name) => [name, new THREE.MeshLambertMaterial({ color: config.ENEMY_KINDS[name].color })]),
);

// Враг стоит на полу, а не летит, если его центр ниже этой доли его размера. Куб, лежащий на грани,
// держит центр на высоте половины стороны, а застывший на ребре или вершине — до ~0.87 стороны.
// Чуть выше — уже полёт.
const ON_FLOOR_HEIGHT_FRACTION = 0.9;

// Проверка «центр врага над площадью арены (не дальше края по X и Z)?». Враг, перевалившийся центром
// за край, обречён: управления над пустотой у него нет, а пули толкают его только дальше от куба.
export const isEnemyOverArena = ({ body }: Pick<Enemy, 'body'>): boolean => {
  const { x, z } = body.translation();
  const halfArena = config.ARENA_SIZE / 2;

  return Math.abs(x) <= halfArena && Math.abs(z) <= halfArena;
};

// Насколько ниже нижней грани врага ещё может лежать опора — с таким зазором «стоящий на ярусе»
// кучи враг считается опирающимся. Кубы лежат друг на друге вплотную, зазор нужен только
// на дрожание контакта.
const SUPPORT_GAP = 0.1;

// Проверка «под врагом есть опора — пол или крыша другого врага?». Враг с опорой управляется
// (moveEnemies) и не падает (упреждение прицела не добавляет ему падения под гравитацией).
// Враг на вершине кучи — не «летун»: он ползёт к центру и сползает с кучи, а не лежит статуей.
// Дешёвый случай — враг низко (пол или нижний ярус); выше — луч вниз от центра.
// filterGroups = ENEMY_GROUPS — луч видит только то, с чем враг физически сталкивается
// (пол, врагов, игрока, снаряды), призраков не видит. Собственное тело исключено — иначе луч
// упёрся бы в самого врага, в котором начался.
export const isEnemySupported = (world: RAPIER.World, enemy: Pick<Enemy, 'body' | 'kind'>): boolean => {
  if (!isEnemyOverArena(enemy)) {
    return false;
  }

  const { x, y, z } = enemy.body.translation();
  const { size } = enemy.kind;

  // Враг низко — это пол или нижний ярус кучи: дешёвая проверка по высоте, без запроса к миру.
  if (y >= 0 && y < size * ON_FLOOR_HEIGHT_FRACTION) {
    return true;
  }

  // Под полом враг — сорвался с края арены: опоры нет.
  if (y < 0) {
    return false;
  }

  const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });

  return world.castRay(ray, size / 2 + SUPPORT_GAP, true, undefined, ENEMY_GROUPS, undefined, enemy.body) !== null;
};

// Проверка «враг выше потолка смерти?» — центр поднялся выше config.DEATH_CEILING_HEIGHT.
export const isEnemyAboveCeiling = ({ body }: Pick<Enemy, 'body'>): boolean =>
  body.translation().y > config.DEATH_CEILING_HEIGHT;

// Проверка «враг ниже пола?» — центр ниже верхней поверхности пола (y = 0). На полу так не бывает:
// пол твёрдый, и центр стоящего врага не ниже половины его роста. Значит, враг сорвался с края арены.
export const isEnemyBelowFloor = ({ body }: Pick<Enemy, 'body'>): boolean => body.translation().y < 0;

// Создаёт врага типа kindName с центром в position. Где и какого типа — решает описание волны
// (src/waves.ts, src/patterns.ts), а высоту — поиск свободного места (src/spawn-placement.ts):
// обычно враг стоит на полу (центр на половине роста), но в тесноте может появиться ярусом выше и упасть.
export const spawnEnemy = ({
  world,
  scene,
  entities,
  position,
  kindName,
}: EntityContext<Enemy> & { position: THREE.Vector3Like; kindName: EnemyKindName }): void => {
  const { x, y, z } = position;
  const kind = { ...config.ENEMY_KINDS[kindName] };
  const { size, mass, hp } = kind;

  // dynamic — тело, которым управляет физика: оно падает, отлетает от ударов, кувыркается
  // и толкает других врагов. Затухание гасит полёт и вращение, как сопротивление воздуха.
  // CCD (непрерывное определение столкновений) не даёт быстро летящему врагу проскочить сквозь пол
  // между двумя шагами симуляции.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(config.ENEMY_LINEAR_DAMPING)
      .setAngularDamping(config.ENEMY_ANGULAR_DAMPING)
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
      .setFriction(config.ENEMY_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(config.ENEMY_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(ENEMY_GROUPS),
    body,
  );

  // Видимый враг — группа, которая только двигается вместе с телом. Внутри неё:
  // куб — вращается вместе с телом (кувыркается);
  // полоска здоровья — не вращается и висит над центром врага, на полстороны куба плюс зазор выше.
  const cube = new THREE.Mesh(ENEMY_GEOMETRY, KIND_MATERIALS[kindName]);
  cube.scale.setScalar(size);

  const hpBar = createHpBar();
  hpBar.group.position.y = size / 2 + config.HP_BAR_GAP;

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

// Каждый кадр враги с опорой под ногами (полом или ярусом кучи — см. isEnemySupported)
// разгоняются к центру арены, где стоит игрок. Враг на вершине кучи тоже управляем: он ползёт
// по куче к центру и сползает с неё, вместо того чтобы лежать статуей и давить на нижних.
// Скорость раскладывается на две ортогональные составляющие:
//   радиальная — прямо к центру: подгоняется к config.ENEMY_SPEED не быстрее, чем позволяет
//     config.ENEMY_ACCELERATION × delta;
//   касательная — вдоль кольца вокруг центра (то, что задают удары пули и соседи): НЕ трогается,
//     только мягко гасится экспоненциально с config.ENEMY_TANGENTIAL_DAMPING.
// Так сделано специально отдельно: раньше обе составляющие загонялись в «чистый радиальный ход»
// общим бюджетом ускорения — кольцо врагов теряло возможность скольжения друг мимо друга и
// замыкалось в неподвижной стопке (расстрел такой кучи был расстрелом статуи).
// Скорость не задаётся жёстко, а меняется постепенно — иначе любой толчок от удара гасился бы
// в следующем же кадре. Враг в воздухе не управляется.
export const moveEnemies = (world: RAPIER.World, enemies: Enemies, delta: number): void => {
  for (const enemy of enemies.values()) {
    const { body } = enemy;
    const position = body.translation();
    const isSupported = isEnemySupported(world, enemy);
    const distance = Math.hypot(position.x, position.z);

    // В самом центре стоит игрок, враг туда не попадёт, но делить на ноль всё равно не будем.
    if (!isSupported || distance === 0) {
      continue;
    }

    const velocity = body.linvel();

    // Единичные векторы раскладки: радиальный — от врага к центру; касательный — поворот
    // радиального на 90° ((x, z) → (−z, x)). Оба лежат в горизонтальной плоскости и ортогональны.
    const radialX = -position.x / distance;
    const radialZ = -position.z / distance;
    const tangentialX = -radialZ;
    const tangentialZ = radialX;

    // Текущая горизонтальная скорость, разложенная по этим направлениям (скалярные произведения).
    const radialSpeed = velocity.x * radialX + velocity.z * radialZ;
    const tangentialSpeed = velocity.x * tangentialX + velocity.z * tangentialZ;

    // Радиальная составляющая: сколько добавить, чтобы идти к центру с config.ENEMY_SPEED,
    // но не больше, чем разрешает ускорение за кадр.
    // Пол каждый шаг снимает со скользящего врага до ENEMY_FRICTION × GRAVITY скорости. Когда враг
    // стоит или уже движется в сторону разгона, трение мешает — его компенсируем, иначе при
    // ускорении ниже ~5.9 м/с² враг не сдвинулся бы с места. Когда враг скользит против
    // (откат после удара), трение само помогает погасить скорость — компенсация удвоила бы торможение.
    const radialChange = config.ENEMY_SPEED - radialSpeed;
    const isFrictionOpposing = radialChange * radialSpeed >= 0;
    const frictionCompensation = isFrictionOpposing ? config.ENEMY_FRICTION * config.GRAVITY : 0;
    const maxChange = (config.ENEMY_ACCELERATION + frictionCompensation) * delta;
    const clampedRadialChange = Math.abs(radialChange) > maxChange ? Math.sign(radialChange) * maxChange : radialChange;
    const newRadialSpeed = radialSpeed + clampedRadialChange;

    // Касательная составляющая: показательное затухание — за секунду скорость теряет долю
    // ENEMY_TANGENTIAL_DAMPING. Math.max(0, …) — при редком кадре (большой delta) множитель
    // не должен уйти в минус и развернуть скорость вспять.
    const newTangentialSpeed = tangentialSpeed * Math.max(0, 1 - config.ENEMY_TANGENTIAL_DAMPING * delta);

    // Собираем горизонтальную скорость обратно из двух составляющих.
    // Вертикальную не трогаем — ей управляет гравитация.
    // true «будит» тело: Rapier усыпляет неподвижные тела, и спящее не сдвинется даже со скоростью.
    body.setLinvel(
      {
        x: radialX * newRadialSpeed + tangentialX * newTangentialSpeed,
        y: velocity.y,
        z: radialZ * newRadialSpeed + tangentialZ * newTangentialSpeed,
      },
      true,
    );
  }
};

// Поворачиваем полоски здоровья всех врагов к камере.
export const turnHpBarsToCamera = (enemies: Enemies, camera: THREE.Camera): void => {
  for (const { hpBar } of enemies.values()) {
    turnToCamera(hpBar, camera);
  }
};

// Перекрашивает врагов каждого типа по текущему конфигу — вызывается, когда цвета меняют в панели настроек.
// Материал общий на тип, поэтому меняется цвет и у новых, и у уже живых врагов.
export const refreshEnemyColors = (): void => {
  for (const name of ENEMY_KIND_NAMES) {
    KIND_MATERIALS[name].color.set(config.ENEMY_KINDS[name].color);
  }
};
