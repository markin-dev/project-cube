import RAPIER, { type ColliderHandle, type World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PLAYER_GROUPS } from './collision-groups';
import { config } from './config';

type PlayerParams = {
  world: World;
  scene: THREE.Scene;
};

// Материал игрока общий на модуль, чтобы его цвет можно было поменять из панели настроек (refreshPlayerColor).
const PLAYER_MATERIAL = new THREE.MeshLambertMaterial({ color: config.PLAYER_COLOR });

// Создаёт игрока — неподвижный куб в центре арены.
// Возвращает handle его коллайдера: по нему в событиях столкновений узнаём, что враг добрался до игрока.
// Игрок создаётся один раз, поэтому PLAYER_SIZE из панели настроек применяется после перезагрузки страницы.
export const createPlayer = ({ world, scene }: PlayerParams): ColliderHandle => {
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
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), PLAYER_MATERIAL);
  mesh.position.copy(body.translation());
  scene.add(mesh);

  return collider.handle;
};

// Перекрашивает игрока по текущему конфигу — вызывается, когда цвет меняют в панели настроек.
export const refreshPlayerColor = (): void => {
  PLAYER_MATERIAL.color.set(config.PLAYER_COLOR);
};
