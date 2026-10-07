// RAPIER — физический движок: считает движение тел и находит столкновения.
import RAPIER, { type EventQueue, type World } from '@dimforge/rapier3d-compat';

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
  // Камера смотрит сверху, всё движется по полу, поэтому гравитация не нужна: (0, 0, 0).
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });

  // Очередь событий: во время world.step(eventQueue) Rapier складывает сюда начала и концы столкновений.
  // true — перед каждым шагом очередь очищается сама, старые события не копятся.
  const eventQueue = new RAPIER.EventQueue(true);

  return { world, eventQueue };
};
