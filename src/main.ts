// Точка входа: создаёт сцену, физику и объекты, хранит состояние игры и крутит игровой цикл.
// Как устроен каждый объект — в своём модуле: player.ts, enemies.ts, projectiles.ts.
// Какие волны идут и как враги в них появляются — в waves.ts, patterns.ts и schedule.ts.
import type { ColliderHandle } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from './config';
import { refreshCorpseLook, turnOutOfArenaIntoCorpses, turnIntoCorpse, updateCorpses, type Corpses } from './corpses';
import { createDamageNumbers } from './damage-numbers';
import {
  damageEnemy,
  moveEnemies,
  refreshEnemyColors,
  spawnEnemy,
  turnHpBarsToCamera,
  type Enemies,
  type Enemy,
} from './enemies';
import {
  removeAllEntities,
  removeEntity,
  removeFallenEntities,
  syncCubeRotations,
  syncPositions,
} from './entity';
import { refreshHpBarColors } from './hp-bar';
import { createHud } from './hud';
import { createPhysics } from './physics';
import { createPlayer, refreshPlayerColor } from './player';
import {
  findTarget,
  fireProjectile,
  refreshProjectileColor,
  removeFarProjectiles,
  type Projectiles,
} from './projectiles';
import { createScene, refreshSceneLook } from './scene';
import { buildWaveSchedule, type SpawnEvent } from './schedule';
import { createSettingsPanel } from './settings-panel';
import { findFreeSpawnPosition } from './spawn-placement';
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
const { scene, camera, renderer, deathWalls } = createScene();
const hud = createHud();
const showDamageNumber = createDamageNumbers();
const playerHandle = createPlayer({ world, scene });

// Применяет изменения из панели настроек, которые игра сама не подхватит: общие материалы перекрашиваем,
// гравитацию задаём миру. Всё остальное код и так читает из config в момент использования.
const applyLiveConfig = (): void => {
  refreshSceneLook({ scene, deathWalls });
  refreshPlayerColor();
  refreshEnemyColors();
  refreshProjectileColor();
  refreshHpBarColors();
  refreshCorpseLook();
  world.gravity = { x: 0, y: -config.GRAVITY, z: 0 };
};

const settingsPanel = createSettingsPanel({ onChange: applyLiveConfig });

// Живые враги, летящие снаряды и призраки погибших врагов. Ключ — handle коллайдера (см. entity.ts).
const enemies: Enemies = new Map();
const projectiles: Projectiles = new Map();
const corpses: Corpses = new Map();

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

  // Точку из расписания сдвигаем к свободному месту, если там уже кто-то стоит, — рядом на полу или,
  // если на полу тесно, ярусом выше (см. spawn-placement.ts). Враги, появившиеся раньше в этом же кадре,
  // уже в списке enemies — их тоже учитываем.
  for (const event of dueEvents) {
    const size = config.ENEMY_KINDS[event.kindName].size;
    const position = findFreeSpawnPosition({ point: event, size, enemies });

    spawnEnemy({ world, scene, entities: enemies, position, kindName: event.kindName });
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

// Раз в config.FIRE_INTERVAL секунд стреляем в ближайшего врага, которого летящие снаряды ещё не добьют.
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
  state.fireTimer = config.FIRE_INTERVAL;
};

// Наносит урон врагу и показывает число урона чуть выше его полоски здоровья.
// getWorldPosition — где полоска находится в мире (её собственная позиция задана относительно врага).
const hitEnemy = (enemy: Enemy, damage: number): void => {
  damageEnemy(enemy, damage);

  const position = enemy.hpBar.group.getWorldPosition(new THREE.Vector3());
  position.y += config.DAMAGE_NUMBER_HEIGHT;
  showDamageNumber({ position, damage, camera });
};

// Попадание снаряда во врага, найденное в событиях столкновений.
type Hit = {
  enemyHandle: ColliderHandle;
  projectileHandle: ColliderHandle;
};

