// Юнит-тесты игровой логики (src/game.ts) на headless-Rapier: волны и их круги, группы, лимит появлений,
// стрельба, попадания и отскоки, поражение, полигон. HUD, звук и цифры урона — заглушки vi.fn.
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { config } from '@/config';
import type { Enemies } from '@/enemies';
import { createGame, needForLevelUp, type Game } from '@/game';
import type { Hud } from '@/hud';
import { createPlayer } from '@/player';
import { getPolygonPoints } from '@/polygon';
import { createSparks } from '@/sparks';
import { createBonuses, RARITIES, UPGRADE_STATS, type UpgradeStat } from '@/upgrades';
import type { Wave } from '@/waves';
import { createTestWorld } from './fixtures';

const STEP = 1 / 60;

const ONE_ENEMY_WAVE: Wave = {
  groups: [{ shape: { type: 'random', count: 1 }, enemy: 'normal' }],
};

const ONE_TINY_WAVE: Wave = {
  groups: [{ shape: { type: 'random', count: 1 }, enemy: 'tiny' }],
};

const TWO_GROUPS_WAVE: Wave = {
  groups: [
    { shape: { type: 'random', count: 1 }, enemy: 'normal' },
    { shape: { type: 'random', count: 1 }, enemy: 'normal', delay: 100 },
  ],
};

// Игра с заглушками интерфейса — их вызовы проверяют тесты.
type TestGame = {
  game: Game;
  hud: Record<keyof Hud, Mock>;
  showDamageNumber: Mock;
  onLevelUp: Mock;
  upgradeUi: Record<'showOffer' | 'hideOffer' | 'setStats', Mock>;
};

// Выбор усилений ставит игру на паузу на каждом новом уровне — тестам волн, боя и полигона он мешает,
// поэтому по умолчанию выключен; тесты усилений включают его явно (isUpgradesEnabled).
const createTestGame = async ({
  waves,
  isUpgradesEnabled = false,
}: {
  waves: Wave[];
  isUpgradesEnabled?: boolean;
}): Promise<TestGame> => {
  config.UPGRADES_ENABLED = isUpgradesEnabled;

  const { world, eventQueue, scene } = await createTestWorld();
  const hud = {
    setWave: vi.fn(),
    setGroup: vi.fn(),
    setPolygon: vi.fn(),
    setProgress: vi.fn(),
    showEndScreen: vi.fn(),
    hideEndScreen: vi.fn(),
    setVisible: vi.fn(),
  };
  const showDamageNumber = vi.fn();
  const onLevelUp = vi.fn();
  const upgradeUi = { showOffer: vi.fn(), hideOffer: vi.fn(), setStats: vi.fn() };

  const game = createGame({
    world,
    eventQueue,
    scene,
    playerHandle: createPlayer({ world, scene }).handle,
    sparks: createSparks({ scene }),
    sound: { playHit: vi.fn(), playShot: vi.fn(), playDeath: vi.fn() },
    hud,
    showDamageNumber,
    waves,
    onWaveStart: vi.fn(),
    upgradeUi,
    onLevelUp,
  });

  game.startGame();

  return { game, hud, showDamageNumber, onLevelUp, upgradeUi };
};

const runSteps = (game: Game, count: number): void => {
  Array.from({ length: count }).forEach((): void => game.update(STEP));
};

// Шагает, пока условие не выполнится, но не дольше maxSeconds игрового времени.
const runUntil = ({ game, isDone, maxSeconds }: { game: Game; isDone: () => boolean; maxSeconds: number }): void => {
  Array.from({ length: Math.round(maxSeconds / STEP) }).some((): boolean => {
    game.update(STEP);

    return isDone();
  });
};

// Выносит всех живых врагов за край арены — на следующем шаге они погибнут.
const pushOutOfArena = (enemies: Enemies): void => {
  for (const { body } of enemies.values()) {
    body.setTranslation({ x: 100, y: 1, z: 0 }, true);
  }
};

