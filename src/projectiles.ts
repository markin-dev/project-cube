import RAPIER, { type ColliderHandle, type PhysicsHooks, type World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PROJECTILE_GROUPS } from './collision-groups';
import { config, MIN_FIRE_INTERVAL } from './config';
import { isEnemySupported, type Enemies, type Enemy } from './enemies';
import { removeEntity, type Entities, type Entity, type EntityContext } from './entity';
import type { GlowSource } from './lighting';

// Снаряд помнит, в какого врага его выпустили, — чтобы не стрелять во врага,
// которого уже добьют летящие в него снаряды (см. findTargets), и свой урон — он бросается
// при выстреле, и пока снаряд в пути, «урон в пути» складывается из фактических значений.
export type Projectile = Entity & {
  targetHandle: ColliderHandle;
  damage: number;

  // Критический ли это снаряд. Крит, как и урон, бросается один раз при выстреле и тянется
  // до попадания: искры, цифра урона и физика читают его из снаряда (applyHit в game.ts), а не делают
  // новый бросок — иначе урон в пути (getIncomingDamage) перестал бы быть точной суммой.
  isCrit: boolean;

  // Сколько отскоков у снаряда ещё осталось (см. PROJECTILE_BOUNCES и bounceProjectile).
  bouncesLeft: number;

  // Враг, в которого снаряд попал последним: сквозь него снаряд пролетает (см. createProjectileHooks),
  // иначе отскок во врага за его спиной упёрся бы в него же. До первого попадания — нет.
  passThroughHandle?: ColliderHandle;
};

export type Projectiles = Entities<Projectile>;

// Цель выстрела: враг и handle его коллайдера (handle запоминаем в снаряде).
export type Target = {
  handle: ColliderHandle;
  enemy: Enemy;
};

// Геометрия — куб со стороной 1, размер пули задаётся масштабом меша: так PROJECTILE_SIZE из панели
// настроек применяется к новым пулям без пересоздания геометрии. Материал общий — цвет и свечение
// (emissive) меняются на ходу (см. refreshProjectileColor). Свечение задано и при создании: refreshProjectileColor
// зовётся только при правках панели, а первые пули должны светиться с самого начала игры.
const PROJECTILE_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const PROJECTILE_MATERIAL = new THREE.MeshLambertMaterial({
  color: config.PROJECTILE_COLOR,
  emissive: config.PROJECTILE_COLOR,
  emissiveIntensity: config.PROJECTILE_GLOW,
});

// Отдельный общий материал для критических снарядов: крит-пуля того же цвета, что и крит-искры
// (SPARKS_CRIT_COLOR), — так вылет и попадание крита выглядят одним цветом. Цвет перекрашивается
// из панели в refreshProjectileColor (его зовёт applyLiveConfig при любой правке цветов).
const CRIT_PROJECTILE_MATERIAL = new THREE.MeshLambertMaterial({
  color: config.SPARKS_CRIT_COLOR,
  emissive: config.SPARKS_CRIT_COLOR,
  emissiveIntensity: config.PROJECTILE_GLOW,
});

// Оба материала пули — чтобы обновить цвет и свечение одним вызовом (см. refreshProjectileColor).
const PROJECTILE_MATERIALS = [PROJECTILE_MATERIAL, CRIT_PROJECTILE_MATERIAL];

// Видимый меш снаряда: сторона — PROJECTILE_SIZE, у крита — увеличенная в CRIT_PROJECTILE_SIZE_MULTIPLIER
// раз (только меш: физический коллайдер считается от PROJECTILE_SIZE и не меняется, чтобы не править баланс).
// Цвет и свечение — общие материалы (refreshProjectileColor), castShadow — тень (см. scene.ts).
// Экспортируется для демо-сцены (src/demo-scene.ts): там стоят обычный и крит-снаряд.
export const createProjectileMesh = (isCrit: boolean): THREE.Mesh => {
  const size = config.PROJECTILE_SIZE * (isCrit ? config.CRIT_PROJECTILE_SIZE_MULTIPLIER : 1);
  const mesh = new THREE.Mesh(PROJECTILE_GEOMETRY, isCrit ? CRIT_PROJECTILE_MATERIAL : PROJECTILE_MATERIAL);

  mesh.scale.setScalar(size);
  mesh.castShadow = true;

  return mesh;
};

