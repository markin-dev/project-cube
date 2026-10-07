// Точка входа: создаёт сцену, физику и объекты, хранит состояние игры и крутит игровой цикл.
// Как устроен каждый объект — в своём модуле: player.ts, enemies.ts, projectiles.ts.
// Какие волны идут и как враги в них появляются — в waves.ts, patterns.ts и schedule.ts.
import type { ColliderHandle } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIRE_INTERVAL, PROJECTILE_DAMAGE } from './config';
import { damageEnemy, moveEnemies, spawnEnemy, turnHpBarsToCamera, type Enemies } from './enemies';
import { removeAllEntities, removeEntity, syncMeshes } from './entity';
import { createHud } from './hud';
import { createPhysics } from './physics';
import { createPlayer } from './player';
import { findTarget, fireProjectile, removeFarProjectiles, type Projectiles } from './projectiles';
import { createScene } from './scene';
import { buildWaveSchedule, type SpawnEvent } from './schedule';
import { WAVES } from './waves';

// Самый длинный шаг симуляции. После лага или возвращения на вкладку кадр может длиться секунды,
// и слишком большой шаг «протащил» бы снаряд сквозь врага, не заметив попадания.
const MAX_TIMESTEP = 1 / 30;

// С какой волны начинать (индекс в WAVES, с 0). Для отладки волн её можно задать в адресе: ?wave=3
// начнёт игру с третьей волны. Нет параметра или он неправильный — начинаем с первой.
const getStartWaveIndex = (): number => {
  const wave = Number(new URLSearchParams(window.location.search).get('wave'));
  const isValidWave = Number.isInteger(wave) && wave >= 1 && wave <= WAVES.length;

  return isValidWave ? wave - 1 : 0;
};

const START_WAVE_INDEX = getStartWaveIndex();

// ─── СОЗДАНИЕ МИРА ───────────────────────────────────────────────────────────

const { world, eventQueue } = await createPhysics();
const { scene, camera, renderer } = createScene();
const hud = createHud();
const playerHandle = createPlayer({ world, scene });

// Живые враги и летящие снаряды. Ключ — handle коллайдера (см. entity.ts).
const enemies: Enemies = new Map();
const projectiles: Projectiles = new Map();

// ─── СОСТОЯНИЕ ИГРЫ ──────────────────────────────────────────────────────────

// playing — идёт игра; lost — враг добрался до игрока; won — все волны пройдены.
type GameStatus = 'playing' | 'lost' | 'won';

type GameState = {
  // Индекс текущей волны в WAVES, с 0. Игроку показываем номер на 1 больше.
  waveIndex: number;

  // Сколько секунд прошло с начала текущей волны — по нему сверяемся с расписанием.
  waveTime: number;

  // Расписание появления врагов текущей волны, отсортированное по времени (см. schedule.ts),
  // и индекс первого события, которое ещё не наступило.
  schedule: SpawnEvent[];
  nextSpawnIndex: number;

  // Обратный отсчёт в секундах до следующего выстрела. Дошёл до нуля или ниже — пора стрелять.
  fireTimer: number;

  status: GameStatus;
};

// Объект один на всю игру, меняем его поля. Настоящие стартовые значения выставляет startGame ниже.
const state: GameState = {
  waveIndex: START_WAVE_INDEX,
  waveTime: 0,
  schedule: [],
  nextSpawnIndex: 0,
  fireTimer: 0,
  status: 'playing',
};

// ─── ВОЛНЫ ───────────────────────────────────────────────────────────────────

const startWave = (waveIndex: number): void => {
  const wave = WAVES[waveIndex];

  state.waveIndex = waveIndex;
  state.waveTime = 0;
  state.schedule = buildWaveSchedule(wave);
  state.nextSpawnIndex = 0;
  hud.setWave({ number: waveIndex + 1, total: WAVES.length, name: wave.name });
};

// Выпускаем врагов, чьё время по расписанию уже наступило. Расписание отсортировано по времени,
// поэтому такие события идут подряд с nextSpawnIndex. За один кадр их может быть несколько —
// например, когда группа появляется вся разом.
const spawnScheduledEnemies = (delta: number): void => {
  state.waveTime += delta;

  const dueEvents = state.schedule.slice(state.nextSpawnIndex).filter(({ time }) => time <= state.waveTime);

  for (const point of dueEvents) {
    spawnEnemy({ world, scene, entities: enemies, point });
  }

  state.nextSpawnIndex += dueEvents.length;
};

