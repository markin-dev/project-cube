// Юнит-тесты игровой логики (src/game.ts) на headless-Rapier: волны и их круги, группы, лимит появлений,
// стрельба, попадания и поражение. HUD, звук и цифры урона — заглушки vi.fn.
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { config } from '@/config';
import type { Enemies } from '@/enemies';
import { createGame, type Game } from '@/game';
import type { Hud } from '@/hud';
import { createPlayer } from '@/player';
import { createSparks } from '@/sparks';
import type { Wave } from '@/waves';
import { createTestWorld } from './fixtures';

const STEP = 1 / 60;

const ONE_ENEMY_WAVE: Wave = {
  groups: [{ shape: { type: 'random', count: 1 }, enemy: 'normal' }],
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
    startWaveIndex: 0,
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

afterEach(() => vi.clearAllMocks());

it('Должен показать номер стартовой волны', async () => {
  const { hud } = await createTestGame({ waves: [ONE_ENEMY_WAVE, ONE_ENEMY_WAVE] });

  expect(hud.setWave).toHaveBeenCalledWith({ number: 1, multiplier: 1 });
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

    runSteps(game, 1);
    pushOutOfArena(game.enemies);
    runSteps(game, 1);

    expect(game.state.waveIndex).toBe(1);
  });

  it('Должен начать новый круг с первой волны после последней', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);
    pushOutOfArena(game.enemies);
    runSteps(game, 1);

    expect(game.state.waveIndex).toBe(0);
    expect(game.state.round).toBe(2);
    expect(game.state.status).toBe('playing');
  });

  it('Должен показать сквозной номер волны и множитель нового круга', async () => {
    const { game, hud } = await createTestGame({ waves: [ONE_ENEMY_WAVE, ONE_ENEMY_WAVE] });

    // Две волны в круге: добиваем обе — игра возвращается к первой, но номер на экране 3 и множитель 2.
    for (let wave = 0; wave < 2; wave += 1) {
      runSteps(game, 1);
      pushOutOfArena(game.enemies);
      runSteps(game, 1);
    }

    expect(hud.setWave).toHaveBeenLastCalledWith({ number: 3, multiplier: 2 });
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

it('startGame: Должен очистить арену', async () => {
  const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

  runSteps(game, 1);
  game.startGame();

  expect(game.enemies.size).toBe(0);
});
