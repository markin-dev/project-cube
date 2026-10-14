// Юнит-тесты отсчёта до залпа (runFireTimer в src/projectiles.ts): темп стрельбы не должен зависеть
// от длины шага симуляции, то есть от частоты кадров и выбранной скорости игры.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, MIN_FIRE_INTERVAL } from '../src/config';
import { runFireTimer } from '../src/projectiles';

const SIMULATED_SECONDS = 30;

// Сколько залпов в секунду выходит при шаге step, если стрелять всегда есть в кого.
const getVolleysPerSecond = (step: number): number => {
  const fireVolley = vi.fn((): boolean => true);
  const stepsCount = Math.round(SIMULATED_SECONDS / step);

  Array.from({ length: stepsCount }).reduce<number>(
    (timer) => runFireTimer({ timer, delta: step, fireVolley }),
    0,
  );

  return fireVolley.mock.calls.length / SIMULATED_SECONDS;
};

afterEach(() => vi.clearAllMocks());

beforeEach(() => {
  config.FIRE_INTERVAL = 0.1;
});

describe('runFireTimer', () => {
  it.each([
    ['1/30 (×8 или 30 FPS)', 1 / 30],
    ['1/60 (×1 на 60 Гц)', 1 / 60],
    ['1/144 (×1 на 144 Гц)', 1 / 144],
  ])('Должен давать 10 залпов в секунду при шаге %s', (_, step) => {
    expect(getVolleysPerSecond(step)).toBeCloseTo(10, 1);
  });

  it('Должен выпускать несколько залпов за шаг, если пауза короче шага', () => {
    config.FIRE_INTERVAL = 0.025;

    expect(getVolleysPerSecond(1 / 30)).toBeCloseTo(40, 1);
  });

  it('Должен стрелять не чаще MIN_FIRE_INTERVAL', () => {
    config.FIRE_INTERVAL = 0.0001;

    expect(getVolleysPerSecond(1 / 30)).toBeCloseTo(1 / MIN_FIRE_INTERVAL, 1);
  });

  it('Должен держать отсчёт на нуле, пока стрелять не в кого', () => {
    expect(runFireTimer({ timer: 0, delta: 1 / 30, fireVolley: (): boolean => false })).toBe(0);
  });

  it('Должен выпустить один залп, когда цель появилась после ожидания', () => {
    const fireVolley = vi.fn((): boolean => true);

    runFireTimer({ timer: 0, delta: 1 / 30, fireVolley });

    expect(fireVolley).toHaveBeenCalledTimes(1);
  });
});
