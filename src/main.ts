// Точка входа: создаёт сцену, физику и объекты, хранит состояние игры и крутит игровой цикл.
// Как устроен каждый объект — в своём модуле: player.ts, enemies.ts, projectiles.ts.
import type { ColliderHandle } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIRE_INTERVAL, getWaveSize, SPAWN_INTERVAL } from './config';
import { moveEnemies, spawnEnemy } from './enemies';
import { removeAllEntities, removeEntity, syncMeshes, type Entities } from './entity';
import { createHud } from './hud';
import { createPhysics } from './physics';
import { createPlayer } from './player';
import { findNearestEnemy, fireProjectile, removeFarProjectiles } from './projectiles';
import { createScene } from './scene';

// Самый длинный шаг симуляции. После лага или возвращения на вкладку кадр может длиться секунды,
// и слишком большой шаг «протащил» бы снаряд сквозь врага, не заметив попадания.
const MAX_TIMESTEP = 1 / 30;

// ─── СОЗДАНИЕ МИРА ───────────────────────────────────────────────────────────

const { world, eventQueue } = await createPhysics();
const { scene, camera, renderer } = createScene();
const hud = createHud();
const playerHandle = createPlayer({ world, scene });

// Живые враги и летящие снаряды. Ключ — handle коллайдера (см. entity.ts).
const enemies: Entities = new Map();
const projectiles: Entities = new Map();

// ─── СОСТОЯНИЕ ИГРЫ ──────────────────────────────────────────────────────────

type GameState = {
  // Номер текущей волны, с 1.
  wave: number;

  // Сколько врагов текущей волны уже появилось.
  spawnedInWave: number;

  // Обратные отсчёты в секундах до следующего врага и следующего выстрела.
  // Когда отсчёт дошёл до нуля или ниже — пора действовать.
  spawnTimer: number;
  fireTimer: number;

  // Враг добрался до игрока: всё замерло, ждём нажатия для новой игры.
  isGameOver: boolean;
};

// Отсчёты начинаются с нуля, поэтому первый враг и первый выстрел происходят сразу.
const createInitialState = (): GameState => ({
  wave: 1,
  spawnedInWave: 0,
  spawnTimer: 0,
  fireTimer: 0,
  isGameOver: false,
});

// Объект один на всю игру, меняем его поля. При рестарте заполняем начальными значениями заново.
const state = createInitialState();

hud.setWave(state.wave);

// ─── ШАГИ ИГРОВОГО ЦИКЛА ─────────────────────────────────────────────────────

// Враги волны появляются по одному: раз в SPAWN_INTERVAL секунд, пока не появятся все.
const spawnEnemies = (delta: number): void => {
  state.spawnTimer -= delta;

  const isWaveSpawning = state.spawnedInWave < getWaveSize(state.wave);

  if (state.spawnTimer > 0 || !isWaveSpawning) {
    return;
  }

  spawnEnemy({ world, scene, entities: enemies });
  state.spawnedInWave += 1;
  state.spawnTimer = SPAWN_INTERVAL;
};

// Раз в FIRE_INTERVAL секунд стреляем в ближайшего врага.
// Если врагов нет, отсчёт остаётся на нуле, и выстрел случится сразу, как только враг появится.
const shoot = (delta: number): void => {
  state.fireTimer -= delta;

  if (state.fireTimer > 0) {
    return;
  }

  const target = findNearestEnemy(enemies);

  if (!target) {
    return;
  }

  fireProjectile({ world, scene, entities: projectiles, target });
  state.fireTimer = FIRE_INTERVAL;
};

const endGame = (): void => {
  state.isGameOver = true;
  hud.showGameOver(state.wave);
};