// Проходит текущую волну из одной группы, выпускающей всех разом: враги появляются и тут же
// погибают за краем арены — на последнем шаге уже начинается следующая волна.
const clearWave = (game: Game): void => {
  runSteps(game, 1);
  pushOutOfArena(game.enemies);
  runSteps(game, 1);
};

// Игра, сразу переведённая на полигон (сетка из POLYGON_ENEMY_COUNT врагов уже стоит).
const createPolygonGame = async (): Promise<TestGame> => {
  const testGame = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

  testGame.game.startPolygon();

  return testGame;
};

// Насколько каждый живой враг сдвинулся по полу от точки (x, z) из списка points (по порядку).
const getShifts = (game: Game, points: Array<{ x: number; z: number }>): number[] =>
  [...game.enemies.values()].map(({ body }, index) => {
    const { x, z } = body.translation();

    return Math.hypot(x - points[index].x, z - points[index].z);
  });

// Точки, где сейчас стоят живые враги, — снимок, чтобы потом сравнить с getShifts.
const getEnemyPoints = (game: Game): Array<{ x: number; z: number }> =>
  [...game.enemies.values()].map(({ body }) => {
    const { x, z } = body.translation();

    return { x, z };
  });

// Полигон для отскоков: закреплённые обычные враги на 1000 HP (не умрут и не отлетят) стоят в точках
// positions, куб делает один выстрел за секунду, у снаряда bounces отскоков.
const createBounceGame = async ({
  positions,
  bounces,
}: {
  positions: Array<{ x: number; z: number }>;
  bounces: number;
}): Promise<TestGame> => {
  config.POLYGON_PINNED = true;
  config.POLYGON_ENEMY_COUNT = positions.length;
  config.ENEMY_KINDS.normal.hp = 1000;
  config.FIRE_INTERVAL = 1;
  config.PROJECTILE_BOUNCES = bounces;

  const testGame = await createPolygonGame();

  [...testGame.game.enemies.values()].forEach(({ body }, index): void => {
    body.setTranslation({ x: positions[index].x, y: 0.4, z: positions[index].z }, true);
  });

  return testGame;
};

// Сколько попаданий даст один выстрел: шагаем чуть меньше секунды — второго залпа ещё не было.
const countHitsOfOneShot = (testGame: TestGame): number => {
  runSteps(testGame.game, 57);

  return testGame.showDamageNumber.mock.calls.length;
};

// Оставляет в UPGRADE_VALUES только усиление stat с прибавкой amount на всех редкостях, остальные — 0:
// выбор тогда предсказуем — одна карточка.
const allowOnlyUpgrade = (stat: UpgradeStat, amount: number): void => {
  for (const name of UPGRADE_STATS) {
    for (const rarity of RARITIES) {
      config.UPGRADE_VALUES[name][rarity] = name === stat ? amount : 0;
    }
  }
};

// Игра с выбором усилений, где первый же убитый враг даёт уровень: база опыта 4 (пороги 4, 11, 21),
// первая волна — крошка (5 опыта — ровно один уровень). Крошка вылетает за арену на втором шаге — выбор открыт.
const createGameWithOffer = async (waves: Wave[] = [ONE_TINY_WAVE, ONE_ENEMY_WAVE]): Promise<TestGame> => {
  config.LEVEL_XP_BASE = 4;

  const testGame = await createTestGame({ waves, isUpgradesEnabled: true });

  clearWave(testGame.game);

  return testGame;
};

afterEach(() => vi.clearAllMocks());

it('Должен показать номер стартовой волны', async () => {
  const { hud } = await createTestGame({ waves: [ONE_ENEMY_WAVE, ONE_ENEMY_WAVE] });

  expect(hud.setWave).toHaveBeenCalledWith({ number: 1 });
});

