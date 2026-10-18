import RAPIER, { type ColliderHandle, type World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PLAYER_GROUPS } from './collision-groups';
import { config } from './config';

type PlayerParams = {
  world: World;
  scene: THREE.Scene;
};

// Игрок: handle его коллайдера (касание врагом — поражение) и видимый куб (его раздувает анимация
// повышения уровня, см. level-up.ts).
type Player = {
  handle: ColliderHandle;
  cube: THREE.Mesh;
};

// Материал игрока общий на модуль, чтобы его цвет можно было поменять из панели настроек (refreshPlayerColor).
const PLAYER_MATERIAL = new THREE.MeshLambertMaterial({ color: config.PLAYER_COLOR });

// Видимый куб игрока: сторона — PLAYER_SIZE, цвет — общий материал модуля (refreshPlayerColor).
// castShadow/receiveShadow — куб отбрасывает тень и принимает тени врагов (см. scene.ts).
// Экспортируется для демо-сцены (src/demo-scene.ts): там стоит такой же куб.
// Игрок создаётся один раз, поэтому PLAYER_SIZE из панели настроек применяется после перезагрузки страницы.
export const createPlayerCube = (): THREE.Mesh => {
  const size = config.PLAYER_SIZE;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), PLAYER_MATERIAL);

  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
};

// Создаёт игрока — неподвижный куб в центре арены.
// Возвращает handle его коллайдера (по нему в событиях столкновений узнаём, что враг добрался до игрока)
// и видимый куб.
export const createPlayer = ({ world, scene }: PlayerParams): Player => {
  const size = config.PLAYER_SIZE;

  // fixed — тело, которое никогда не двигается: ни от скорости, ни от толчков врагов.
  // Центр поднят на половину высоты, чтобы куб стоял на полу (y = 0), а не утопал в нём.
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, size / 2, 0));

  // cuboid принимает ПОЛОВИНЫ размеров.
  // ActiveEvents.COLLISION_EVENTS — просим Rapier сообщать о столкновениях с этим коллайдером.
  // Без этого флага касание врага прошло бы молча: у самих врагов флага нет.
  // Группа столкновений игрока — только живые враги (см. collision-groups.ts).
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(PLAYER_GROUPS),
    body,
  );

  // Видимый куб того же размера. Игрок не двигается, поэтому положение задаём один раз.
  const mesh = createPlayerCube();

  mesh.position.copy(body.translation());
  scene.add(mesh);

  return { handle: collider.handle, cube: mesh };
};

// Перекрашивает игрока по текущему конфигу — вызывается, когда цвет меняют в панели настроек.
export const refreshPlayerColor = (): void => {
  PLAYER_MATERIAL.color.set(config.PLAYER_COLOR);
};

// Свечение куба игрока (анимация повышения уровня, см. level-up.ts): emissive прибавляется к освещённому
// цвету и от света сцены не зависит; intensity больше 1 — ярче белого, вокруг ореол bloom. 0 — не светится.
// tint (0…1) — насколько сам цвет куба уходит от PLAYER_COLOR к color: без этого золотое свечение
// складывалось бы с синим кубом и выгорало в белый. При tint 0 — обычный цвет игрока.
// Материал общий с кубом демо-сцены — но в демо-режиме игра заморожена и уровень не растёт.
export const setPlayerGlow = ({
  color,
  intensity,
  tint,
}: {
  color: THREE.ColorRepresentation;
  intensity: number;
  tint: number;
}): void => {
  PLAYER_MATERIAL.emissive.set(color);
  PLAYER_MATERIAL.emissiveIntensity = intensity;
  PLAYER_MATERIAL.color.set(config.PLAYER_COLOR).lerp(PLAYER_MATERIAL.emissive, tint);
};