// Квадрат расстояния от объекта до центра арены по полу.
// Для сравнения «кто ближе» корень не нужен: от него порядок не меняется, а считать дешевле.
const getDistanceToCenterSquared = (entity: Entity): number => {
  const { x, z } = entity.body.translation();

  return x * x + z * z;
};

// Урон, который уже летит в каждого врага: handle врага → сумма уронов выпущенных в него снарядов.
// Урон каждого снаряда бросается при выстреле (см. rollDamage), поэтому сумма точная.
// Один проход по снарядам на весь выбор целей, а не отдельный проход для каждого врага.
const getIncomingDamageByTarget = (projectiles: Projectiles): Map<ColliderHandle, number> =>
  [...projectiles.values()].reduce(
    (incoming, { targetHandle, damage }) => incoming.set(targetHandle, (incoming.get(targetHandle) ?? 0) + damage),
    new Map<ColliderHandle, number>(),
  );

// Урон снаряда: случайное целое из [PROJECTILE_DAMAGE_MIN, PROJECTILE_DAMAGE_MAX].
// Границы упорядочиваем на месте — если перепутать их в панели, диапазон всё равно будет
// от меньшего к большему, а не уйдёт в отрицательные числа. Равные значения — урон без рандома.
// Экспортируются для юнит-тестов (unit/crit-damage.test.ts).
export const rollDamage = (): number => {
  const low = Math.min(config.PROJECTILE_DAMAGE_MIN, config.PROJECTILE_DAMAGE_MAX);
  const high = Math.max(config.PROJECTILE_DAMAGE_MIN, config.PROJECTILE_DAMAGE_MAX);

  return Math.floor(low + Math.random() * (high - low + 1));
};

// Бросок критического попадания: снаряд критический с вероятностью CRIT_CHANCE.
// Один раз при выстреле (вместе с уроном) — результат запоминается в снаряде (см. Projectile).
// Экспортируется для юнит-тестов.
export const isCritRolled = (): boolean => Math.random() < config.CRIT_CHANCE;

// Итоговый урон снаряда: если крит — брошенный урон, увеличенный в CRIT_MULTIPLIER раз.
// Округляем до целого, потому что здоровье врагов — целые числа (hp).
// Экспортируется для юнит-тестов.
export const applyCritToDamage = (damage: number, isCrit: boolean): number =>
  isCrit ? Math.round(damage * config.CRIT_MULTIPLIER) : damage;

// Выбирает до count целей: ближайших к игроку врагов из тех, кого летящие снаряды ещё не добьют.
// Без этой проверки куб тратил бы снаряды впустую: снаряд летит до врага больше полсекунды,
// и пока добивающий снаряд в пути, куб успел бы выпустить в того же врага ещё 2–3 лишних.
// Пустой список — стрелять не в кого: врагов нет или все уже «получат своё».
export const findTargets = ({
  enemies,
  projectiles,
  count,
}: {
  enemies: Enemies;
  projectiles: Projectiles;
  count: number;
}): Target[] => {
  const incomingDamage = getIncomingDamageByTarget(projectiles);

  // Расстояние — один раз на врага: в сравнениях сортировки его пришлось бы читать из физики заново.
  return [...enemies]
    .filter(([handle, enemy]) => enemy.hp > (incomingDamage.get(handle) ?? 0))
    .map(([handle, enemy]) => ({ target: { handle, enemy }, distance: getDistanceToCenterSquared(enemy) }))
    .sort((first, second) => first.distance - second.distance)
    .slice(0, count)
    .map(({ target }) => target);
};

// ─── ПРИЦЕЛ ──────────────────────────────────────────────────────────────────

const UP = new THREE.Vector3(0, 1, 0);

// Куда и в кого целимся: физический мир (для проверки опоры), враг и точка вылета пули.
type AimParams = {
  world: World;
  enemy: Pick<Enemy, 'body' | 'kind'>;
  muzzle: THREE.Vector3;
};