// Применяет одно попадание. Толчок врагу уже передала физика в этом шаге, когда пуля в него врезалась, —
// здесь только игровая логика: пуля исчезает, враг получает урон, а если здоровье кончилось,
// становится призраком (и летит дальше с тем импульсом, что дала ему последняя пуля).
// Пулю удаляем при любом касании: после удара она почти остановилась и иначе зависла бы в воздухе.
// Если пуля в этом же шаге задела двоих, урон получает только первый.
const applyHit = ({ enemyHandle, projectileHandle }: Hit): void => {
  if (!projectiles.has(projectileHandle)) {
    return;
  }

  removeEntity({ world, scene, entities: projectiles, handle: projectileHandle });

  const enemy = enemies.get(enemyHandle);

  // Враг уже погиб от предыдущей пули в этом же шаге.
  if (!enemy) {
    return;
  }

  hitEnemy(enemy, config.PROJECTILE_DAMAGE);

  if (enemy.hp <= 0) {
    turnIntoCorpse({ world, enemies, corpses, handle: enemyHandle });
  }
};

// Разбираем столкновения, которые Rapier нашёл за последний шаг.
// События приходят парами handle-ов коллайдеров в произвольном порядке, а нас интересуют две пары:
// «враг + снаряд» — попадание; «враг + игрок» — поражение. Остальные пары (враг с полом, враги между собой)
// события не создают: флаг событий есть только у игрока и снарядов.
const handleCollisions = (): void => {
  // Менять физический мир прямо во время обхода событий небезопасно: удалять тела, толкать их,
  // менять группы. Поэтому попадания сначала собираем, а применяем после обхода.
  const hits: Hit[] = [];

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
      loseGame();

      return;
    }

    if (projectiles.has(otherHandle)) {
      hits.push({ enemyHandle, projectileHandle: otherHandle });
    }
  });

  for (const hit of hits) {
    applyHit(hit);
  }
};

const updateGame = (delta: number): void => {
  spawnScheduledEnemies(delta);
  shoot(delta);
  moveEnemies(enemies, delta);

  // Продвигаем симуляцию на delta секунд: двигаем тела, разрешаем столкновения
  // и складываем события о них в eventQueue.
  world.timestep = delta;
  world.step(eventQueue);

  handleCollisions();

  // Если в этом шаге враг добрался до игрока, игра уже окончена — дальше не продолжаем.
  if (state.status !== 'playing') {
    return;
  }

  // Враг, пересёкший край арены, сразу погибает и летит дальше призраком.
  // Призраки, улетевшие слишком глубоко, удаляются — дальше они падали бы вечно.
  turnOutOfArenaIntoCorpses({ world, enemies, corpses });
  removeFallenEntities({ world, scene, entities: corpses });
  updateCorpses({ world, scene, entities: corpses, delta });
  removeFarProjectiles({ world, scene, entities: projectiles });
  advanceWave();
};

// ─── СТАРТ И РЕСТАРТ ─────────────────────────────────────────────────────────

// Новая игра без перезагрузки страницы: убираем всех врагов, снаряды и призраков
// и начинаем со стартовой волны.
const startGame = (): void => {
  removeAllEntities({ world, scene, entities: enemies });
  removeAllEntities({ world, scene, entities: projectiles });
  removeAllEntities({ world, scene, entities: corpses });
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
// Клики по панели настроек игру не перезапускают — иначе после поражения нельзя было бы ничего подкрутить.
window.addEventListener('pointerdown', (event: PointerEvent): void => {
  if (!settingsPanel.isPanelTarget(event.target)) {
    restartGame();
  }
});

// event.code — физическая клавиша ('Space'), не зависит от раскладки.
// event.repeat === true, когда клавишу держат и браузер шлёт повторные нажатия, — их пропускаем.
// Пробел в полях панели настроек тоже не считается.
window.addEventListener('keydown', (event: KeyboardEvent): void => {
  if (event.code === 'Space' && !event.repeat && !settingsPanel.isPanelTarget(event.target)) {
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

  syncPositions(enemies);
  syncPositions(projectiles);
  syncPositions(corpses);
  syncCubeRotations(enemies);
  syncCubeRotations(corpses);
  turnHpBarsToCamera(enemies, camera);
  renderer.render(scene, camera);
});