describe('группы волны', () => {
  it('Должен начать следующую группу раньше её delay, если предыдущие убиты', async () => {
    const { game } = await createTestGame({ waves: [TWO_GROUPS_WAVE] });

    runSteps(game, 1);
    pushOutOfArena(game.enemies);
    runSteps(game, 2);

    expect(game.state.groups[1].startTime).toBeLessThan(1);
  });

  it('Должен выпустить группу без задержки на первом шаге', async () => {
    const { game } = await createTestGame({
      waves: [{ groups: [{ shape: { type: 'random', count: 3 }, enemy: 'normal' }] }],
    });

    runSteps(game, 1);

    expect(game.enemies.size).toBe(3);
  });

  it('Должен выпускать за шаг не больше SPAWN_PER_STEP врагов', async () => {
    config.SPAWN_PER_STEP = 10;

    const { game } = await createTestGame({
      waves: [{ groups: [{ shape: { type: 'random', count: 25 }, enemy: 'tiny' }] }],
    });

    runSteps(game, 1);

    expect(game.enemies.size).toBe(10);
  });
});

describe('конец волны', () => {
  it('Должен перейти к следующей волне, когда враги текущей убиты', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE, ONE_ENEMY_WAVE] });

    clearWave(game);

    expect(game.state.waveNumber).toBe(2);
  });

  it('Должен после последней волны списка снова взять состав первой', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE, ONE_TINY_WAVE] });

    // Две волны в списке: добиваем обе — третья берёт состав первой (normal), а не второй (tiny).
    clearWave(game);
    clearWave(game);

    expect(new Set(game.state.groups[0].events.map(({ kindName }) => kindName))).toEqual(new Set(['normal']));
  });

  it('Должен показать сквозной номер волны после последней волны списка', async () => {
    const { game, hud } = await createTestGame({ waves: [ONE_ENEMY_WAVE, ONE_ENEMY_WAVE] });

    clearWave(game);
    clearWave(game);

    expect(hud.setWave).toHaveBeenLastCalledWith({ number: 3 });
  });
});

describe('рост волн', () => {
  it('Должен выпустить врагов волны после круга крепче', async () => {
    // Волна после круга — бюджет 160 против записанных 40 (один normal): рост ×4 целиком в крепость.
    config.WAVE_ENDLESS_BUDGET = 160;
    config.WAVE_COUNT_SHARE = 0;

    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    clearWave(game);
    runSteps(game, 1);

    expect([...game.enemies.values()].map(({ hp }) => hp)).toEqual([160]);
  });

  it('Должен выпустить больше врагов в волне после круга', async () => {
    // Тот же рост ×4, но целиком в число врагов.
    config.WAVE_ENDLESS_BUDGET = 160;
    config.WAVE_COUNT_SHARE = 1;

    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    clearWave(game);
    runSteps(game, 1);

    expect(game.enemies.size).toBe(4);
  });
});

describe('бой', () => {
  it('Должен выстрелить по появившемуся врагу', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);

    expect(game.projectiles.size).toBe(1);
  });

  it('Должен показать цифру урона при попадании', async () => {
    const { game, showDamageNumber } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runUntil({ game, isDone: () => showDamageNumber.mock.calls.length > 0, maxSeconds: 3 });

    expect(showDamageNumber).toHaveBeenCalled();
  });

  it('Должен проиграть, когда враг коснулся игрока', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);

    for (const { body } of game.enemies.values()) {
      body.setTranslation({ x: 0.8, y: 0.4, z: 0 }, true);
    }

    runUntil({ game, isDone: () => game.state.status !== 'playing', maxSeconds: 1 });

    expect(game.state.status).toBe('lost');
  });
});

