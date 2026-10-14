// Юнит-тесты единственной формы спавна random (src/patterns.ts): точки лежат в кольце от края
// безопасной зоны (с запасом на половину самого крупного врага) до стены арены с отступом ARENA_INSET.
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { getShapePoints, type Point } from '../src/patterns';

// Внутренняя и внешняя граница кольца спавна при текущем конфиге.
const getRing = (): { inner: number; outer: number } => {
  const maxHalf = Math.max(...Object.values(config.ENEMY_KINDS).map(({ size }) => size)) / 2;

  return { inner: config.SAFE_RADIUS + maxHalf, outer: config.ARENA_SIZE / 2 - config.ARENA_INSET };
};

const getRadius = ({ x, z }: Point): number => Math.hypot(x, z);

describe('getShapePoints', () => {
  it.each([
    [0, 0],
    [1, 1],
    [60, 60],
  ])('Должен для count = %s вернуть %s точек', (count, expected) => {
    expect(getShapePoints({ type: 'random', count })).toHaveLength(expected);
  });

  it('Должен класть точки в кольцо от края безопасной зоны до стены с отступом', () => {
    const { inner, outer } = getRing();

    const outside = getShapePoints({ type: 'random', count: 200 })
      .map(getRadius)
      .filter((radius) => radius < inner - 1e-9 || radius > outer + 1e-9);

    expect(outside).toEqual([]);
  });

  it('Должен заполнять кольцо и у внутреннего, и у внешнего края', () => {
    const { inner, outer } = getRing();
    const middle = (inner + outer) / 2;
    const radii = getShapePoints({ type: 'random', count: 200 }).map(getRadius);

    expect([Math.min(...radii) < middle, Math.max(...radii) > middle]).toEqual([true, true]);
  });

  it('Должен прижимать точки к внешней границе, если безопасная зона съела кольцо', () => {
    config.SAFE_RADIUS = 13;

    const { outer } = getRing();

    const invalid = getShapePoints({ type: 'random', count: 20 })
      .map(getRadius)
      .filter((radius) => !Number.isFinite(radius) || radius > outer + 1e-9);

    expect(invalid).toEqual([]);
  });
});