// Где окажется враг к моменту, когда до него долетит пуля, — для упреждения.
// Учитываем только смещение ПОПЕРЁК линии выстрела: вбок и вверх-вниз, включая падение под гравитацией,
// если под врагом нет опоры (путь падения за время t — g·t²/2). Враг на вершине кучи опирается на соседа
// и не падает — без этой проверки прогноз опускал бы его на пол, и пули доставались бы нижнему.
// Движение вдоль линии выстрела упреждать не нужно: враг, бегущий к кубу или отлетающий от него,
// всё равно остаётся на пути пули. А скорость вдоль линии как раз сильнее всего дёргается от попаданий:
// сразу после удара враг летит назад, но тут же снова идёт к кубу, и упреждение по ней только уводило бы
// пули ему за спину.
// Ниже пола прогноз не опускаем: центр врага не может быть ниже половины его размера.
// Экспортируется для юнит-тестов (unit/projectile-motion.test.ts).
export const predictPosition = ({ world, enemy, muzzle }: AimParams): THREE.Vector3 => {
  const position = new THREE.Vector3().copy(enemy.body.translation());
  const lineOfFire = position.clone().sub(muzzle);

  // Время полёта пули до врага. По пути враг сместится немного, и на время полёта это почти не влияет.
  const flightTime = (lineOfFire.length() / config.PROJECTILE_SPEED) * config.PROJECTILE_LEAD;

  lineOfFire.normalize();

  const drift = new THREE.Vector3().copy(enemy.body.linvel()).multiplyScalar(flightTime);

  if (!isEnemySupported(world, enemy)) {
    drift.y -= (config.GRAVITY * flightTime * flightTime) / 2;
  }

  // Убираем из смещения составляющую вдоль линии выстрела (её проекцию на эту линию).
  drift.addScaledVector(lineOfFire, -drift.dot(lineOfFire));
  position.add(drift);
  position.y = Math.max(position.y, enemy.kind.size / 2);

  return position;
};

// Точка прицела: прогноз центра врага плюс смещение поперёк выстрела — постоянно вверх
// и случайно по кругу вокруг этой точки (см. PROJECTILE_AIM_OFFSET_UP и PROJECTILE_AIM_SPREAD в config.ts).
const getAimPoint = ({ world, enemy, muzzle }: AimParams): THREE.Vector3 => {
  const center = predictPosition({ world, enemy, muzzle });
  const direction = center.clone().sub(muzzle).normalize();

  // Два направления поперёк выстрела: «вбок» — перпендикуляр к выстрелу и к вертикали,
  // и «вверх» — перпендикуляр к выстрелу и к «вбок» (для горизонтального выстрела — обычный верх).
  // Если враг ровно над игроком, «вбок» не определено — берём любое горизонтальное направление.
  const side = new THREE.Vector3().crossVectors(direction, UP);

  if (side.lengthSq() === 0) {
    side.set(1, 0, 0);
  }

  side.normalize();

  const up = new THREE.Vector3().crossVectors(side, direction).normalize();
  const halfSize = enemy.kind.size / 2;

  // Случайная точка в круге: случайный угол и расстояние. Корень из случайного числа нужен,
  // чтобы точки ложились по кругу равномерно, а не скучивались у центра.
  const spreadAngle = Math.random() * Math.PI * 2;
  const spreadDistance = Math.sqrt(Math.random()) * config.PROJECTILE_AIM_SPREAD * halfSize;

  return center
    .addScaledVector(up, config.PROJECTILE_AIM_OFFSET_UP * halfSize)
    .addScaledVector(side, Math.cos(spreadAngle) * spreadDistance)
    .addScaledVector(up, Math.sin(spreadAngle) * spreadDistance);
};

// ─── ВЫСТРЕЛ ─────────────────────────────────────────────────────────────────