describe('прокачка', () => {
  it('Должен начислить опыт за убитого попаданием врага', async () => {
    const { game } = await createTestGame({ waves: [ONE_TINY_WAVE] });

    runUntil({ game, isDone: () => game.enemies.size === 0, maxSeconds: 5 });

    // ONE_TINY_WAVE — крошка, её опыт 5: меньше порога первого уровня, весь остаётся в xp.
    expect(game.state.xp).toBe(5);
  });

  it('Должен начислить опыт за врага, выброшенного за арену', async () => {
    const { game } = await createTestGame({ waves: [ONE_TINY_WAVE] });

    clearWave(game);

    expect(game.state.xp).toBe(5);
  });

  it('Должен поднять уровень, когда опыт перешёл порог', async () => {
    config.LEVEL_XP_BASE = 10;

    const { game, hud } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    // Опыта normal (20) хватает на уровень 2 (порт 10), остаток 10 копится на третий.
    runUntil({ game, isDone: () => game.enemies.size === 0, maxSeconds: 5 });

    expect(game.state.level).toBe(2);
    expect(game.state.xp).toBe(10);
    expect(hud.setProgress).toHaveBeenLastCalledWith({ level: 2, xp: 10, needed: needForLevelUp(2) });
  });

  it('Должен сообщить о новом уровне', async () => {
    config.LEVEL_XP_BASE = 10;

    const { game, onLevelUp } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runUntil({ game, isDone: () => game.enemies.size === 0, maxSeconds: 5 });

    expect(onLevelUp).toHaveBeenCalledWith(2);
  });

  it('Должен сообщить один раз о последнем уровне, если их несколько сразу', async () => {
    // База 5: пороги 5 и 14 — опыта normal (20) хватает на два уровня, до третьего.
    config.LEVEL_XP_BASE = 5;

    const { game, onLevelUp } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    clearWave(game);

    expect(onLevelUp).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('Не должен сообщать о новом уровне, пока опыта на него не хватает', async () => {
    const { game, onLevelUp } = await createTestGame({ waves: [ONE_TINY_WAVE] });

    clearWave(game);

    expect(onLevelUp).not.toHaveBeenCalled();
  });

  it('Должен показать опыт 0 и порог первого уровня при старте', async () => {
    const { game, hud } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);
    pushOutOfArena(game.enemies);
    runSteps(game, 1);

    game.startGame();

    expect(game.state.level).toBe(1);
    expect(game.state.xp).toBe(0);
    expect(hud.setProgress).toHaveBeenLastCalledWith({ level: 1, xp: 0, needed: needForLevelUp(1) });
  });
});

describe('update', () => {
  it('Не должен двигать время волны после конца игры', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);

    // Враг вплотную к кубу — поражение на ближайшем шаге.
    for (const { body } of game.enemies.values()) {
      body.setTranslation({ x: 0.8, y: 0.4, z: 0 }, true);
    }

    runUntil({ game, isDone: () => game.state.status === 'lost', maxSeconds: 1 });

    const finishedAt = game.state.waveTime;

    runSteps(game, 10);

    expect(game.state.waveTime).toBe(finishedAt);
  });
});

describe('startGame', () => {
  it('Должен очистить арену', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);
    game.startGame();

    expect(game.enemies.size).toBe(0);
  });

  it('Должен начать игру с переданного сквозного номера волны', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE, ONE_TINY_WAVE] });

    game.startGame(12);

    expect(game.state.waveNumber).toBe(12);
  });
});

