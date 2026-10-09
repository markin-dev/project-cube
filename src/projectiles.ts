import RAPIER, { type ColliderHandle } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PROJECTILE_GROUPS } from './collision-groups';
import { config } from './config';
import { isEnemyOnFloor, type Enemies, type Enemy } from './enemies';
import { removeEntity, type Entities, type Entity, type EntityContext } from './entity';

// Снаряд помнит, в какого врага его выпустили, — чтобы не стрелять во врага,
// которого уже добьют летящие в него снаряды (см. findTargets), и свой урон — он бросается
// при выстреле, и пока снаряд в пути, «урон в пути» складывается из фактических значений.
export type Projectile = Entity & {
  targetHandle: ColliderHandle;
  damage: number;
};

export type Projectiles = Entities<Projectile>;

// Цель выстрела: враг и handle его коллайдера (handle запоминаем в снаряде).
export type Target = {
  handle: ColliderHandle;
  enemy: Enemy;
};

// Геометрия — куб со стороной 1, размер пули задаётся масштабом меша: так PROJECTILE_SIZE из панели
// настроек применяется к новым пулям без пересоздания геометрии. Материал общий — цвет меняется на ходу.
const PROJECTILE_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const PROJECTILE_MATERIAL = new THREE.MeshLambertMaterial({ color: config.PROJECTILE_COLOR });

// Квадрат расстояния от объекта до центра арены по полу.
// Для сравнения «кто ближе» корень не нужен: от него порядок не меняется, а считать дешевле.
const getDistanceToCenterSquared = (entity: Entity): number => {
  const { x, z } = entity.body.translation();

  return x * x + z * z;
};

// Урон, который уже летит во врага: сумма уронов выпущенных в него снарядов, ещё не долетевших.
// Урон каждого снаряда бросается при выстреле (см. rollDamage), поэтому сумма точная —
// в отличие от оценки «количество × урон», которая при случайном уроне лишь приблизительна.
const getIncomingDamage = (projectiles: Projectiles, enemyHandle: ColliderHandle): number =>
  [...projectiles.values()]
    .filter(({ targetHandle }) => targetHandle === enemyHandle)
    .reduce((sum, { damage }) => sum + damage, 0);

// Урон снаряда: случайное целое из [PROJECTILE_DAMAGE_MIN, PROJECTILE_DAMAGE_MAX].
// Границы упорядочиваем на месте — если перепутать их в панели, диапазон всё равно будет
// от меньшего к большему, а не уйдёт в отрицательные числа. Равные значения — урон без рандома.
const rollDamage = (): number => {
  const low = Math.min(config.PROJECTILE_DAMAGE_MIN, config.PROJECTILE_DAMAGE_MAX);
  const high = Math.max(config.PROJECTILE_DAMAGE_MIN, config.PROJECTILE_DAMAGE_MAX);

  return Math.floor(low + Math.random() * (high - low + 1));
};

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
}): Target[] =>
  [...enemies]
    .filter(([handle, enemy]) => enemy.hp > getIncomingDamage(projectiles, handle))
    .map(([handle, enemy]) => ({ handle, enemy }))
    .sort((first, second) => getDistanceToCenterSquared(first.enemy) - getDistanceToCenterSquared(second.enemy))
    .slice(0, count);

// ─── ПРИЦЕЛ ──────────────────────────────────────────────────────────────────

const UP = new THREE.Vector3(0, 1, 0);

// Где окажется враг к моменту, когда до него долетит пуля, — для упреждения.
// Учитываем только смещение ПОПЕРЁК линии выстрела: вбок и вверх-вниз, включая падение под гравитацией,
// если враг в воздухе (путь падения за время t — g·t²/2). Движение вдоль линии выстрела упреждать
// не нужно: враг, бегущий к кубу или отлетающий от него, всё равно остаётся на пути пули. А скорость
// вдоль линии как раз сильнее всего дёргается от попаданий: сразу после удара враг летит назад, но тут же
// снова идёт к кубу, и упреждение по ней только уводило бы пули ему за спину.
// Ниже пола прогноз не опускаем: центр врага не может быть ниже половины его размера.
const predictPosition = (enemy: Enemy, muzzle: THREE.Vector3): THREE.Vector3 => {
  const position = new THREE.Vector3().copy(enemy.body.translation());
  const lineOfFire = position.clone().sub(muzzle);

  // Время полёта пули до врага. По пути враг сместится немного, и на время полёта это почти не влияет.
  const flightTime = (lineOfFire.length() / config.PROJECTILE_SPEED) * config.PROJECTILE_LEAD;

  lineOfFire.normalize();

  const drift = new THREE.Vector3().copy(enemy.body.linvel()).multiplyScalar(flightTime);

  if (!isEnemyOnFloor(enemy)) {
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
const getAimPoint = (enemy: Enemy, muzzle: THREE.Vector3): THREE.Vector3 => {
  const center = predictPosition(enemy, muzzle);
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

// Выпускает один снаряд из центра куба-игрока в точку прицела (getAimPoint) — по прямой,
// в любую сторону, хоть вверх, если враг подлетел. Точка прицела своя у каждого снаряда.
const fireOneProjectile = ({
  world,
  scene,
  entities,
  target,
}: EntityContext<Projectile> & { target: Target }): void => {
  const muzzle = new THREE.Vector3(0, config.PLAYER_SIZE / 2, 0);
  const direction = getAimPoint(target.enemy, muzzle).sub(muzzle);
  const size = config.PROJECTILE_SIZE;
  const damage = rollDamage();

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
  // по массам, скорости и точке контакта. После попадания пулю удаляем (см. applyHit в main.ts).
  // Группа столкновений пули — только враги: сквозь игрока, пол, другие пули и призраков она пролетает.
  // ActiveEvents.COLLISION_EVENTS — сообщать о столкновениях: так мы узнаём о попадании.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
      .setMass(config.PROJECTILE_MASS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(PROJECTILE_GROUPS),
    body,
  );

  const mesh = new THREE.Mesh(PROJECTILE_GEOMETRY, PROJECTILE_MATERIAL);
  mesh.scale.setScalar(size);
  mesh.position.copy(body.translation());
  scene.add(mesh);
  entities.set(collider.handle, { body, object: mesh, targetHandle: target.handle, damage });
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

// Перекрашивает пули по текущему конфигу — вызывается, когда цвет меняют в панели настроек.
export const refreshProjectileColor = (): void => {
  PROJECTILE_MATERIAL.color.set(config.PROJECTILE_COLOR);
};
