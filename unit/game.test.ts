// Юнит-тесты игровой логики (src/game.ts) на headless-Rapier: волны и их круги, группы, лимит появлений,
// стрельба, попадания и поражение. HUD, звук и цифры урона — заглушки vi.fn.
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { config } from '@/config';
import type { Enemies } from '@/enemies';
import { createGame, needForLevelUp, type Game } from '@/game';
import type { Hud } from '@/hud';
import { createPlayer } from '@/player';
import { createSparks } from '@/sparks';
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
};

const createTestGame = async ({ waves }: { waves: Wave[] }): Promise<TestGame> => {
  const { world, eventQueue, scene } = await createTestWorld();
  const hud = {
    setWave: vi.fn(),
    setGroup: vi.fn(),
    setProgress: vi.fn(),
    showEndScreen: vi.fn(),
    hideEndScreen: vi.fn(),
    setVisible: vi.fn(),
  };
  const showDamageNumber = vi.fn();

  const game = createGame({
    world,
    eventQueue,
    scene,
    playerHandle: createPlayer({ world, scene }),
    sparks: createSparks({ scene }),
    sound: { playHit: vi.fn(), playShot: vi.fn(), playDeath: vi.fn() },
    hud,
    showDamageNumber,
    waves,
    startWaveNumber: 1,
    onWaveStart: vi.fn(),
  });

  game.startGame();

  return { game, hud, showDamageNumber };
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