describe('полигон', () => {
  it('Должен очистить арену от волны и построить сетку из POLYGON_ENEMY_COUNT врагов', async () => {
    config.POLYGON_ENEMY_COUNT = 10;

    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);
    game.startPolygon();

    expect(game.enemies.size).toBe(10);
  });

  it('Должен поставить врагов полигона в узлы сетки', async () => {
    config.POLYGON_ENEMY_COUNT = 10;

    const { game } = await createPolygonGame();

    expect(Math.max(...getShifts(game, getPolygonPoints('normal')))).toBeLessThan(1e-4);
  });

  it('Должен оставить врагов полигона на месте — к кубу они не идут', async () => {
    // Пули еле ползут и за 2 секунды ни до кого не долетят — двигать врагов может только их собственный ход.
    config.POLYGON_ENEMY_COUNT = 10;
    config.PROJECTILE_SPEED = 0.5;

    const { game } = await createPolygonGame();
    const points = getEnemyPoints(game);

    runSteps(game, 120);

    expect(Math.max(...getShifts(game, points))).toBeLessThan(1e-3);
  });

  describe('закреплённые враги', () => {
    it('Должен сделать врагов неподвижными телами при POLYGON_PINNED', async () => {
      config.POLYGON_PINNED = true;

      const { game } = await createPolygonGame();

      expect([...game.enemies.values()].every(({ body }) => body.isFixed())).toBe(true);
    });

    it('Должен наносить урон закреплённым врагам', async () => {
      config.POLYGON_PINNED = true;
      config.POLYGON_ENEMY_COUNT = 1;

      const { game, showDamageNumber } = await createPolygonGame();

      runUntil({ game, isDone: () => showDamageNumber.mock.calls.length > 0, maxSeconds: 3 });

      expect(showDamageNumber).toHaveBeenCalled();
    });

    it('Должен оставить закреплённого врага на месте после попадания', async () => {
      config.POLYGON_PINNED = true;
      config.POLYGON_ENEMY_COUNT = 1;

      const { game, showDamageNumber } = await createPolygonGame();
      const points = getEnemyPoints(game);

      runUntil({ game, isDone: () => showDamageNumber.mock.calls.length > 0, maxSeconds: 3 });

      expect(Math.max(...getShifts(game, points))).toBeLessThan(1e-6);
    });
  });

  describe('смена сеток', () => {
    it('Должен построить следующую сетку, когда прежняя убита', async () => {
      config.POLYGON_ENEMY_COUNT = 3;

      const { game } = await createPolygonGame();

      pushOutOfArena(game.enemies);
      runSteps(game, 1);

      expect(game.state.waveNumber).toBe(2);
    });

    it('Должен оставить пустую сетку без смены номера', async () => {
      // Отступ больше половины арены — ни одного узла: сетка пуста, но номер не растёт каждый шаг.
      config.ARENA_INSET = 20;

      const { game } = await createPolygonGame();

      runSteps(game, 5);

      expect(game.state.waveNumber).toBe(1);
    });
  });

  describe('HUD', () => {
    it('Должен показать номер сетки и число её врагов', async () => {
      config.POLYGON_ENEMY_COUNT = 4;

      const { hud } = await createPolygonGame();

      expect(hud.setPolygon).toHaveBeenLastCalledWith({ number: 1, alive: 4, total: 4 });
    });

    it('Должен уменьшить число живых врагов после убийства', async () => {
      config.POLYGON_ENEMY_COUNT = 4;

      const { game, hud } = await createPolygonGame();
      const [firstEnemy] = game.enemies.values();

      firstEnemy.body.setTranslation({ x: 100, y: 1, z: 0 }, true);
      runSteps(game, 1);

      expect(hud.setPolygon).toHaveBeenLastCalledWith({ number: 1, alive: 3, total: 4 });
    });
  });

  it('Должен начислить опыт за врага полигона', async () => {
    config.POLYGON_ENEMY_KIND = 'tiny';
    config.POLYGON_ENEMY_COUNT = 1;

    const { game } = await createPolygonGame();

    pushOutOfArena(game.enemies);
    runSteps(game, 1);

    expect(game.state.xp).toBe(config.ENEMY_KINDS.tiny.xp);
  });

  it('Должен продолжить игру, когда враг полигона коснулся куба', async () => {
    config.POLYGON_ENEMY_COUNT = 1;

    const { game } = await createPolygonGame();

    for (const { body } of game.enemies.values()) {
      body.setTranslation({ x: 0.8, y: 0.4, z: 0 }, true);
    }

    runSteps(game, 30);

    expect(game.state.status).toBe('playing');
  });

  it('Должен вернуться к волнам по startGame', async () => {
    const { game } = await createPolygonGame();

    game.startGame();

    expect(game.state.mode).toBe('waves');
  });
});

