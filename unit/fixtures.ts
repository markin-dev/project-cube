// Общие фикстуры юнит-тестов: настоящие объекты игры вместо заглушек — физический мир Rapier
// (работает в Node без браузера), сцена Three.js и враги, созданные тем же spawnEnemy, что и в игре.
import type { EventQueue, RigidBody, World } from '@dimforge/rapier3d-compat';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { EnemyKindName } from '@/config';
import { spawnEnemy, type Enemies, type Enemy } from '@/enemies';
import { createPhysics } from '@/physics';

export type TestWorld = {
  world: World;
  eventQueue: EventQueue;
  scene: THREE.Scene;
};

// Новый физический мир с полом и пустая сцена.
export const createTestWorld = async (): Promise<TestWorld> => {
  const { world, eventQueue } = await createPhysics();

  return { world, eventQueue, scene: new THREE.Scene() };
};

// Враг типа kindName с центром в (x, y, z), добавленный в enemies.
export const addTestEnemy = ({
  world,
  scene,
  enemies,
  x,
  y,
  z,
  kindName = 'normal',
}: Pick<TestWorld, 'world' | 'scene'> & {
  enemies: Enemies;
  x: number;
  y: number;
  z: number;
  kindName?: EnemyKindName;
}): Enemy => spawnEnemy({ world, scene, entities: enemies, position: { x, y, z }, kindName });

// Голое динамическое тело в точке (x, y, z) — для проверок, которым нужна только позиция.
export const createTestBody = ({ world, x, y, z }: { world: World; x: number; y: number; z: number }): RigidBody =>
  world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z));

// Handle коллайдера врага — ключ в списке врагов и цель снаряда.
export const getHandle = (enemy: Enemy): number => enemy.body.collider(0).handle;
