// Игровая логика: состояние игры, волны и их группы, полигон (статичная сетка врагов, см. polygon.ts),
// стрельба, столкновения и шаг симуляции.
// Ничего не знает про DOM, рендер и ввод — HUD, звук и цифры урона приходят параметрами createGame,
// поэтому игру можно гонять в юнит-тестах на headless-Rapier (unit/game.test.ts).
// Сцену, интерфейс и цикл кадров собирает точка входа main.ts.
import type { ColliderHandle, EventQueue, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from './config';
import { turnIntoCorpse, turnOutOfArenaIntoCorpses, updateCorpses, type Corpses } from './corpses';
import type { ShowDamageNumber } from './damage-numbers';
import { damageEnemy, moveEnemies, spawnEnemy, type Enemies, type Enemy } from './enemies';
import { removeAllEntities, removeEntity, removeFallenEntities } from './entity';
import type { Hud } from './hud';
import { getPolygonKindName, getPolygonPoints } from './polygon';
import {
  bounceProjectile,
  createProjectileHooks,
  findTargets,
  fireProjectiles,
  removeFarProjectiles,
  runFireTimer,
  type Projectiles,
} from './projectiles';
import { buildWaveSchedule, countDueEvents, getWaveScale, type GroupSchedule } from './schedule';
import type { Sound } from './sound';
import { createSpawnPlacer } from './spawn-placement';
import type { Sparks } from './sparks';
import type { Wave } from './waves';

// playing — идёт игра; lost — враг добрался до игрока. Волны идут по кругу бесконечно,
// победы нет — цель игрока дойти как можно дальше.
export type GameStatus = 'playing' | 'lost';

// Что крутит игра на арене: waves — обычная игра с волнами (startGame); polygon — полигон
// (startPolygon, см. polygon.ts): статичная сетка врагов, которые не идут к кубу, а убитая сетка
// сразу сменяется следующей. Поражения на полигоне нет.
export type GameMode = 'waves' | 'polygon';

// Группа текущей волны во время игры: её расписание (см. schedule.ts), момент, когда она началась
// (секунд от начала волны; undefined — ещё не началась), и сколько её врагов уже появилось.
type ActiveGroup = GroupSchedule & {
  startTime?: number;
  spawnedCount: number;
};

export type GameState = {
  mode: GameMode;

  // Сквозной номер текущей волны (с 1) — его видит игрок. Составы волн берутся из списка по кругу:
  // волна N — это waves[(N − 1) mod waves.length], а сила растёт с номером (см. getWaveScale в schedule.ts).
  // На полигоне — номер сетки: каждая сетка — та же «волна», только статичная.
  waveNumber: number;

  // Сколько врагов встало в текущую сетку полигона (на арене может влезть меньше, чем просили).
  // В режиме волн — 0.
  gridSize: number;

  // Сила текущей волны: во сколько раз у её врагов больше здоровья и опыта, чем у их типов
  // в ENEMY_KINDS (1 — в обучающем круге, дальше растёт; см. getWaveScale в schedule.ts).
  strength: number;

  // Прокачка куба: уровень (с 1) и накопленный на него опыт. Порог следующего уровня —
  // needForLevelUp(state.level) в game.ts; опыт сверх порога не пропадает.
  level: number;
  xp: number;

  // Сколько секунд прошло с начала текущей волны — по нему сверяемся с задержками групп.
  waveTime: number;

  // Группы текущей волны по порядку.
  groups: ActiveGroup[];

  // Обратный отсчёт в секундах до следующего залпа (см. runFireTimer).
  fireTimer: number;

  status: GameStatus;
};

export type GameParams = {
  world: World;
  eventQueue: EventQueue;
  scene: THREE.Scene;

  // Коллайдер куба-игрока: касание его врагом — поражение.
  playerHandle: ColliderHandle;

  sparks: Sparks;
  sound: Pick<Sound, 'playHit' | 'playShot' | 'playDeath'>;
  hud: Hud;
  showDamageNumber: ShowDamageNumber;

  // Список волн и с какой начинать (сквозной номер, с 1; больше длины списка — уже поздняя волна).
  waves: Wave[];
  startWaveNumber: number;

  // Вызывается при старте каждой волны со сквозным номером — селект «Волна» в панели показывает текущую.
  onWaveStart: (waveNumber: number) => void;
};

export type Game = {
  state: Readonly<GameState>;

  // Живые враги, летящие снаряды и призраки погибших врагов. Ключ — handle коллайдера (см. entity.ts).
  enemies: Enemies;
  projectiles: Projectiles;
  corpses: Corpses;

  // Новая игра без перезагрузки страницы: арена очищается, игра начинается с волны waveNumber
  // (сквозной номер; по умолчанию — со стартовой).
  startGame: (waveNumber?: number) => void;

  // Полигон вместо игры: арена очищается, встаёт первая сетка врагов (см. polygon.ts).
  // Назад к волнам — startGame.
  startPolygon: () => void;

  // Один шаг симуляции длиной delta секунд. После конца игры ничего не делает — всё замирает.
  update: (delta: number) => void;
};

// Попадание снаряда во врага, найденное в событиях столкновений.
type Hit = {
  enemyHandle: ColliderHandle;
  projectileHandle: ColliderHandle;
};

// Проверка «группа уже началась и все её враги появились?».
const isGroupFullySpawned = (group: ActiveGroup): boolean =>
  group.startTime !== undefined && group.spawnedCount >= group.events.length;

// Сколько опыта нужно, чтобы перейти со level на следующий уровень. Стандартная игровая кривая:
// base × level^1.5 (округление вниз) — требования растут с каждым уровнем, но не удваиваются.
// Читает config в момент вызова — ползунок LEVEL_XP_BASE применяется к следующему повышению.
export const needForLevelUp = (level: number): number =>
  Math.round(config.LEVEL_XP_BASE * Math.pow(level, 1.5));

export const createGame = ({
  world,
  eventQueue,
  scene,
  playerHandle,
  sparks,
  sound,
  hud,
  showDamageNumber,
  waves,
  startWaveNumber,
  onWaveStart,
}: GameParams): Game => {
  const enemies: Enemies = new Map();
  const projectiles: Projectiles = new Map();
  const corpses: Corpses = new Map();

  // Хуки шага физики: отскочивший снаряд пролетает сквозь врага, в которого только что попал
  // (см. createProjectileHooks в projectiles.ts).
  const projectileHooks = createProjectileHooks(projectiles);

  // Объект один на всю игру, меняем его поля. Настоящие стартовые значения выставляет startGame.
  const state: GameState = {
    mode: 'waves',
    waveNumber: startWaveNumber,
    gridSize: 0,
    strength: 1,
    level: 1,
    xp: 0,
    waveTime: 0,
    groups: [],
    fireTimer: 0,
    status: 'playing',
  };

  // ─── ПРОКАЧКА ──────────────────────────────────────────────────────────────

  // Начисляет опыт за убитого врага и двигает уровни. Пока уровень прокачивает только куб
  // (опыт и уровень на виду в HUD, см. hud.setProgress) — сами бонусы уровня добавятся позже.
  // Опыт сверх порога остаётся: за одну толпу можно перескочить несколько уровней сразу.
  const addExperience = (amount: number): void => {
    state.xp += amount;

    while (state.xp >= needForLevelUp(state.level)) {
      state.xp -= needForLevelUp(state.level);
      state.level += 1;
    }

    hud.setProgress({ level: state.level, xp: state.xp, needed: needForLevelUp(state.level) });
  };

  // ─── ПОЛИГОН ───────────────────────────────────────────────────────────────

  // Номер сетки и сколько её врагов ещё живо — в HUD вместо волны и группы.
  const showGridProgress = (): void => {
    hud.setPolygon({ number: state.waveNumber, alive: enemies.size, total: state.gridSize });
  };

  // Ставит сетку полигона номер gridNumber: враги типа POLYGON_ENEMY_KIND в узлах сетки
  // (getPolygonPoints), на полу — центр на половине стороны. Места не ищем: узлы не пересекаются
  // ни друг с другом, ни с кубом. Сила 1 — здоровье и опыт как у типа.
  const startGrid = (gridNumber: number): void => {
    const kindName = getPolygonKindName();
    const points = getPolygonPoints(kindName);
    const height = config.ENEMY_KINDS[kindName].size / 2;

    for (const { x, z } of points) {
      spawnEnemy({
        world,
        scene,
        entities: enemies,
        position: { x, y: height, z },
        kindName,
        isPinned: config.POLYGON_PINNED,
      });
    }

    state.waveNumber = gridNumber;
    state.gridSize = points.length;
    showGridProgress();
  };

  // Сетка убита — сразу встаёт следующая. Пустая сетка (ни один узел не влез на арену) не сменяется:
  // иначе номер сетки рос бы каждый шаг. Её перестроит кнопка «Пересоздать сетку» после правки параметров.
  const refillGrid = (): void => {
    if (enemies.size === 0 && state.gridSize > 0) {
      startGrid(state.waveNumber + 1);
    }
  };

  // Враг убит — попаданием или выброской за арену: опыт за него, а на полигоне — ещё и счётчик
  // живых врагов в HUD (враг к этому моменту уже переведён в призраки).
  const countKill = (enemy: Enemy): void => {
    addExperience(enemy.kind.xp);

    if (state.mode === 'polygon') {
      showGridProgress();
    }
  };

  // ─── ВОЛНЫ ─────────────────────────────────────────────────────────────────

  // Начинает волну со сквозным номером waveNumber: состав — из списка по кругу, а число врагов и их сила —
  // по номеру (см. getWaveScale): первый проход по списку идёт как записан, дальше волны всё тяжелее.
  const startWave = (waveNumber: number): void => {
    const wave = waves[(waveNumber - 1) % waves.length];
    const scale = getWaveScale({ wave, waveNumber, cycleLength: waves.length });

    state.waveNumber = waveNumber;
    state.strength = scale.strength;
    state.waveTime = 0;
    state.groups = buildWaveSchedule(wave, scale.count).map((group) => ({ ...group, spawnedCount: 0 }));
    hud.setWave({ number: waveNumber });
    hud.setGroup({ number: 0, total: state.groups.length });
    onWaveStart(waveNumber);
  };

  // Начинает группы, которым пора. Группы идут строго по порядку списка, и очередная начинается,
  // когда наступит раньше одно из двух:
  //   истекла её задержка delay от начала волны;
  //   все предыдущие группы уже полностью появились и все враги на арене убиты — ждать задержку незачем.
  // У первой группы предыдущих нет, поэтому она начинается только по задержке: delay первой группы —
  // пауза перед волной. Группа, которая ещё появляется по одному, не считается убитой, пока не появились
  // все её враги, — иначе смерть первого же врага запускала бы следующую группу.
  // За один шаг может начаться несколько групп подряд — например, если у нескольких уже истекли задержки.
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
  // За один шаг их может быть несколько — например, когда группа появляется вся разом.
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

    // Лимит появлений за шаг (SPAWN_PER_STEP): огромная группа выходит порциями несколько шагов подряд —
    // на глаз это мгновенное появление, а шаг не проваливается на секунды из-за поиска мест в толпе.
    // Невыпущенные события ждут следующего шага: spawnedCount не двигается, порядок и условия
    // появления не меняются, только скорость выдачи. 0 — без лимита.
    const budget = config.SPAWN_PER_STEP > 0 ? Math.max(1, Math.floor(config.SPAWN_PER_STEP)) : Infinity;

    // Точку из расписания двигаем к свободному месту, если там уже кто-то: сначала вверх столбом над ней,
    // потом в стороны (см. spawn-placement.ts). Подборщик мест строится один раз на шаг
    // и сам учитывает врагов, которые появляются в этом же шаге.
    const placeEnemy = createSpawnPlacer(enemies);

    // Сколько врагов каждой группы выпустить в этом шаге: по порядку групп, пока хватает бюджета.
    // Остаток (и следующие группы) появятся в следующих шагах.
    const spawnCounts = dueCounts.reduce<number[]>((counts, dueCount) => {
      const spent = counts.reduce((sum, count) => sum + count, 0);

      return [...counts, Math.min(dueCount, budget - spent)];
    }, []);

    for (const [index, group] of state.groups.entries()) {
      const spawnCount = spawnCounts[index];

      for (const event of group.events.slice(group.spawnedCount, group.spawnedCount + spawnCount)) {
        const position = placeEnemy({ point: event, size: config.ENEMY_KINDS[event.kindName].size });

        spawnEnemy({ world, scene, entities: enemies, position, kindName: event.kindName, strength: state.strength });
      }

      group.spawnedCount += spawnCount;
    }
  };

  const loseGame = (): void => {
    state.status = 'lost';

    hud.showEndScreen({
      title: `Поражение — волна ${state.waveNumber}`,
      hint: 'Нажми, чтобы начать заново',
    });
  };

  // Волна закончена, когда все её группы начались, все их враги появились и все убиты.
  // Следующая начинается сразу. После последней волны списка составы идут сначала, а номер у игрока
  // продолжается сквозной (11, 12, 13 …) — и с ним растёт сила волн.
  const advanceWave = (): void => {
    const isWaveCleared = state.groups.every(isGroupFullySpawned) && enemies.size === 0;

    if (!isWaveCleared) {
      return;
    }

    startWave(state.waveNumber + 1);
  };

  // ─── СТРЕЛЬБА И СТОЛКНОВЕНИЯ ───────────────────────────────────────────────

  // Раз в config.FIRE_INTERVAL секунд выпускаем залп: до config.PROJECTILE_COUNT снарядов — по одному
  // на разных ближайших врагов, которых летящие снаряды ещё не добьют (см. findTargets в projectiles.ts).
  // Отсчёт и перенос остатка между шагами — runFireTimer в projectiles.ts. Возвращает, сколько снарядов
  // выпущено: 0 — стрелять не в кого.
  const fireVolley = (): number => {
    const targets = findTargets({
      enemies,
      projectiles,
      count: config.PROJECTILE_COUNT,
    });

    if (targets.length === 0) {
      return 0;
    }

    // Залп — и один звук выстрела на весь залп.
    fireProjectiles({ world, scene, entities: projectiles, targets });
    sound.playShot();

    return targets.length;
  };

  // Наносит урон врагу и показывает число урона чуть выше его полоски здоровья.
  // Точку берём у тела, а не у меша: меши догоняют тела раз в кадр, после всех шагов, и на ускорении
  // число появлялось бы там, где враг был в начале кадра. Высота полоски задана относительно врага.
  // isCrit — критическое ли попадание: число показывается другим цветом и крупнее.
  const hitEnemy = ({ enemy, damage, isCrit }: { enemy: Enemy; damage: number; isCrit: boolean }): void => {
    damageEnemy(enemy, damage);

    const { x, y, z } = enemy.body.translation();
    const position = new THREE.Vector3(x, y + enemy.hpBar.group.position.y + config.DAMAGE_NUMBER_HEIGHT, z);

    showDamageNumber({ position, damage, isCrit });
  };

  // Применяет одно попадание. Толчок врагу уже передала физика в этом шаге, когда пуля в него врезалась, —
  // здесь только игровая логика: искры в точке удара, враг получает урон (и звук попадания), а если здоровье
  // кончилось, становится призраком (и летит дальше с тем импульсом, что дала ему последняя пуля).
  // Дальше пуля отскакивает в ближайшего врага, если у неё остались отскоки (см. bounceProjectile), иначе
  // исчезает: после удара она почти остановилась и иначе зависла бы в воздухе.
  const applyHit = ({ enemyHandle, projectileHandle }: Hit): void => {
    const projectile = projectiles.get(projectileHandle);

    if (!projectile) {
      return;
    }

    // Урон и критичность брошены при выстреле (см. Projectile.isCrit) и не меняются на отскоках.
    const { damage, isCrit } = projectile;
    const enemy = enemies.get(enemyHandle);

    // Искры — до отскока пули: её центр в момент столкновения и есть точка удара. Если врага
    // в списке уже нет, sparks.spawn поднимет искры на поверхность призрака сам (или возьмёт
    // точку пули). Крит-попадание даёт больше, быстрее и другой цвет искр.
    sparks.spawn({ projectilePosition: projectile.body.translation(), enemy, isCrit });

    // Враг уже погиб от предыдущей пули в этом же шаге — урона по призраку нет, но пуля всё равно
    // обо что-то ударилась и может отскочить.
    if (enemy) {
      hitEnemy({ enemy, damage, isCrit });

      // Звук попадания — только по живому врагу: по призраку урон не наносится, это не «попадание».
      sound.playHit();

      if (enemy.hp <= 0) {
        turnIntoCorpse({ world, enemies, corpses, handle: enemyHandle });

        // Звук смерти — сразу за звуком попадания: пуля добила врага. Опыт — по типу врага.
        sound.playDeath();
        countKill(enemy);
      }
    }

    // Отскок — после урона: добитый враг уже не в списке и не станет целью отскока.
    const isBounced = bounceProjectile({ world, projectile, hitHandle: enemyHandle, enemies });

    if (!isBounced) {
      removeEntity({ world, scene, entities: projectiles, handle: projectileHandle });
    }
  };

  // Разбираем столкновения, которые Rapier нашёл за последний шаг.
  // События приходят парами handle-ов коллайдеров в произвольном порядке, а нас интересуют две пары:
  // «враг + снаряд» — попадание; «враг + игрок» — поражение (только в режиме волн: полигон — тренировка,
  // проигрыша там нет). Остальные пары (враг с полом, враги между собой) события не создают:
  // флаг событий есть только у игрока и снарядов.
  const handleCollisions = (): void => {
    // Менять физический мир прямо во время обхода событий небезопасно: удалять тела, толкать их,
    // менять группы. Поэтому попадания сначала собираем, а применяем после обхода.
    const hits: Hit[] = [];

    // Снаряды, чьё попадание в этом шаге уже записано. Если пуля в одном шаге задела двоих, урон получает
    // только первый: отскок разворачивает её один раз за шаг.
    const hitProjectiles = new Set<ColliderHandle>();

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
        if (state.mode === 'waves') {
          loseGame();
        }

        return;
      }

      if (projectiles.has(otherHandle) && !hitProjectiles.has(otherHandle)) {
        hitProjectiles.add(otherHandle);
        hits.push({ enemyHandle, projectileHandle: otherHandle });
      }
    });

    for (const hit of hits) {
      applyHit(hit);
    }
  };

  // ─── ШАГ И СТАРТ ───────────────────────────────────────────────────────────

  const update = (delta: number): void => {
    // После конца игры всё замирает — в том числе посреди кадра, если враг добрался до игрока
    // на одном из его шагов.
    if (state.status !== 'playing') {
      return;
    }

    // На полигоне враги стоят сеткой: расписания появлений нет, к кубу они не идут.
    const isPolygon = state.mode === 'polygon';

    if (!isPolygon) {
      spawnScheduledEnemies(delta);
    }

    state.fireTimer = runFireTimer({ timer: state.fireTimer, delta, fireVolley });

    if (!isPolygon) {
      moveEnemies({ world, enemies, delta });
    }

    // Продвигаем симуляцию на delta секунд: двигаем тела, разрешаем столкновения
    // и складываем события о них в eventQueue. Хуки отключают контакт отскочившего снаряда
    // с только что задетым врагом.
    world.timestep = delta;
    world.step(eventQueue, projectileHooks);

    handleCollisions();

    // Если в этом шаге враг добрался до игрока, игра уже окончена — дальше не продолжаем.
    if (state.status !== 'playing') {
      return;
    }

    // Враг, пересёкший край арены, сразу погибает и летит дальше призраком. Звук смерти — один на шаг,
    // если погиб хоть кто-то (массовую гибель сдерживает пауза MIN_GAP_MS в sound.ts).
    const corpsesBefore = corpses.size;

    // Враги, покинувшие арену, погибают сразу — это убийство, за него тоже начисляется опыт.
    for (const enemy of turnOutOfArenaIntoCorpses({ world, enemies, corpses })) {
      countKill(enemy);
    }

    if (corpses.size > corpsesBefore) {
      sound.playDeath();
    }

    // Призраки, улетевшие слишком глубоко, удаляются — дальше они падали бы вечно.
    removeFallenEntities({ world, scene, entities: corpses });
    updateCorpses({ world, scene, entities: corpses, delta });
    removeFarProjectiles({ world, scene, entities: projectiles });

    // Искры живут в игровом времени: на паузе замирают, при ускорении — летят быстрее.
    sparks.update(delta);

    if (isPolygon) {
      refillGrid();
    } else {
      advanceWave();
    }
  };

  // Общее начало игры и полигона: арена пустеет (враги, снаряды, призраки, искры), прокачка
  // и отсчёт до залпа обнуляются, экран поражения прячется.
  const resetArena = (): void => {
    removeAllEntities({ world, scene, entities: enemies });
    removeAllEntities({ world, scene, entities: projectiles });
    removeAllEntities({ world, scene, entities: corpses });
    sparks.clear();
    state.fireTimer = 0;
    state.status = 'playing';
    state.level = 1;
    state.xp = 0;
    hud.hideEndScreen();
    hud.setProgress({ level: 1, xp: 0, needed: needForLevelUp(1) });
  };

  const startGame = (waveNumber: number = startWaveNumber): void => {
    resetArena();
    state.mode = 'waves';
    state.gridSize = 0;
    startWave(waveNumber);
  };

  // Полигону волны не нужны: групп нет, сила 1, время волны не идёт в расчёт.
  const startPolygon = (): void => {
    resetArena();
    state.mode = 'polygon';
    state.strength = 1;
    state.waveTime = 0;
    state.groups = [];
    startGrid(1);
  };

  return { state, enemies, projectiles, corpses, startGame, startPolygon, update };
};
