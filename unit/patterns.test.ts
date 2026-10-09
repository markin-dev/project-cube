// Юнит-тесты геометрии форм спавна (src/patterns.ts).
//
// Формы — чистые функции: по параметрам возвращают точки на полу. Единственный источник случайности —
// угол по умолчанию и позиции внутри cluster/random, но даже там геометрические инварианты (все точки
// лежат на окружности спавна / внутри радиуса кучки) выполняются всегда — тесты детерминированы.
import { describe, expect, it, beforeEach } from 'vitest';
import { config } from '../src/config';
import { getShapePoints } from '../src/patterns';

// Радиус окружности спавна фиксируем, чтобы считать ожидаемые координаты.
const R = 10;

// Расстояние точки от центра арены.
const dist = (p: { x: number; z: number }): number => Math.hypot(p.x, p.z);

// «Вверх по экрану» = направление 0° = (-1, -1) / √2, умноженное на радиус.
const screenUp = { x: -R * Math.SQRT1_2, z: -R * Math.SQRT1_2 };

describe('кольцо / дуга (circle)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
  });

  it('count точек, все на окружности спавна, первый враг под заданным углом', () => {
    const points = getShapePoints({ type: 'circle', count: 4, angle: 0 });

    expect(points).toHaveLength(4);
    for (const p of points) expect(dist(p)).toBeCloseTo(R, 6);

    // 0° — «вверх по экрану»: (-R/√2, -R/√2).
    expect(points[0].x).toBeCloseTo(screenUp.x, 6);
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
  });

  it('полное кольцо расставляет врагов поровну: шаг 360°/count', () => {
    // count=4, angle=0 → углы 0°, 90°, 180°, 270° (вверх, вправо, вниз, влево).
    const points = getShapePoints({ type: 'circle', count: 4, angle: 0 });

    expect(points[1].x).toBeCloseTo(R * Math.SQRT1_2, 6); // вправо
    expect(points[1].z).toBeCloseTo(-R * Math.SQRT1_2, 6);
    expect(points[2].x).toBeCloseTo(R * Math.SQRT1_2, 6); // вниз
    expect(points[2].z).toBeCloseTo(R * Math.SQRT1_2, 6);
    expect(points[3].x).toBeCloseTo(-R * Math.SQRT1_2, 6); // влево
    expect(points[3].z).toBeCloseTo(R * Math.SQRT1_2, 6);
  });

  it('дуга: count точек от края до края, все на окружности', () => {
    const points = getShapePoints({ type: 'circle', count: 3, angle: 0, arc: 90 });

    expect(points).toHaveLength(3);
    for (const p of points) expect(dist(p)).toBeCloseTo(R, 6);
    // Края дуги не совпадают между собой (это не полное кольцо).
    expect(points[0]).not.toEqual(points[2]);
  });

  it('один враг — одна точка под углом', () => {
    const points = getShapePoints({ type: 'circle', count: 1, angle: 0 });

    expect(points).toHaveLength(1);
    expect(points[0].x).toBeCloseTo(screenUp.x, 6);
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
  });
});

describe('шеренга (line)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
    config.DEFAULT_LINE_WIDTH = 6;
  });

  it('середина ряда на окружности, вектор ряда длиной width', () => {
    const width = 4;
    const points = getShapePoints({ type: 'line', count: 3, angle: 0, width });

    expect(points).toHaveLength(3);

    // Центр ряда (средняя точка) — точка окружности спавна под углом 0 («вверх»).
    expect(points[1].x).toBeCloseTo(screenUp.x, 6);
    expect(points[1].z).toBeCloseTo(screenUp.z, 6);

    // Ряд идёт поперёк направления на куб (единичный вектор) → расстояние между крайними = width.
    const spanX = points[2].x - points[0].x;
    const spanZ = points[2].z - points[0].z;
    expect(Math.hypot(spanX, spanZ)).toBeCloseTo(width, 6);
  });

  it('без width берёт DEFAULT_LINE_WIDTH из конфига', () => {
    const points = getShapePoints({ type: 'line', count: 3, angle: 0 });

    const spanX = points[2].x - points[0].x;
    const spanZ = points[2].z - points[0].z;
    expect(Math.hypot(spanX, spanZ)).toBeCloseTo(config.DEFAULT_LINE_WIDTH, 6);
  });

  it('один враг — одна точка в центре ряда (без смещения)', () => {
    const points = getShapePoints({ type: 'line', count: 1, angle: 0, width: 10 });

    expect(points).toHaveLength(1);
    expect(points[0].x).toBeCloseTo(screenUp.x, 6);
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
  });
});

describe('кучка (cluster)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
    config.DEFAULT_CLUSTER_RADIUS = 3;
  });

  it('все точки внутри radius от центра кучки', () => {
    const radius = 3;
    const points = getShapePoints({ type: 'cluster', count: 30, angle: 0, radius });

    expect(points).toHaveLength(30);
    for (const p of points) {
      expect(Math.hypot(p.x - screenUp.x, p.z - screenUp.z)).toBeLessThanOrEqual(radius + 1e-9);
    }
  });

  it('без radius берёт DEFAULT_CLUSTER_RADIUS из конфига', () => {
    const points = getShapePoints({ type: 'cluster', count: 20, angle: 0 });

    for (const p of points) {
      expect(Math.hypot(p.x - screenUp.x, p.z - screenUp.z)).toBeLessThanOrEqual(
        config.DEFAULT_CLUSTER_RADIUS + 1e-9,
      );
    }
  });
});

describe('«то тут то там» (random)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
  });

  it('все точки лежат на окружности спавна', () => {
    const points = getShapePoints({ type: 'random', count: 15, angle: 0, arc: 90 });

    expect(points).toHaveLength(15);
    for (const p of points) expect(dist(p)).toBeCloseTo(R, 6);
  });
});
