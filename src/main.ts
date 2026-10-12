// Точка входа: создаёт сцену, физику и объекты, хранит состояние игры и крутит игровой цикл.
// Как устроен каждый объект — в своём модуле: player.ts, enemies.ts, projectiles.ts.
// Какие волны идут и как враги в них появляются — в waves.ts, patterns.ts и schedule.ts.
import type { ColliderHandle } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from './config';
import { refreshCorpseLook, turnOutOfArenaIntoCorpses, turnIntoCorpse, updateCorpses, type Corpses } from './corpses';
import { createDamageNumbers } from './damage-numbers';
import { createFpsCounter } from './fps-counter';
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
  findTargets,
  fireProjectiles,
  refreshProjectileColor,
  removeFarProjectiles,
  runFireTimer,
  type Projectiles,
} from './projectiles';
import { createScene, refreshSceneLook } from './scene';
import { buildWaveSchedule, countDueEvents, type GroupSchedule } from './schedule';
import { createSettingsPanel } from './settings-panel';
import { createSound } from './sound';
import { createSoundSwitch } from './sound-switch';
import { createSpawnPlacer } from './spawn-placement';
import { createSpeedSwitch } from './speed-switch';
import { createSparks } from './sparks';
import { WAVES } from './waves';

// Сколько реального времени кадра учитываем максимум, с. После возвращения на вкладку кадр может
// длиться секунды — без ограничения игра «перемотала» бы их разом. Длинный кадр делится на шаги
// (MAX_TIMESTEP), поэтому до 10 FPS игра идёт в реальном времени и замедляется только ниже.
const MAX_FRAME_TIME = 0.1;

// Самый длинный шаг симуляции, с. Слишком большой шаг «протащил» бы пулю сквозь врага, не заметив
// попадания. При ускорении игровое время кадра делится на несколько шагов не длиннее этого.
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

// Искры при попадании: пул частиц в 3D-сцене (см. sparks.ts).
const sparks = createSparks({ scene });

// Звук: синтез через Web Audio, без ассетов (см. sound.ts). playHit звучит при попадании
// снаряда в живого врага — в applyHit ниже.
const sound = createSound();

// Применяет изменения из панели настроек, которые игра сама не подхватит: общие материалы перекрашиваем,
// гравитацию задаём миру, громкость звука перечитываем. Всё остальное код и так читает из config в момент использования.
const applyLiveConfig = (): void => {
  refreshSceneLook({ scene, deathWalls });
  refreshPlayerColor();
  refreshEnemyColors();
  refreshProjectileColor();
  refreshHpBarColors();
  refreshCorpseLook();
  sparks.refreshColor();
  sound.applyVolume();
  world.gravity = { x: 0, y: -config.GRAVITY, z: 0 };
};

// Панель настроек. onStartWave — ручной запуск волны из раздела «Волны (отладка)»: ссылку берём
// через стрелку, саму функцию startGame панель вызовет уже после её объявления. sound — раздел
// «Звук»: выбор наборов для каждого типа звука.
const settingsPanel = createSettingsPanel({
  onChange: applyLiveConfig,
  onStartWave: (waveIndex: number): void => startGame(waveIndex),
  sound,
});

// Живые враги, летящие снаряды и призраки погибших врагов. Ключ — handle коллайдера (см. entity.ts).
const enemies: Enemies = new Map();
const projectiles: Projectiles = new Map();
const corpses: Corpses = new Map();

// ─── СОСТОЯНИЕ ИГРЫ ──────────────────────────────────────────────────────────

// playing — идёт игра; lost — враг добрался до игрока; won — все волны пройдены.
type GameStatus = 'playing' | 'lost' | 'won';

// Группа текущей волны во время игры: её расписание (см. schedule.ts), момент, когда она началась
// (секунд от начала волны; undefined — ещё не началась), и сколько её врагов уже появилось.
type ActiveGroup = GroupSchedule & {
  startTime?: number;
  spawnedCount: number;
};

type GameState = {
  // Индекс текущей волны в WAVES, с 0. Игроку показываем номер на 1 больше.
  waveIndex: number;

  // Сколько секунд прошло с начала текущей волны — по нему сверяемся с задержками групп.
  waveTime: number;

  // Группы текущей волны по порядку.
  groups: ActiveGroup[];

  // Обратный отсчёт в секундах до следующего выстрела. Дошёл до нуля или ниже — пора стрелять.
  fireTimer: number;

  status: GameStatus;

  // Скорость игры: во сколько раз игровое время идёт быстрее реального. 0 — пауза.
  // Меняется переключателем в левом нижнем углу и при рестарте игры не сбрасывается.
  timeScale: number;
};

