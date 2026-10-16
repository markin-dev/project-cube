// Юнит-тесты расписания волн (src/schedule.ts): getWaveBudget считает HP-бюджет волны, getWaveScale —
// во сколько раз волну со сквозным номером делают больше и крепче, buildWaveSchedule превращает описание
// волны в группы с задержкой и списком врагов (точка, время, тип); countDueEvents считает наступившие события.
import { describe, expect, it } from 'vitest';
import { config, ENEMY_KIND_NAMES } from '@/config';
import { buildWaveSchedule, countDueEvents, getWaveBudget, getWaveScale, type SpawnEvent } from '@/schedule';
import type { Wave } from '@/waves';

const FAKE_WAVE: Wave = {
  groups: [
    { shape: { type: 'random', count: 3 }, delay: 1.5, interval: 0.5, enemy: 'tiny' },
    { shape: { type: 'random', count: 4 } },
  ],
};

// Волна с бюджетом 100 HP: 2 small (40) + 1 normal (40) + 2 tiny (20).
const FAKE_BUDGET_WAVE: Wave = {
  groups: [
    { shape: { type: 'random', count: 2 }, enemy: 'small' },
    { shape: { type: 'random', count: 1 }, enemy: 'normal' },
    { shape: { type: 'random', count: 2 }, enemy: 'tiny' },
  ],
};

// Длина списка волн (обучающего круга) в тестах масштаба.
const FAKE_CYCLE_LENGTH = 10;

const FAKE_EVENTS: SpawnEvent[] = [0, 0.5, 1, 1, 2].map((time) => ({ x: 10, z: 0, time, kindName: 'tiny' }));

// Во сколько раз бюджет волны waveNumber больше записанного в FAKE_BUDGET_WAVE: рост числа врагов × рост крепости.
const getBudgetMultiplier = (waveNumber: number): number => {
  const { count, strength } = getWaveScale({ wave: FAKE_BUDGET_WAVE, waveNumber, cycleLength: FAKE_CYCLE_LENGTH });

  return count * strength;
};

describe('getWaveBudget', () => {
  it('Должен сложить здоровье всех врагов волны', () => {
    expect(getWaveBudget(FAKE_BUDGET_WAVE)).toBe(100);
  });

  it('Должен считать врага группы без типа по среднему здоровью типов', () => {
    // Средний HP типов: (10 + 20 + 40 + 80 + 120) / 5 = 54.
    expect(getWaveBudget({ groups: [{ shape: { type: 'random', count: 2 } }] })).toBe(108);
  });
});

describe('getWaveScale', () => {
  it.each([[1], [FAKE_CYCLE_LENGTH]])('Должен оставить волну %s обучающего круга как записана', (waveNumber) => {
    expect(getWaveScale({ wave: FAKE_BUDGET_WAVE, waveNumber, cycleLength: FAKE_CYCLE_LENGTH })).toEqual({
      count: 1,
      strength: 1,
    });
  });

  it('Должен дать первой волне после круга бюджет WAVE_ENDLESS_BUDGET', () => {
    expect(getBudgetMultiplier(FAKE_CYCLE_LENGTH + 1) * getWaveBudget(FAKE_BUDGET_WAVE)).toBeCloseTo(200);
  });

  it('Должен увеличивать бюджет в WAVE_GROWTH раз за волну', () => {
    expect(getBudgetMultiplier(FAKE_CYCLE_LENGTH + 5) / getBudgetMultiplier(FAKE_CYCLE_LENGTH + 4)).toBeCloseTo(1.05);
  });

  it.each([
    { share: 0, count: 1, strength: 2 },
    { share: 0.5, count: Math.SQRT2, strength: Math.SQRT2 },
    { share: 1, count: 2, strength: 1 },
  ])('Должен при доле роста в числе врагов $share умножить число на $count, а крепость на $strength', ({
    share,
    count,
    strength,
  }) => {
    // Первая волна после круга: бюджет 200 против записанных 100 — рост ×2.
    config.WAVE_COUNT_SHARE = share;

    const scale = getWaveScale({
      wave: FAKE_BUDGET_WAVE,
      waveNumber: FAKE_CYCLE_LENGTH + 1,
      cycleLength: FAKE_CYCLE_LENGTH,
    });

    expect(scale).toEqual({ count: expect.closeTo(count), strength: expect.closeTo(strength) });
  });
});

