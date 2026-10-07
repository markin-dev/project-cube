// RAPIER — физический движок: считает движение тел и находит столкновения.
import RAPIER, { type EventQueue, type World } from '@dimforge/rapier3d-compat';
import { FLOOR_GROUPS } from './collision-groups';
import { ARENA_SIZE, GRAVITY } from './config';

type Physics = {
  world: World;
  eventQueue: EventQueue;
};

export const createPhysics = async (): Promise<Physics> => {
  // Rapier написан на Rust и скомпилирован в WebAssembly (WASM).
  // Перед первым использованием браузер должен загрузить и скомпилировать WASM-модуль.
  // Это асинхронная операция, поэтому ждём её через await.
  await RAPIER.init();

  // Физический мир — отдельная от Three.js «вселенная», где живут тела и коллайдеры.
  // Гравитация тянет вниз по оси Y: подброшенные ударом враги падают обратно на пол.
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });

  // Пол: неподвижный коллайдер без тела. cuboid принимает ПОЛОВИНЫ размеров,
  // центр опущен на половину толщины — верхняя поверхность ровно на y = 0, как у видимого пола.
  // За краем пола опоры нет: туда можно упасть.
  // Трение и упругость пола нулевые: у врагов правило Max, и с полом работают их собственные
  // значения из конфига (см. spawnEnemy в enemies.ts).
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(ARENA_SIZE / 2, 0.1, ARENA_SIZE / 2)
      .setTranslation(0, -0.1, 0)
      .setFriction(0)
      .setRestitution(0)
      .setCollisionGroups(FLOOR_GROUPS),
  );

  // Очередь событий: во время world.step(eventQueue) Rapier складывает сюда начала и концы столкновений.
  // true — перед каждым шагом очередь очищается сама, старые события не копятся.
  const eventQueue = new RAPIER.EventQueue(true);

  return { world, eventQueue };
};
