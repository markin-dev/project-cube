// Точка входа: собирает физику, сцену и интерфейс, создаёт игру (game.ts), слушает ввод
// и крутит цикл кадров. Сама игровая логика — волны, стрельба, столкновения — в game.ts.
import * as THREE from 'three';
import { config } from './config';
import { refreshCorpseLook } from './corpses';
import { createDamageNumbers } from './damage-numbers';
import { refreshEnemyColors, turnHpBarsToCamera } from './enemies';
import { syncCubeRotations, syncPositions } from './entity';
import { createFpsCounter } from './fps-counter';
import { createGame, type Game } from './game';
import { refreshHpBarColors } from './hp-bar';
import { createHud } from './hud';
import { setGlowLights, MAX_GLOW_LIGHTS } from './lighting';
import { createPhysics } from './physics';
import { createPlayer, refreshPlayerColor } from './player';
import { createPost } from './post';
import { getGlowSources, refreshProjectileColor } from './projectiles';
import { createScene, refreshSceneLook } from './scene';
import { createSettingsPanel } from './settings-panel';
import { createSound } from './sound';
import { createSoundSwitch } from './sound-switch';
import { createSparks } from './sparks';
import { createSpeedSwitch } from './speed-switch';
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

// ─── СОЗДАНИЕ МИРА ───────────────────────────────────────────────────────────

const { world, eventQueue } = await createPhysics();

// Части сцены нужны целиком, а не по одной: refreshSceneLook (панель настроек) обновляет фон, пол,
// стенки границы, свет и тени — всё сразу по текущему конфигу.
const sceneParts = createScene();
const { scene, camera, renderer } = sceneParts;
const hud = createHud();
const playerHandle = createPlayer({ world, scene });

// Искры при попадании: пул частиц в 3D-сцене (см. sparks.ts).
const sparks = createSparks({ scene });

// Звук: синтез через Web Audio, без ассетов (см. sound.ts).
const sound = createSound();

// Ореол вокруг ярких мест (bloom) — считается пост-обработкой после сцены (см. post.ts).
const post = createPost({ renderer, scene, camera });

// Цепочка пост-обработки держит текстуры в размер экрана — при повороте и ресайзе пересобираем их.
// Canvas и камера меняют размер в своём слушателе (см. scene.ts), здесь это не нужно.
window.addEventListener('resize', (): void => {
  post.setSize();
});

// Применяет изменения из панели настроек, которые игра сама не подхватит: общие материалы перекрашиваем,
// гравитацию задаём миру, громкость звука перечитываем. Всё остальное код и так читает из config в момент использования.
const applyLiveConfig = (): void => {
  refreshSceneLook(sceneParts);
  refreshPlayerColor();
  refreshEnemyColors();
  refreshProjectileColor();
  refreshHpBarColors();
  refreshCorpseLook();
  sparks.refreshColor();
  sound.applyVolume();
  world.gravity = { x: 0, y: -config.GRAVITY, z: 0 };
};

// Панель настроек. onStartWave — ручной запуск волны из раздела «Волны (отладка)»: ссылку на игру
// берём через стрелку, панель вызовет её уже после создания игры. sound — раздел «Звук»: выбор наборов.
const settingsPanel = createSettingsPanel({
  onChange: applyLiveConfig,
  onStartWave: (waveIndex: number): void => game.startGame(waveIndex),
  sound,
});

const game: Game = createGame({
  world,
  eventQueue,
  scene,
  playerHandle,
  sparks,
  sound,
  hud,
  showDamageNumber: createDamageNumbers({ camera }),
  waves: WAVES,
  startWaveIndex: getStartWaveIndex(),
  onWaveStart: settingsPanel.setCurrentWave,
});

// ─── ИНТЕРФЕЙС И ВВОД ────────────────────────────────────────────────────────

// Скорость игры: во сколько раз игровое время идёт быстрее реального, 0 — пауза. Меняется
// переключателем в левом нижнем углу (speed-switch.ts) и при рестарте игры не сбрасывается.
const loop = { timeScale: 1 };

const speedSwitch = createSpeedSwitch({
  onChange: (speed: number): void => {
    loop.timeScale = speed;
  },
});

// Кнопка звука — в том же ряду, что и кнопки скорости, справа от них.
createSoundSwitch({ container: speedSwitch.container, sound });

// Счётчик FPS в правом нижнем углу (fps-counter.ts).
const fpsCounter = createFpsCounter();

// Проверка «событие произошло на панели настроек или в ряду скорости и звука?» — такие клики
// и нажатия не должны перезапускать игру.
const isUiTarget = (target: EventTarget | null): boolean =>
  settingsPanel.isPanelTarget(target) || speedSwitch.isSwitchTarget(target);

// После конца игры клик или пробел начинают её заново со стартовой волны.
const restartGame = (): void => {
  if (game.state.status !== 'playing') {
    game.startGame();
  }
};

game.startGame();

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

// ─── ЦИКЛ КАДРОВ ─────────────────────────────────────────────────────────────

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
  const gameTime = Math.min(realDelta, MAX_FRAME_TIME) * loop.timeScale;

  // На ускорении игровое время кадра длиннее допустимого шага физики — делим его на несколько равных
  // шагов не длиннее MAX_TIMESTEP и на каждом целиком обновляем игру. Так попадания и физика работают
  // так же, как на обычной скорости, только шагов за кадр больше (и нагрузка выше).
  // На паузе шагов ноль: игра стоит, но сцену продолжаем рисовать.
  const stepsCount = Math.ceil(gameTime / MAX_TIMESTEP);

  Array.from({ length: stepsCount }).forEach((): void => game.update(gameTime / stepsCount));

  syncPositions(game.enemies);
  syncPositions(game.projectiles);
  syncPositions(game.corpses);
  syncCubeRotations(game.enemies);
  syncCubeRotations(game.corpses);
  turnHpBarsToCamera(game.enemies, camera);
  sparks.sync();

  // Свет от снарядов и искр: пул точечных источников (см. lighting.ts) каждый кадр переезжает на самые
  // горящие точки — свежие вспышки попаданий и летящие пули. Кандидатов берём с запасом (весь пул),
  // а распределение по источникам делает setGlowLights: он отберёт самые яркие.
  setGlowLights(sceneParts.glowLights, [
    ...sparks.getBursts(MAX_GLOW_LIGHTS),
    ...getGlowSources(game.projectiles),
  ]);

  post.render();
});

// ─── ТЕСТОВЫЙ ДОСТУП ─────────────────────────────────────────────────────────

// __game — доступ для браузерных E2E-тестов (browser/): они читают живых врагов напрямую, а не по
// косвенным признакам в DOM. import.meta.env.DEV на dev-сервере true, а в npm run build vite
// подставляет false — вся ветка вырезается из прод-бандла.
if (import.meta.env.DEV) {
  Object.assign(window, { __game: { enemies: game.enemies } });
}