// Обратный отсчёт до залпа за один шаг симуляции; возвращает новое значение отсчёта.
// Остаток переносится: залп, запоздавший на долю шага, сдвигает следующий на столько же раньше,
// поэтому темп не зависит от длины шага — частоты кадров и скорости игры. Пауза короче шага —
// несколько залпов за шаг. fireVolley возвращает, сколько снарядов выпущено; 0 — стрелять не в кого:
// тогда отсчёт замирает на нуле, и залп случится, как только цель появится, — без накопленной очереди.
export const runFireTimer = ({
  timer,
  delta,
  fireVolley,
}: {
  timer: number;
  delta: number;
  fireVolley: () => number;
}): number => {
  const interval = Math.max(config.FIRE_INTERVAL, MIN_FIRE_INTERVAL);

  const fireDueVolleys = (left: number): number => {
    if (left > 0) {
      return left;
    }

    return fireVolley() > 0 ? fireDueVolleys(left + interval) : 0;
  };

  return fireDueVolleys(timer - delta);
};

// Выпускает один снаряд из центра куба-игрока в точку прицела (getAimPoint) — по прямой,
// в любую сторону, хоть вверх, если враг подлетел. Точка прицела своя у каждого снаряда.
const fireOneProjectile = ({
  world,
  scene,
  entities,
  target,
}: EntityContext<Projectile> & { target: Target }): void => {
  const muzzle = new THREE.Vector3(0, config.PLAYER_SIZE / 2, 0);
  const direction = getAimPoint({ world, enemy: target.enemy, muzzle }).sub(muzzle);
  const size = config.PROJECTILE_SIZE;

  // Крит и урон бросаются один раз при выстреле (см. Projectile.isCrit).
  const isCrit = isCritRolled();
  const damage = applyCritToDamage(rollDamage(), isCrit);

  if (direction.lengthSq() === 0) {
    return;
  }

  const velocity = direction.normalize().multiplyScalar(config.PROJECTILE_SPEED);

  // Скорость задаём один раз при выстреле. setGravityScale(0) — гравитация на пулю не действует:
  // она летит по прямой, как очень быстрая пуля, у которой падение на таком расстоянии незаметно.
  // CCD (непрерывное определение столкновений) — пуля маленькая и быстрая: без него за один шаг
  // симуляции она успела бы глубоко влезть во врага, и физика выталкивала бы её с лишней силой.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(muzzle.x, muzzle.y, muzzle.z)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setGravityScale(0)
      .setCcdEnabled(true),
  );

  // Пуля — твёрдое тело с массой: врезаясь во врага, она толкает его, как настоящая.
  // Сколько импульса передать, в какую сторону и с каким вращением — считает физический движок
  // по массам, скорости и точке контакта. После попадания пулю удаляем (см. applyHit в game.ts).
  // Группа столкновений пули — только враги: сквозь игрока, пол, другие пули и призраков она пролетает.
  // ActiveEvents.COLLISION_EVENTS — сообщать о столкновениях: так мы узнаём о попадании.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
      // Крит-пуля тяжелее в CRIT_MASS_MULTIPLIER раз: при той же скорости она передаёт врагу
      // больший импульс «масса × скорость», и движок сам сильнее его отбрасывает/раскачивает.
      .setMass(isCrit ? config.PROJECTILE_MASS * config.CRIT_MASS_MULTIPLIER : config.PROJECTILE_MASS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      // FILTER_CONTACT_PAIRS — перед расчётом каждого контакта снаряда Rapier спрашивает хук
      // filterContactPair (см. createProjectileHooks): так отскочивший снаряд пролетает сквозь врага,
      // в которого только что попал.
      .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS)
      .setCollisionGroups(PROJECTILE_GROUPS),
    body,
  );

  // Пуля отбрасывает тень на пол и врагов (см. scene.ts): она мала, но тень под ней читается
  // как след от выстрела.
  const mesh = createProjectileMesh(isCrit);

  mesh.position.copy(body.translation());
  scene.add(mesh);
  // Отскоки, как урон и крит, снаряд несёт с собой с момента выстрела.
  const bouncesLeft = Math.max(0, Math.floor(config.PROJECTILE_BOUNCES));

  entities.set(collider.handle, { body, object: mesh, targetHandle: target.handle, damage, isCrit, bouncesLeft });
};