describe('buildWaveSchedule', () => {
  it('Должен построить по расписанию на каждую группу', () => {
    expect(buildWaveSchedule(FAKE_WAVE)).toHaveLength(2);
  });

  it.each([
    ['заданный', 0, 1.5],
    ['по умолчанию', 1, 0],
  ])('Должен взять %s delay группы', (_, groupIndex, expected) => {
    expect(buildWaveSchedule(FAKE_WAVE)[groupIndex].delay).toBe(expected);
  });

  it('Должен выпускать врагов группы через interval', () => {
    expect(buildWaveSchedule(FAKE_WAVE)[0].events.map(({ time }) => time)).toEqual([0, 0.5, 1]);
  });

  it('Должен выпускать врагов разом, если interval не задан', () => {
    expect(buildWaveSchedule(FAKE_WAVE)[1].events.map(({ time }) => time)).toEqual([0, 0, 0, 0]);
  });

  it('Должен дать всем врагам тип группы', () => {
    expect(new Set(buildWaveSchedule(FAKE_WAVE)[0].events.map(({ kindName }) => kindName))).toEqual(new Set(['tiny']));
  });

  it('Должен дать каждому врагу случайный тип, если тип группы не задан', () => {
    const kindNames = buildWaveSchedule(FAKE_WAVE)[1].events.map(({ kindName }) => kindName);

    expect(kindNames.filter((kindName) => !ENEMY_KIND_NAMES.includes(kindName))).toEqual([]);
  });

  it('Должен умножать врагов на ENEMY_COUNT_MULTIPLIER и делить на него интервал', () => {
    config.ENEMY_COUNT_MULTIPLIER = 2;

    expect(buildWaveSchedule(FAKE_WAVE)[0].events.map(({ time }) => time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25]);
  });

  it('Должен умножать врагов на countMultiplier', () => {
    expect(buildWaveSchedule(FAKE_WAVE, 3)[1].events).toHaveLength(12);
  });

  it('Должен делить интервал на countMultiplier', () => {
    // Первая группа: 3 точки × 3, время врага — номер × interval ÷ множитель.
    const expectedTimes = Array.from({ length: 9 }, (_, index) => (index * 0.5) / 3);

    expect(buildWaveSchedule(FAKE_WAVE, 3)[0].events.map(({ time }) => time)).toEqual(expectedTimes);
  });

  it.each([
    [1.6, 6],
    [1.4, 6],
    [1.1, 4],
  ])('Должен при множителе %s округлить четырёх врагов группы до %s', (countMultiplier, expected) => {
    expect(buildWaveSchedule(FAKE_WAVE, countMultiplier)[1].events).toHaveLength(expected);
  });

  it('Должен оставить в группе хотя бы одного врага при малом множителе', () => {
    expect(buildWaveSchedule(FAKE_WAVE, 0.1)[0].events).toHaveLength(1);
  });

  it('Должен перемножить ENEMY_COUNT_MULTIPLIER и countMultiplier', () => {
    config.ENEMY_COUNT_MULTIPLIER = 2;

    expect(buildWaveSchedule(FAKE_WAVE, 3)[1].events).toHaveLength(24);
  });
});

describe('countDueEvents', () => {
  it.each([
    [-1, 0],
    [0, 1],
    [0.7, 2],
    [1, 4],
    [5, 5],
  ])('Должен к моменту %s с насчитать %s наступивших событий', (elapsed, expected) => {
    expect(countDueEvents(FAKE_EVENTS, elapsed)).toBe(expected);
  });

  it('Должен вернуть 0 для пустой группы', () => {
    expect(countDueEvents([], 10)).toBe(0);
  });
});
