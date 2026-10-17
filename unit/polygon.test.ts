// Юнит-тесты сетки полигона (src/polygon.ts): сколько узлов, шаг решётки, пустой круг и зазор у куба,
// граница арены, порядок «ближние первыми» и тип врагов из конфига.
import { describe, expect, it } from 'vitest';
import { config, type EnemyKindName } from '@/config';
import type { Point } from '@/patterns';
import { getPolygonKindName, getPolygonPoints } from '@/polygon';

// Допуск сравнения координат: шаг вроде 0.8 + 1 не представим в двоичной дроби точно.
const EPSILON = 1e-9;

const getRadius = ({ x, z }: Point): number => Math.hypot(x, z);

// Насколько точка отходит от центра по дальней оси — для квадратного куба это и есть «дальность грани».
const getSquareDistance = ({ x, z }: Point): number => Math.max(Math.abs(x), Math.abs(z));

// Проверка «число целое с точностью до допуска?».
const isNearInteger = (value: number): boolean => Math.abs(value - Math.round(value)) < EPSILON;

describe('getPolygonPoints', () => {
  it('Должен вернуть POLYGON_ENEMY_COUNT точек', () => {
    config.POLYGON_ENEMY_COUNT = 25;

    expect(getPolygonPoints('normal')).toHaveLength(25);
  });

  it('Должен вернуть столько точек, сколько узлов влезло на арену, если просят больше', () => {
    // Граница 12 / 2 − 1 = 5 м, шаг 0.8 + 1.2 = 2 м — узлы −2…2 по каждой оси, 25 штук. Зазор до куба
    // (1 + 0.8) / 2 + 1.2 = 2.1 м выбивает внутренний квадрат 3 × 3 — остаётся 16.
    config.ARENA_SIZE = 12;
    config.ARENA_INSET = 1;
    config.POLYGON_ENEMY_GAP = 1.2;
    config.POLYGON_CLEAR_RADIUS = 0;
    config.POLYGON_ENEMY_COUNT = 1000;

    expect(getPolygonPoints('normal')).toHaveLength(16);
  });

  it.each<[EnemyKindName]>([['tiny'], ['brute']])(
    'Должен ставить врагов %s в узлы решётки с шагом «сторона врага + расстояние»',
    (kindName) => {
      config.POLYGON_ENEMY_GAP = 1.2;

      const step = config.ENEMY_KINDS[kindName].size + config.POLYGON_ENEMY_GAP;

      const offGrid = getPolygonPoints(kindName).filter(
        ({ x, z }) => !isNearInteger(x / step) || !isNearInteger(z / step),
      );

      expect(offGrid).toEqual([]);
    },
  );

  it('Должен оставить пустым круг POLYGON_CLEAR_RADIUS вокруг куба', () => {
    config.POLYGON_CLEAR_RADIUS = 5;

    const inside = getPolygonPoints('normal').filter((point) => getRadius(point) < 5);

    expect(inside).toEqual([]);
  });

  it('Должен держать врагов от куба не ближе, чем друг от друга', () => {
    config.POLYGON_CLEAR_RADIUS = 0;

    const halfSizes = (config.PLAYER_SIZE + config.ENEMY_KINDS.normal.size) / 2;
    const gaps = getPolygonPoints('normal').map((point) => getSquareDistance(point) - halfSizes);

    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(config.POLYGON_ENEMY_GAP - EPSILON);
  });

  it('Должен держать центры врагов над ареной с отступом ARENA_INSET', () => {
    config.POLYGON_ENEMY_COUNT = 1000;

    const distances = getPolygonPoints('normal').map(getSquareDistance);

    expect(Math.max(...distances)).toBeLessThanOrEqual(config.ARENA_SIZE / 2 - config.ARENA_INSET);
  });

  it('Должен ставить первыми ближайших к кубу', () => {
    const radii = getPolygonPoints('normal').map(getRadius);

    expect(radii).toEqual([...radii].sort((first, second) => first - second));
  });

  it('Должен строить одну и ту же сетку при каждом вызове', () => {
    expect(getPolygonPoints('small')).toEqual(getPolygonPoints('small'));
  });

  it('Должен вернуть пустую сетку, если отступ от стены больше половины арены', () => {
    config.ARENA_INSET = 20;

    expect(getPolygonPoints('normal')).toEqual([]);
  });
});

describe('getPolygonKindName', () => {
  it.each([
    ['tiny', 'tiny'],
    ['brute', 'brute'],
    ['unknown', 'normal'],
  ])('Должен для POLYGON_ENEMY_KIND = %s вернуть %s', (value, expected) => {
    config.POLYGON_ENEMY_KIND = value;

    expect(getPolygonKindName()).toBe(expected);
  });
});