describe('отскок снаряда', () => {
  it('Должен отскочить во второго врага и попасть в него тем же выстрелом', async () => {
    const testGame = await createBounceGame({
      positions: [
        { x: 3, z: 0 },
        { x: 3, z: 2 },
      ],
      bounces: 1,
    });

    expect(countHitsOfOneShot(testGame)).toBe(2);
  });

  it('Должен убрать снаряд после попадания, если отскоков нет', async () => {
    const { game, showDamageNumber } = await createBounceGame({
      positions: [
        { x: 3, z: 0 },
        { x: 3, z: 2 },
      ],
      bounces: 0,
    });

    runUntil({ game, isDone: () => showDamageNumber.mock.calls.length > 0, maxSeconds: 1 });

    expect(game.projectiles.size).toBe(0);
  });

  it('Должен убрать снаряд, если отскакивать не в кого', async () => {
    const { game, showDamageNumber } = await createBounceGame({ positions: [{ x: 3, z: 0 }], bounces: 3 });

    runUntil({ game, isDone: () => showDamageNumber.mock.calls.length > 0, maxSeconds: 1 });

    expect(game.projectiles.size).toBe(0);
  });

  it('Должен пролететь сквозь задетого врага во врага за его спиной', async () => {
    const testGame = await createBounceGame({
      positions: [
        { x: 3, z: 0 },
        { x: 5, z: 0 },
      ],
      bounces: 1,
    });

    expect(countHitsOfOneShot(testGame)).toBe(2);
  });

  it('Должен скакать между двумя врагами, пока есть отскоки', async () => {
    // 3 отскока: первый враг → второй → снова первый → снова второй, всего 4 попадания.
    const testGame = await createBounceGame({
      positions: [
        { x: 3, z: 0 },
        { x: 3, z: 2 },
      ],
      bounces: 3,
    });

    expect(countHitsOfOneShot(testGame)).toBe(4);
  });
});

describe('усиления', () => {
  it('Должен открыть выбор усиления на новом уровне', async () => {
    const { game } = await createGameWithOffer();

    expect(game.state.offer).toHaveLength(config.UPGRADE_CHOICES);
  });

  it('Должен остановить игру, пока выбор открыт', async () => {
    const { game } = await createGameWithOffer();
    const waveTime = game.state.waveTime;

    runSteps(game, 10);

    expect(game.state.waveTime).toBe(waveTime);
  });

  it('Должен применить выбранное усиление', async () => {
    const { game } = await createGameWithOffer();
    const [card] = game.state.offer;

    game.chooseUpgrade(0);

    expect(game.state.bonuses[card.stat]).toBe(card.amount);
  });

  it('Должен закрыть выбор и продолжить игру после выбора', async () => {
    const { game } = await createGameWithOffer();

    game.chooseUpgrade(0);
    runSteps(game, 1);

    expect([game.state.offer.length, game.state.waveTime > 0]).toEqual([0, true]);
  });

  it('Должен проиграть анимацию уровня только после выбора', async () => {
    const { game, onLevelUp } = await createGameWithOffer();
    const callsBeforeChoice = onLevelUp.mock.calls.length;

    game.chooseUpgrade(0);

    expect([callsBeforeChoice, onLevelUp.mock.calls]).toEqual([0, [[2]]]);
  });

  it('Должен открыть выборы по очереди за несколько уровней сразу', async () => {
    // Пороги 4 и 11 — опыта обычного врага (20) хватает на два уровня сразу.
    const { game, upgradeUi } = await createGameWithOffer([ONE_ENEMY_WAVE]);

    game.chooseUpgrade(0);

    expect(upgradeUi.showOffer).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 3, left: game.state.pendingChoices }),
    );
  });

  it('Должен применять усиления к выстрелам', async () => {
    // Только урон +100%: урон 10 без критов превращается в 20.
    allowOnlyUpgrade('damage', 100);
    config.PROJECTILE_DAMAGE_MIN = 10;
    config.PROJECTILE_DAMAGE_MAX = 10;
    config.CRIT_CHANCE = 0;

    const { game, showDamageNumber } = await createGameWithOffer();

    game.chooseUpgrade(0);
    runUntil({ game, isDone: () => showDamageNumber.mock.calls.length > 0, maxSeconds: 5 });

    expect(showDamageNumber).toHaveBeenCalledWith(expect.objectContaining({ damage: 20 }));
  });

  it('Должен закрыть выбор без усиления, если выбор выключили', async () => {
    const { game } = await createGameWithOffer();

    config.UPGRADES_ENABLED = false;
    runSteps(game, 1);

    expect([game.state.offer.length, game.state.taken.length]).toEqual([0, 0]);
  });

  it('Должен обнулить усиления при новой игре', async () => {
    const { game } = await createGameWithOffer();

    game.chooseUpgrade(0);
    game.startGame();

    expect(game.state.bonuses).toEqual(createBonuses());
  });
});