// Выпускает залп: по одному снаряду на каждую цель из targets (см. findTargets) — снаряды летят
// в РАЗНЫХ врагов. Целей меньше, чем config.PROJECTILE_COUNT, — залп состоит ровно из стольких
// снарядов, сколько целей: по одному на каждого противника, в пустоту не стреляем.
// Каждый снаряд целится в свою случайную точку прицела своего врага (см. getAimPoint).
export const fireProjectiles = ({
  world,
  scene,
  entities,
  targets,
}: EntityContext<Projectile> & { targets: Target[] }): void => {
  for (const target of targets) {
    fireOneProjectile({ world, scene, entities, target });
  }
};

// ─── ОТСКОК ──────────────────────────────────────────────────────────────────

// Квадрат расстояния от врага до точки — для сравнения «кто ближе» корень не нужен.
const getDistanceSquared = (entity: Entity, point: THREE.Vector3Like): number => {
  const { x, y, z } = entity.body.translation();

  return (x - point.x) ** 2 + (y - point.y) ** 2 + (z - point.z) ** 2;
};

// Куда отскочить: ближайший к точке from враг, кроме excludedHandle (того, в кого снаряд только что попал).
// Дальность не ограничена. Врагов, которых уже добьют летящие снаряды, не пропускаем: отскок — в самого
// ближнего. Никого, кроме исключённого, нет — undefined.
export const findBounceTarget = ({
  enemies,
  from,
  excludedHandle,
}: {
  enemies: Enemies;
  from: THREE.Vector3Like;
  excludedHandle: ColliderHandle;
}): Target | undefined =>
  [...enemies]
    .filter(([handle]) => handle !== excludedHandle)
    .map(([handle, enemy]) => ({ target: { handle, enemy }, distance: getDistanceSquared(enemy, from) }))
    .sort((first, second) => first.distance - second.distance)[0]?.target;

// Отскок после попадания во врага hitHandle: если отскоки остались и есть в кого, снаряд летит из точки
// удара в нового врага — с той же скоростью, в точку прицела (getAimPoint: упреждение, смещение вверх,
// разброс), сквозь только что задетого. Урон, крит и масса прежние. Цель меняется — прицел куба
// учитывает урон этого снаряда как летящий в нового врага (см. findTargets).
// Возвращает true, если снаряд отскочил; false — снаряд пора убрать (вызывающий код удаляет его сам).
// Зовётся после шага физики, вне обхода событий столкновений, — менять тело здесь безопасно.
export const bounceProjectile = ({
  world,
  projectile,
  hitHandle,
  enemies,
}: {
  world: World;
  projectile: Projectile;
  hitHandle: ColliderHandle;
  enemies: Enemies;
}): boolean => {
  if (projectile.bouncesLeft <= 0) {
    return false;
  }

  const muzzle = new THREE.Vector3().copy(projectile.body.translation());
  const target = findBounceTarget({ enemies, from: muzzle, excludedHandle: hitHandle });

  if (!target) {
    return false;
  }

  const direction = getAimPoint({ world, enemy: target.enemy, muzzle }).sub(muzzle);

  if (direction.lengthSq() === 0) {
    return false;
  }

  // Физика уже отразила снаряд от врага и раскрутила его — задаём скорость заново, вращение гасим.
  const velocity = direction.normalize().multiplyScalar(config.PROJECTILE_SPEED);

  projectile.body.setLinvel(velocity, true);
  projectile.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  projectile.targetHandle = target.handle;
  projectile.passThroughHandle = hitHandle;
  projectile.bouncesLeft -= 1;

  return true;
};

