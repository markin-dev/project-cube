import RAPIER, { type ColliderHandle, type World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PLAYER_COLOR, PLAYER_SIZE } from './config';

type PlayerParams = {
  world: World;
  scene: THREE.Scene;
};

// Создаёт игрока — неподвижный куб в центре арены.
// Возвращает handle его коллайдера: по нему в событиях столкновений узнаём, что враг добрался до игрока.
export const createPlayer = ({ world, scene }: PlayerParams): ColliderHandle => {
  // fixed — тело, которое никогда не двигается: ни от скорости, ни от толчков врагов.
  // Центр поднят на половину высоты, чтобы куб стоял на полу (y = 0), а не утопал в нём.
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, PLAYER_SIZE / 2, 0));

  // cuboid принимает ПОЛОВИНЫ размеров.
  // ActiveEvents.COLLISION_EVENTS — просим Rapier сообщать о столкновениях с этим коллайдером.
  // Без этого флага касание врага прошло бы молча: у самих врагов флага нет.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(PLAYER_SIZE / 2, PLAYER_SIZE / 2, PLAYER_SIZE / 2).setActiveEvents(
      RAPIER.ActiveEvents.COLLISION_EVENTS,
    ),
    body,
  );

  // Видимый куб того же размера. Игрок не двигается, поэтому положение задаём один раз.
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE),
    new THREE.MeshLambertMaterial({ color: PLAYER_COLOR }),
  );

  mesh.position.copy(body.translation());
  scene.add(mesh);

  return collider.handle;
};
