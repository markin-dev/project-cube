// Юнит-тесты расписания волн (src/schedule.ts): buildWaveSchedule превращает описание волны в группы
// с задержкой и списком врагов (точка, время, тип); countDueEvents считает наступившие события.
import { describe, expect, it } from 'vitest';
import { config, ENEMY_KIND_NAMES } from '@/config';
import { buildWaveSchedule, countDueEvents, type SpawnEvent } from '@/schedule';
import type { Wave } from '@/waves';

const FAKE_WAVE: Wave = {
  groups: [
    { shape: { type: 'random', count: 3 }, delay: 1.5, interval: 0.5, enemy: 'tiny' },
    { shape: { type: 'random', count: 4 } },
  ],
};

const FAKE_EVENTS: SpawnEvent[] = [0, 0.5, 1, 1, 2].map((time) => ({ x: 10, z: 0, time, kindName: 'tiny' }));

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

  it('Должен умножать врагов на круг и делить на него интервал', () => {
    // Первая группа: 3 точки × 3, время врага — номер × interval ÷ круг.
    const expectedTimes = Array.from({ length: 9 }, (_, index) => (index * 0.5) / 3);

    expect(buildWaveSchedule(FAKE_WAVE, 3)[0].events.map(({ time }) => time)).toEqual(expectedTimes);
    expect(buildWaveSchedule(FAKE_WAVE, 3)[1].events).toHaveLength(12);
  });

  it('Должен перемножить ENEMY_COUNT_MULTIPLIER и круг', () => {
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
