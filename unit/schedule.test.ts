// Юнит-тесты расписания волн (src/schedule.ts).
//
// buildWaveSchedule превращает описание волны (Wave из src/waves.ts) в конкретное расписание: для каждой
// группы — её задержку и список врагов с временем появления и типом. Чистая логика: считает точки формы,
// время (номер врага × interval) и тип. Единственный источник случайности — тип врага, если он не задан
// в описании группы; он всегда один из ENEMY_KIND_NAMES, что и проверяем.
import { describe, expect, it, beforeEach } from 'vitest';
import { config, ENEMY_KIND_NAMES, type EnemyKindName } from '../src/config';
import { buildWaveSchedule, countDueEvents, type SpawnEvent } from '../src/schedule';
import type { Wave } from '../src/waves';

describe('buildWaveSchedule', () => {
  beforeEach(() => {
    config.ENEMY_COUNT_MULTIPLIER = 1;
  });

  it('повторяет delay группы, число врагов, их время и тип', () => {
    const wave: Wave = {
      name: 'тест',
      groups: [{ shape: { type: 'random', count: 3 }, delay: 1.5, interval: 0.5, enemy: 'tiny' }],
    };

    const [group] = buildWaveSchedule(wave);

    expect(group.delay).toBe(1.5);
    expect(group.events).toHaveLength(3);
    // Время i-го врага = i × interval (при ENEMY_COUNT_MULTIPLIER = 1).
    expect(group.events.map((e) => e.time)).toEqual([0, 0.5, 1]);
    // Тип у всех врагов — заданный в описании группы.
    expect(group.events.every((e) => e.kindName === 'tiny')).toBe(true);
  });

  it('delay и interval по умолчанию 0 — группа появляется разом', () => {
    const wave: Wave = { name: 'тест', groups: [{ shape: { type: 'random', count: 4 } }] };

    const [group] = buildWaveSchedule(wave);

    expect(group.delay).toBe(0);
    // interval не задан → все 4 врага в момент 0.
    expect(group.events.every((e) => e.time === 0)).toBe(true);
  });

  it('группы идут по порядку, каждая со своим delay', () => {
    const wave: Wave = {
      name: 'тест',
      groups: [
        { shape: { type: 'random', count: 2 }, enemy: 'small' },
        { shape: { type: 'random', count: 2 }, delay: 5, enemy: 'big' },
      ],
    };

    const schedule = buildWaveSchedule(wave);

    expect(schedule).toHaveLength(2);
    expect(schedule[0].delay).toBe(0);
    expect(schedule[1].delay).toBe(5);
    expect(schedule[0].events.every((e) => e.kindName === 'small')).toBe(true);
    expect(schedule[1].events.every((e) => e.kindName === 'big')).toBe(true);
  });

  it('ENEMY_COUNT_MULTIPLIER уплотняет группу: врагов ×N, интервал ÷N', () => {
    config.ENEMY_COUNT_MULTIPLIER = 2;

    const wave: Wave = { name: 'тест', groups: [{ shape: { type: 'random', count: 3 }, interval: 1 }] };

    const [group] = buildWaveSchedule(wave);

    // 3 × 2 = 6 врагов.
    expect(group.events).toHaveLength(6);
    // Время i-го врага = i × (interval / multiplier) → [0, 0.5, 1, 1.5, 2, 2.5].
    expect(group.events.map((e) => e.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });

  it('без enemy тип каждого врага — случайный из ENEMY_KIND_NAMES', () => {
    const wave: Wave = { name: 'тест', groups: [{ shape: { type: 'random', count: 10 } }] };

    const [group] = buildWaveSchedule(wave);

    expect(group.events).toHaveLength(10);
    for (const e of group.events) {
      expect(ENEMY_KIND_NAMES as EnemyKindName[]).toContain(e.kindName);
    }
  });
});

const FAKE_EVENTS: SpawnEvent[] = [0, 0.5, 1, 1, 2].map((time) => ({ x: 10, z: 0, time, kindName: 'tiny' }));

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