// Объект один на всю игру, меняем его поля. Настоящие стартовые значения выставляет startGame ниже.
const state: GameState = {
  waveIndex: START_WAVE_INDEX,
  waveTime: 0,
  groups: [],
  fireTimer: 0,
  status: 'playing',
  timeScale: 1,
};

// Переключатель скорости в левом нижнем углу (speed-switch.ts).
const speedSwitch = createSpeedSwitch({
  onChange: (speed: number): void => {
    state.timeScale = speed;
  },
});

// Кнопка звука — в том же ряду, что и кнопки скорости, справа от них.
const soundSwitch = createSoundSwitch({ container: speedSwitch.container, sound });

// Счётчик FPS в правом нижнем углу (fps-counter.ts).
const fpsCounter = createFpsCounter();

// Проверка «событие произошло на панели настроек, переключателе скорости или кнопке звука?» —
// такие клики и нажатия не должны перезапускать игру.
const isUiTarget = (target: EventTarget | null): boolean =>
  settingsPanel.isPanelTarget(target) || speedSwitch.isSwitchTarget(target) || soundSwitch.isSwitchTarget(target);

// ─── ВОЛНЫ ───────────────────────────────────────────────────────────────────

const startWave = (waveIndex: number): void => {
  const wave = WAVES[waveIndex];

  state.waveIndex = waveIndex;
  state.waveTime = 0;
  state.groups = buildWaveSchedule(wave).map((group) => ({ ...group, spawnedCount: 0 }));
  hud.setWave({ number: waveIndex + 1, total: WAVES.length, name: wave.name });
  hud.setGroup({ number: 0, total: state.groups.length });

  // Селект «Волна» в панели показывает текущую волну.
  settingsPanel.setCurrentWave(waveIndex);
};

// Проверка «группа уже началась и все её враги появились?».
const isGroupFullySpawned = (group: ActiveGroup): boolean =>
  group.startTime !== undefined && group.spawnedCount >= group.events.length;

// Начинает группы, которым пора. Группы идут строго по порядку списка, и очередная начинается,
// когда наступит раньше одно из двух:
//   истекла её задержка delay от начала волны;
//   все предыдущие группы уже полностью появились и все враги на арене убиты — ждать задержку незачем.
// У первой группы предыдущих нет, поэтому она начинается только по задержке: delay первой группы —
// пауза перед волной. Группа, которая ещё появляется по одному, не считается убитой, пока не появились
// все её враги, — иначе смерть первого же врага запускала бы следующую группу.
// За один кадр может начаться несколько групп подряд — например, если у нескольких уже истекли задержки.
const startDueGroups = (): void => {
  for (const [index, group] of state.groups.entries()) {
    if (group.startTime !== undefined) {
      continue;
    }

    const isDelayOver = state.waveTime >= group.delay;
    const isPreviousSpawned = index > 0 && state.groups.slice(0, index).every(isGroupFullySpawned);
    const isPreviousCleared = isPreviousSpawned && enemies.size === 0;

    if (!isDelayOver && !isPreviousCleared) {
      return;
    }

    group.startTime = state.waveTime;
    hud.setGroup({ number: index + 1, total: state.groups.length });
  }
};

