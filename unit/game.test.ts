// Юнит-тесты игровой логики (src/game.ts) на headless-Rapier: волны и группы, лимит появлений,
// стрельба, попадания, победа и поражение. HUD, звук и цифры урона — заглушки vi.fn.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import type { Enemies } from '../src/enemies';
import { createGame, type Game } from '../src/game';
import { createPlayer } from '../src/player';
import { createSparks } from '../src/sparks';
import type { Wave } from '../src/waves';
import { createTestWorld } from './fixtures';

const STEP = 1 / 60;

const ONE_ENEMY_WAVE: Wave = {
  name: 'Один',
  groups: [{ shape: { type: 'random', count: 1 }, enemy: 'normal' }],
};

const TWO_GROUPS_WAVE: Wave = {
  name: 'Две группы',
  groups: [
    { shape: { type: 'random', count: 1 }, enemy: 'normal' },
    { shape: { type: 'random', count: 1 }, enemy: 'normal', delay: 100 },
  ],
};

const createTestGame = async ({ waves }: { waves: Wave[] }) => {
  const { world, eventQueue, scene } = await createTestWorld();
  const hud = { setWave: vi.fn(), setGroup: vi.fn(), showEndScreen: vi.fn(), hideEndScreen: vi.fn() };
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

it('Должен показать номер и название стартовой волны', async () => {
  const { hud } = await createTestGame({ waves: [ONE_ENEMY_WAVE, ONE_ENEMY_WAVE] });

  expect(hud.setWave).toHaveBeenCalledWith({ number: 1, total: 2, name: 'Один' });
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
      waves: [{ name: 'Тройка', groups: [{ shape: { type: 'random', count: 3 }, enemy: 'normal' }] }],
    });

    runSteps(game, 1);

    expect(game.enemies.size).toBe(3);
  });

  it('Должен выпускать за шаг не больше SPAWN_PER_STEP врагов', async () => {
    config.SPAWN_PER_STEP = 10;

    const { game } = await createTestGame({
      waves: [{ name: 'Толпа', groups: [{ shape: { type: 'random', count: 25 }, enemy: 'tiny' }] }],
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

  it('Должен объявить победу после последней волны', async () => {
    const { game } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);
    pushOutOfArena(game.enemies);
    runSteps(game, 1);

    expect(game.state.status).toBe('won');
  });

  it('Должен показать экран победы с верными параметрами', async () => {
    const { game, hud } = await createTestGame({ waves: [ONE_ENEMY_WAVE] });

    runSteps(game, 1);
    pushOutOfArena(game.enemies);
    runSteps(game, 1);

    expect(hud.showEndScreen).toHaveBeenCalledWith({
      title: 'Победа!',
      hint: 'Все волны пройдены. Нажми, чтобы сыграть ещё раз',
    });
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
    pushOutOfArena(game.enemies);
    runSteps(game, 1);

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