const winGame = (): void => {
  state.status = 'won';

  hud.showEndScreen({
    title: 'Победа!',
    hint: 'Все волны пройдены. Нажми, чтобы сыграть ещё раз',
  });
};

const loseGame = (): void => {
  state.status = 'lost';

  hud.showEndScreen({
    title: `Поражение — волна ${state.waveIndex + 1}`,
    hint: 'Нажми, чтобы начать заново',
  });
};

// Волна закончена, когда по расписанию появились все её враги и все убиты.
// Следующая начинается сразу, а после последней — победа.
const advanceWave = (): void => {
  const isWaveCleared = state.nextSpawnIndex >= state.schedule.length && enemies.size === 0;

  if (!isWaveCleared) {
    return;
  }

  const isLastWave = state.waveIndex === WAVES.length - 1;

  if (isLastWave) {
    winGame();

    return;
  }

  startWave(state.waveIndex + 1);
};

// ─── СТРЕЛЬБА И СТОЛКНОВЕНИЯ ─────────────────────────────────────────────────

// Раз в FIRE_INTERVAL секунд стреляем в ближайшего врага, которого летящие снаряды ещё не добьют.
// Если стрелять не в кого, отсчёт остаётся на нуле, и выстрел случится сразу, как только цель появится.
const shoot = (delta: number): void => {
  state.fireTimer -= delta;

  if (state.fireTimer > 0) {
    return;
  }

  const target = findTarget({ enemies, projectiles });

  if (!target) {
    return;
  }

  fireProjectile({ world, scene, entities: projectiles, target });
  state.fireTimer = FIRE_INTERVAL;
};

// Разбираем столкновения, которые Rapier нашёл за последний шаг.
// События приходят парами handle-ов коллайдеров в произвольном порядке, а нас интересуют две пары:
// «враг + снаряд» — снаряд исчезает, враг теряет здоровье и погибает, когда оно кончилось;
// «враг + игрок» — поражение. Остальные (снаряд внутри игрока сразу после выстрела и т. п.) пропускаем.
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
    const enemy = enemies.get(enemyHandle);

    if (!enemy) {
      return;
    }

    if (otherHandle === playerHandle) {
      loseGame();

      return;
    }

    // Один снаряд ранит одного врага и исчезает. Через уже погибшего врага
    // (он ещё не удалён до конца этого шага) следующий снаряд пролетает насквозь.
    const isHit =
      projectiles.has(otherHandle) && !usedProjectiles.has(otherHandle) && !deadEnemies.has(enemyHandle);

    if (!isHit) {
      return;
    }

    usedProjectiles.add(otherHandle);
    damageEnemy(enemy, PROJECTILE_DAMAGE);

    if (enemy.hp <= 0) {
      deadEnemies.add(enemyHandle);
    }
  });

  for (const handle of deadEnemies) {
    removeEntity({ world, scene, entities: enemies, handle });
  }

  for (const handle of usedProjectiles) {
    removeEntity({ world, scene, entities: projectiles, handle });
  }
};

const updateGame = (delta: number): void => {
  spawnScheduledEnemies(delta);
  shoot(delta);
  moveEnemies(enemies);

  // Продвигаем симуляцию на delta секунд: двигаем тела, разрешаем столкновения
  // и складываем события о них в eventQueue.
  world.timestep = delta;
  world.step(eventQueue);

  handleCollisions();

  // Если в этом шаге враг добрался до игрока, игра уже окончена — дальше не продолжаем.
  if (state.status !== 'playing') {
    return;
  }

  removeFarProjectiles({ world, scene, entities: projectiles });
  advanceWave();
};

// ─── СТАРТ И РЕСТАРТ ─────────────────────────────────────────────────────────

// Новая игра без перезагрузки страницы: убираем всех врагов и снаряды и начинаем со стартовой волны.
const startGame = (): void => {
  removeAllEntities({ world, scene, entities: enemies });
  removeAllEntities({ world, scene, entities: projectiles });
  state.fireTimer = 0;
  state.status = 'playing';
  hud.hideEndScreen();
  startWave(START_WAVE_INDEX);
};

const restartGame = (): void => {
  if (state.status === 'playing') {
    return;
  }

  startGame();
};

startGame();

// Pointer-события объединяют палец, мышь и стилус. Слушаем окно целиком,
// потому что после конца игры canvas закрыт экраном с результатом.
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
  if (state.status === 'playing') {
    updateGame(delta);
  }

  syncMeshes(enemies);
  syncMeshes(projectiles);
  turnHpBarsToCamera(enemies, camera);
  renderer.render(scene, camera);
});