// Хуки Rapier для шага физики (world.step(eventQueue, hooks)): перед расчётом контакта снаряда
// с врагом спрашиваем, не последний ли это задетый им враг. Если да — контакта нет совсем: ни толчка,
// ни события столкновения, снаряд пролетает насквозь. Остальные пары — обычный контакт с импульсом.
// Хук зовётся только для пар, где у кого-то стоит флаг FILTER_CONTACT_PAIRS, — это снаряды.
export const createProjectileHooks = (projectiles: Projectiles): PhysicsHooks => {
  const isPassThrough = (projectileHandle: ColliderHandle, otherHandle: ColliderHandle): boolean =>
    projectiles.get(projectileHandle)?.passThroughHandle === otherHandle;

  return {
    filterContactPair: (collider1: ColliderHandle, collider2: ColliderHandle): RAPIER.SolverFlags | null =>
      isPassThrough(collider1, collider2) || isPassThrough(collider2, collider1)
        ? null
        : RAPIER.SolverFlags.COMPUTE_IMPULSE,

    // Сенсоров у нас нет — этот хук не зовётся, но интерфейс его требует.
    filterIntersectionPair: (): boolean => true,
  };
};

// Удаляет промахнувшиеся пули — иначе они копились бы бесконечно, а куб считал бы их «летящими в цель»
// и не стрелял бы в этого врага. Промах — пуля отлетела от центра арены дальше ARENA_SIZE: это за краем
// арены в любую сторону, в том числе вверх, если стреляли в подброшенного врага.
export const removeFarProjectiles = ({ world, scene, entities }: EntityContext<Projectile>): void => {
  for (const [handle, { body }] of entities) {
    const { x, y, z } = body.translation();
    const isFar = Math.hypot(x, y, z) > config.ARENA_SIZE;

    if (isFar) {
      removeEntity({ world, scene, entities, handle });
    }
  }
};

// Перекрашивает пули и обновляет их свечение по текущему конфигу — вызывается, когда цвета меняют
// в панели настроек.
export const refreshProjectileColor = (): void => {
  PROJECTILE_MATERIAL.color.set(config.PROJECTILE_COLOR);

  // Крит-пули — тем же цветом, что крит-искры (SPARKS_CRIT_COLOR): правишь цвет искр в панели —
  // и крит-снаряды перекрашиваются вместе с ними (applyLiveConfig зовёт эту функцию при любом изменении).
  CRIT_PROJECTILE_MATERIAL.color.set(config.SPARKS_CRIT_COLOR);

  for (const material of PROJECTILE_MATERIALS) {
    // Свечение: emissive прибавляется к освещённому цвету и от света сцены не зависит — пуля светится
    // и в тени, и в темноте. Цвет свечения тот же, что у самой пули, а яркость — PROJECTILE_GLOW:
    // 0 — свечения нет, 1 — пуля светится в свою цветность, больше 1 — ярче белого, и по краю
    // расплывается ореол (bloom, см. post.ts).
    material.emissive.copy(material.color);
    material.emissiveIntensity = config.PROJECTILE_GLOW;
  }

  // Крит-пуля светится ярче в CRIT_PROJECTILE_GLOW_MULTIPLIER раз (множитель к PROJECTILE_GLOW):
  // крит должен выдаваться в потоке не только цветом и размером, но и более горящей сердцевиной.
  CRIT_PROJECTILE_MATERIAL.emissiveIntensity *= config.CRIT_PROJECTILE_GLOW_MULTIPLIER;
};

// Яркость летящей пули в пуле света. Она меньше, чем у свежей вспышки попадания (1): вспышка только
// что родилась и должна получить свет первой, а пуля горит ровно всё время полёта и получает то,
// что осталось в пуле.
const PROJECTILE_BRIGHTNESS = 0.6;

// Источники света от летящих снарядов — для пула света (setGlowLights в lighting.ts): где светить
// (текущая позиция центра пули), каким цветом (пуля или крит-пуля) и как ярко (см. выше).
export const getGlowSources = (projectiles: Projectiles): GlowSource[] =>
  [...projectiles.values()].map(
    ({ body, isCrit }): GlowSource => ({
      // translation() возвращает новый объект {x, y, z} — копировать не нужно.
      position: body.translation(),
      color: new THREE.Color(isCrit ? config.SPARKS_CRIT_COLOR : config.PROJECTILE_COLOR),
      brightness: PROJECTILE_BRIGHTNESS,
    }),
  );