// Выпускаем врагов начавшихся групп, чьё время уже наступило (время события — от начала его группы).
// События в группе идут по порядку, поэтому наступившие — подряд начиная со spawnedCount.
// За один кадр их может быть несколько — например, когда группа появляется вся разом.
const spawnScheduledEnemies = (delta: number): void => {
  state.waveTime += delta;
  startDueGroups();

  // Сколько врагов каждой группы пора выпустить: наступившие события минус уже выпущенные.
  const dueCounts = state.groups.map((group) =>
    group.startTime === undefined
      ? 0
      : countDueEvents(group.events, state.waveTime - group.startTime) - group.spawnedCount,
  );

  // Если появляться некому — выходим, не строя сетку для поиска мест.
  if (dueCounts.every((dueCount) => dueCount === 0)) {
    return;
  }

  // Лимит появлений за шаг (SPAWN_PER_FRAME): огромная группа не выходит разом, а порциями несколько
  // шагов подряд. Место для каждого нового врага ищется по уже вставшей толпе, проверок тем больше,
  // чем длиннее очередь, — без лимита такой шаг проваливается на секунды. С лимитом волна появляется
  // за доли секунды, что на глаз неотличимо от мгновенного появления, а кадр держится.
  // Невыпущенные события ждут следующего шага: spawnedCount не двигается, порядок и условия
  // появления не меняются, только скорость выдачи. 0 — без лимита.
  const budget = config.SPAWN_PER_FRAME > 0 ? Math.max(1, Math.floor(config.SPAWN_PER_FRAME)) : Infinity;

  // Точку из расписания двигаем к свободному месту, если там уже кто-то: сначала вверх столбом над ней,
  // потом в стороны (см. spawn-placement.ts). Подборщик мест строится один раз на шаг
  // и сам учитывает врагов, которые появляются в этом же шаге.
  const placeEnemy = createSpawnPlacer(enemies);
  let remaining = budget;

  for (const [index, group] of state.groups.entries()) {
    // Бюджет исчерпан — остальные группы (и остаток этой) появятся в следующем шаге.
    if (remaining <= 0) {
      break;
    }

    const spawnCount = Math.min(dueCounts[index], remaining);

    for (const event of group.events.slice(group.spawnedCount, group.spawnedCount + spawnCount)) {
      const position = placeEnemy({ point: event, size: config.ENEMY_KINDS[event.kindName].size });

      spawnEnemy({ world, scene, entities: enemies, position, kindName: event.kindName });
    }

    group.spawnedCount += spawnCount;
    remaining -= spawnCount;
  }
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

// Волна закончена, когда все её группы начались, все их враги появились и все убиты.
// Следующая начинается сразу, а после последней — победа.
const advanceWave = (): void => {
  const isWaveCleared = state.groups.every(isGroupFullySpawned) && enemies.size === 0;

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

// Раз в config.FIRE_INTERVAL секунд выпускаем залп: до config.PROJECTILE_COUNT снарядов — по одному
// на разных ближайших врагов, которых летящие снаряды ещё не добьют (см. findTargets в projectiles.ts).
// Отсчёт и перенос остатка между шагами — runFireTimer в projectiles.ts.
const fireVolley = (): boolean => {
  const targets = findTargets({
    enemies,
    projectiles,
    count: config.PROJECTILE_COUNT,
  });

  if (targets.length === 0) {
    return false;
  }

  // Залп — и один звук выстрела на весь залп.
  fireProjectiles({ world, scene, entities: projectiles, targets });
  sound.playShot();

  return true;
};

const shoot = (delta: number): void => {
  state.fireTimer = runFireTimer({ timer: state.fireTimer, delta, fireVolley });
};

// Наносит урон врагу и показывает число урона чуть выше его полоски здоровья.
// Точку берём у тела, а не у меша: меши догоняют тела раз в кадр, после всех шагов, и на ускорении
// число появлялось бы там, где враг был в начале кадра. Высота полоски задана относительно врага.
// isCrit — критическое ли попадание: число показывается другим цветом и крупнее.
const hitEnemy = ({ enemy, damage, isCrit }: { enemy: Enemy; damage: number; isCrit: boolean }): void => {
  damageEnemy(enemy, damage);

  const { x, y, z } = enemy.body.translation();
  const position = new THREE.Vector3(x, y + enemy.hpBar.group.position.y + config.DAMAGE_NUMBER_HEIGHT, z);

  showDamageNumber({ position, damage, isCrit, camera });
};

// Попадание снаряда во врага, найденное в событиях столкновений.
type Hit = {
  enemyHandle: ColliderHandle;
  projectileHandle: ColliderHandle;
};

// Применяет одно попадание. Толчок врагу уже передала физика в этом шаге, когда пуля в него врезалась, —
// здесь только игровая логика: искры в точке удара, пуля исчезает, враг получает урон (и звук попадания),
// а если здоровье кончилось, становится призраком (и летит дальше с тем импульсом, что дала ему последняя пуля).
// Пулю удаляем при любом касании: после удара она почти остановилась и иначе зависла бы в воздухе.
// Если пуля в этом же шаге задела двоих, урон получает только первый.
const applyHit = ({ enemyHandle, projectileHandle }: Hit): void => {
  const projectile = projectiles.get(projectileHandle);

  // Пуля уже удалена — её попадание мы уже обработали в этом же шаге.
  if (!projectile) {
    return;
  }

  // Урон и критичность снаряда запоминаем до его удаления: брошенные при выстреле (rollDamage,
  // rollCrit в projectiles.ts). isCrit решает об интенсивности искр и критичности цифры урона.
  const { damage, isCrit } = projectile;

  const enemy = enemies.get(enemyHandle);

  // Искры — до удаления пули: её центр в момент столкновения и есть точка удара. Если врага
  // в списке уже нет, sparks.spawn поднимет искры на поверхность призрака сам (или возьмёт
  // точку пули). Крит-попадание даёт больше, быстрее и другой цвет искр.
  sparks.spawn({ projectilePosition: projectile.body.translation(), enemy, isCrit });

  removeEntity({ world, scene, entities: projectiles, handle: projectileHandle });

  // Враг уже погиб от предыдущей пули в этом же шаге — пуля задела его второй раз.
  if (!enemy) {
    return;
  }

  hitEnemy({ enemy, damage, isCrit });

  // Звук попадания — только по живому врагу: по призраку урон не наносится, это не «попадание».
  sound.playHit();

  if (enemy.hp <= 0) {
    turnIntoCorpse({ world, enemies, corpses, handle: enemyHandle });

    // Звук смерти — сразу за звуком попадания: пуля добила врага.
    sound.playDeath();
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
  moveEnemies(world, enemies, delta);

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
  // Звук смерти — если кто-то в этом кадре погиб: засчитываем любых, кого функция превратила
  // в призраков (покинувшие арену, улетевшие выше потолка смерти, сорвавшиеся с края).
  // Массовая гибель — один звук на кадр, поток сдерживает пауза MIN_GAP_MS в sound.ts.
  const corpsesBefore = corpses.size;

  turnOutOfArenaIntoCorpses({ world, enemies, corpses });

  if (corpses.size > corpsesBefore) {
    sound.playDeath();
  }

  removeFallenEntities({ world, scene, entities: corpses });
  updateCorpses({ world, scene, entities: corpses, delta });
  removeFarProjectiles({ world, scene, entities: projectiles });

  // Искры живут в игровом времени: на паузе замирают, при ускорении — летят быстрее.
  sparks.update(delta);
  advanceWave();
};

// ─── СТАРТ И РЕСТАРТ ─────────────────────────────────────────────────────────

// Новая игра без перезагрузки страницы: убираем всех врагов, снаряды и призраков
// и начинаем со стартовой волны. Свой индекс волны передаёт ручной запуск из панели настроек —
// тогда игра начинается с выбранной волны (арена всё равно чистится, чтобы старт был предсказуем).
const startGame = (waveIndex: number = START_WAVE_INDEX): void => {
  removeAllEntities({ world, scene, entities: enemies });
  removeAllEntities({ world, scene, entities: projectiles });
  removeAllEntities({ world, scene, entities: corpses });
  sparks.clear();
  state.fireTimer = 0;
  state.status = 'playing';
  hud.hideEndScreen();
  startWave(waveIndex);
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
// Клики по панели настроек и переключателю скорости игру не перезапускают — иначе после поражения
// нельзя было бы ничего подкрутить.
window.addEventListener('pointerdown', (event: PointerEvent): void => {
  if (!isUiTarget(event.target)) {
    restartGame();
  }
});

// event.code — физическая клавиша ('Space'), не зависит от раскладки.
// event.repeat === true, когда клавишу держат и браузер шлёт повторные нажатия, — их пропускаем.
// Пробел в полях панели настроек и на переключателе скорости тоже не считается.
window.addEventListener('keydown', (event: KeyboardEvent): void => {
  if (event.code === 'Space' && !event.repeat && !isUiTarget(event.target)) {
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

  // Все отсчёты и физика идут по времени кадра, поэтому скорость игры не зависит от частоты монитора.
  // Реальное время кадра берём без ограничения MAX_FRAME_TIME — оно нужно только счётчику FPS:
  // лаг или возврат на вкладку должны быть видны как просадка, а не замаскированы ограничителем.
  const realDelta = timer.getDelta();

  fpsCounter.tick(realDelta);

  // Игровое время кадра — реальное, умноженное на выбранную скорость (0 — пауза).
  const gameTime = Math.min(realDelta, MAX_FRAME_TIME) * state.timeScale;

  // На ускорении игровое время кадра длиннее допустимого шага физики — делим его на несколько равных
  // шагов не длиннее MAX_TIMESTEP и на каждом целиком обновляем игру. Так попадания и физика работают
  // так же, как на обычной скорости, только шагов за кадр больше (и нагрузка выше).
  // На паузе шагов ноль: игра стоит, но сцену продолжаем рисовать.
  const stepsCount = Math.ceil(gameTime / MAX_TIMESTEP);

  Array.from({ length: stepsCount }).forEach((): void => {
    // После конца игры всё замирает — в том числе посреди кадра, если враг добрался до игрока на одном из шагов.
    if (state.status === 'playing') {
      updateGame(gameTime / stepsCount);
    }
  });

  syncPositions(enemies);
  syncPositions(projectiles);
  syncPositions(corpses);
  syncCubeRotations(enemies);
  syncCubeRotations(corpses);
  turnHpBarsToCamera(enemies, camera);
  sparks.sync();
  renderer.render(scene, camera);
});

// ─── ТЕСТОВЫЙ ДОСТУП ─────────────────────────────────────────────────────────

// __game — дверь для скриптов проверки (headless Chrome + CDP): тесты читают состояния тел
// напрямую (позиции, скорости), вместо косвенных признаков в DOM, и могут задать телу скорость,
// чтобы проверить поведение управления. import.meta.env.DEV на dev-сервере true, а в npm run build
// vite статически подставляет false — вся ветка вырезается из прод-бандла.
if (import.meta.env.DEV) {
  (window as typeof window & { __game?: { enemies: Enemies } }).__game = { enemies };
}