// Разбираем столкновения, которые Rapier нашёл за последний шаг.
// События приходят парами handle-ов коллайдеров в произвольном порядке, а нас интересуют две пары:
// «враг + снаряд» — оба исчезают; «враг + игрок» — конец игры. Остальные (снаряд внутри игрока
// сразу после выстрела и т. п.) пропускаем.
const handleCollisions = (): void => {
  // Удалять тела прямо во время обхода событий нельзя — Rapier ещё читает их данные.
  // Поэтому сначала собираем, кого удалить, а удаляем после.
  const deadEnemies = new Set<ColliderHandle>();
  const usedProjectiles = new Set<ColliderHandle>();

  // isStarted: true — столкновение началось, false — закончилось. Нужны только начала.
  eventQueue.drainCollisionEvents((handle1: ColliderHandle, handle2: ColliderHandle, isStarted: boolean): void => {
    if (!isStarted) {
      return;
    }

    // Ставим врага первым, чтобы дальше не проверять оба порядка.
    const [enemyHandle, otherHandle] = enemies.has(handle1) ? [handle1, handle2] : [handle2, handle1];

    if (!enemies.has(enemyHandle)) {
      return;
    }

    if (otherHandle === playerHandle) {
      endGame();

      return;
    }

    // Один снаряд убивает одного врага, а уже убитого врага второй снаряд пролетает насквозь.
    const isHit =
      projectiles.has(otherHandle) && !usedProjectiles.has(otherHandle) && !deadEnemies.has(enemyHandle);

    if (isHit) {
      deadEnemies.add(enemyHandle);
      usedProjectiles.add(otherHandle);
    }
  });

  for (const handle of deadEnemies) {
    removeEntity({ world, scene, entities: enemies, handle });
  }

  for (const handle of usedProjectiles) {
    removeEntity({ world, scene, entities: projectiles, handle });
  }
};

// Волна закончена, когда все её враги появились и все убиты. Следующая начинается сразу.
const advanceWave = (): void => {
  const isWaveCleared = state.spawnedInWave >= getWaveSize(state.wave) && enemies.size === 0;

  if (!isWaveCleared) {
    return;
  }

  state.wave += 1;
  state.spawnedInWave = 0;
  hud.setWave(state.wave);
};

const updateGame = (delta: number): void => {
  spawnEnemies(delta);
  shoot(delta);
  moveEnemies(enemies);

  // Продвигаем симуляцию на delta секунд: двигаем тела, разрешаем столкновения
  // и складываем события о них в eventQueue.
  world.timestep = delta;
  world.step(eventQueue);

  handleCollisions();
  removeFarProjectiles({ world, scene, entities: projectiles });
  advanceWave();
};

// ─── РЕСТАРТ ─────────────────────────────────────────────────────────────────

// Новая игра без перезагрузки страницы: убираем всех врагов и снаряды и сбрасываем состояние.
const restartGame = (): void => {
  if (!state.isGameOver) {
    return;
  }

  removeAllEntities({ world, scene, entities: enemies });
  removeAllEntities({ world, scene, entities: projectiles });
  Object.assign(state, createInitialState());
  hud.setWave(state.wave);
  hud.hideGameOver();
};

// Pointer-события объединяют палец, мышь и стилус. Слушаем окно целиком,
// потому что после конца игры canvas закрыт экраном «Игра окончена».
window.addEventListener('pointerdown', restartGame);

// event.code — физическая клавиша ('Space'), не зависит от раскладки.
// event.repeat === true, когда клавишу держат и браузер шлёт повторные нажатия, — их пропускаем.
window.addEventListener('keydown', (event: KeyboardEvent): void => {
  if (event.code === 'Space' && !event.repeat) {
    restartGame();
  }
});

// ─── ИГРОВОЙ ЦИКЛ ────────────────────────────────────────────────────────────

// Timer измеряет, сколько времени прошло между кадрами.
const timer = new THREE.Timer();

// setAnimationLoop вызывает функцию перед каждым обновлением экрана:
// 60 раз в секунду на обычном мониторе, 144 — на игровом.
// time — миллисекунды с момента загрузки страницы.
renderer.setAnimationLoop((time: number): void => {
  timer.update(time);

  // Все отсчёты и физика идут по реальному времени кадра, поэтому скорость игры
  // не зависит от частоты монитора.
  const delta = Math.min(timer.getDelta(), MAX_TIMESTEP);

  // После конца игры всё замирает, но сцену продолжаем рисовать.
  if (!state.isGameOver) {
    updateGame(delta);
  }

  syncMeshes(enemies);
  syncMeshes(projectiles);
  renderer.render(scene, camera);
});
