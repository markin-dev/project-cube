// Юнит-тесты геометрии форм спавна (src/patterns.ts).
//
// Формы — чистые функции: по параметрам возвращают точки на полу. Единственный источник случайности —
// угол по умолчанию и позиции внутри random, но даже там геометрические инварианты (все точки
// лежат на окружности спавна / внутри сектора) выполняются всегда — тесты детерминированы.
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

  it('distance: кольцо на заданном удалении от центра, а не на SPAWN_RADIUS', () => {
    const distance = 5;
    const points = getShapePoints({ type: 'circle', count: 6, angle: 0, distance });

    expect(points).toHaveLength(6);
    for (const p of points) expect(dist(p)).toBeCloseTo(distance, 6);
    expect(points[0].x).toBeCloseTo((-distance) * Math.SQRT1_2, 6);
    expect(points[0].z).toBeCloseTo((-distance) * Math.SQRT1_2, 6);
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

describe('многоугольник (polygon)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
    config.DEFAULT_POLYGON_SIDES = 4;
  });

  it('count = sides: точки в вершинах на окружности радиуса distance', () => {
    const points = getShapePoints({ type: 'polygon', count: 3, sides: 3, angle: 0 });

    expect(points).toHaveLength(3);
    for (const p of points) expect(dist(p)).toBeCloseTo(R, 6);
    expect(points[0].x).toBeCloseTo(screenUp.x, 6); // вершина под angle = 0
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
  });

  it('count > sides: точки лежат на прямых рёбрах, не на дуге', () => {
    const points = getShapePoints({ type: 'polygon', count: 8, sides: 4, angle: 0 });

    expect(points).toHaveLength(8);

    // Квадрат (4 вершины на окружности): чётные точки — вершины (dist = R),
    // нечётные — середины рёбер (хорда), расстояние до центра = R/√2.
    expect(dist(points[0])).toBeCloseTo(R, 6);
    expect(dist(points[1])).toBeCloseTo(R / Math.SQRT2, 6);
    expect(dist(points[2])).toBeCloseTo(R, 6);
  });

  it('меньше трёх сторон поднимается до треугольника', () => {
    const points = getShapePoints({ type: 'polygon', count: 3, sides: 2, angle: 0 });

    expect(points).toHaveLength(3);
    for (const p of points) expect(dist(p)).toBeCloseTo(R, 6);
  });

  it('distance задаёт радиус описанной окружности', () => {
    const distance = 7;
    const points = getShapePoints({ type: 'polygon', count: 4, sides: 4, angle: 0, distance });

    expect(points).toHaveLength(4);
    expect(dist(points[0])).toBeCloseTo(distance, 6);
  });
});

describe('путь (path)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
  });

  it('точки идут по порядку от первой опоры к последней', () => {
    // Опоры под углами 0 («вверх») и 90 («вправо»): обе на одной линии z, x нарастает.
    const points = getShapePoints({ type: 'path', count: 5, anchors: [{ angle: 0 }, { angle: 90 }] });

    expect(points).toHaveLength(5);

    const zLine = -R * Math.SQRT1_2; // общая z для обоих углов (0° и 90°)
    for (const p of points) expect(p.z).toBeCloseTo(zLine, 6);

    // x монотонно нарастает от первой опоры к последней.
    expect(points[0].x).toBeCloseTo(-R * Math.SQRT1_2, 6);
    expect(points[points.length - 1].x).toBeCloseTo(R * Math.SQRT1_2, 6);
    for (let i = 1; i < points.length; i++) expect(points[i].x).toBeGreaterThan(points[i - 1].x);
  });

  it('первая точка — в первой опоре, последняя — в последней', () => {
    const points = getShapePoints({ type: 'path', count: 4, anchors: [{ angle: 0 }, { angle: 180 }] });

    // Опоры 0° («вверх») и 180° («вниз»): путь по диагонали через центр.
    expect(points[0].x).toBeCloseTo(screenUp.x, 6);
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
    expect(points[points.length - 1].x).toBeCloseTo(-screenUp.x, 6);
    expect(points[points.length - 1].z).toBeCloseTo(-screenUp.z, 6);
  });

  it('у опоры свой радиус: путь изнутри наружу вдоль одного радиуса', () => {
    const inner = 5;
    const points = getShapePoints({ type: 'path', count: 3, anchors: [{ angle: 0, radius: inner }, { angle: 0 }] });

    expect(points).toHaveLength(3);
    expect(dist(points[0])).toBeCloseTo(inner, 6);
    expect(dist(points[points.length - 1])).toBeCloseTo(R, 6);

    // Обе опоры на одном экранном углу (0°) → путь лежит на этом луче: x = z у каждой точки,
    // а расстояние от центра монотонно растёт от inner к SPAWN_RADIUS.
    for (const p of points) expect(p.x).toBeCloseTo(p.z, 6);
    expect(dist(points[1])).toBeGreaterThan(dist(points[0]));
    expect(dist(points[2])).toBeGreaterThan(dist(points[1]));
  });

  it('одна опора — все точки в ней же', () => {
    const points = getShapePoints({ type: 'path', count: 4, anchors: [{ angle: 0 }] });

    expect(points).toHaveLength(4);
    for (const p of points) expect(p).toEqual(points[0]);
  });
});

describe('периметр (perimeter)', () => {
  const ARENA = 30;
  const INSET = 1;
  const h = ARENA / 2 - INSET; // 14

  beforeEach(() => {
    config.ARENA_SIZE = ARENA;
    config.PERIMETER_INSET = INSET;
  });

  it('count = 4 → ровно четыре вершины квадрата на краю', () => {
    const points = getShapePoints({ type: 'perimeter', count: 4 });

    expect(points).toHaveLength(4);
    // Вершины по часовой: верх экрана (−h,−h), право (h,−h), низ (h,h), лево (−h,h).
    expect(points[0]).toEqual({ x: -h, z: -h });
    expect(points[1]).toEqual({ x: h, z: -h });
    expect(points[2]).toEqual({ x: h, z: h });
    expect(points[3]).toEqual({ x: -h, z: h });
  });

  it('каждая точка лежит на стороне квадрата и внутри арены', () => {
    const points = getShapePoints({ type: 'perimeter', count: 16 });

    expect(points).toHaveLength(16);
    for (const p of points) {
      // На стороне: одна из координат равна ±h, другая не дальше h; и то и другое — не дальше h.
      expect(Math.abs(p.x)).toBeLessThanOrEqual(h + 1e-9);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(h + 1e-9);
      expect(Math.abs(Math.abs(p.x) - h) < 1e-9 || Math.abs(Math.abs(p.z) - h) < 1e-9).toBe(true);

      // С запасом от стенки: центр врага остаётся над ареной (иначе погибнет сразу).
      expect(Math.abs(p.x)).toBeLessThan(config.ARENA_SIZE / 2);
      expect(Math.abs(p.z)).toBeLessThan(config.ARENA_SIZE / 2);
    }
  });

  it('inset отодвигает вершины от стенки на своё значение', () => {
    const points = getShapePoints({ type: 'perimeter', count: 4, inset: 3 });

    expect(Math.max(Math.abs(points[0].x), Math.abs(points[0].z))).toBeCloseTo(ARENA / 2 - 3, 6);
  });
});

describe('случайный разброс (jitter)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
  });

  it('каждая точка сдвигается не дальше заданного радиуса', () => {
    const jitter = 0.5;
    const base = getShapePoints({ type: 'circle', count: 12, angle: 0 });
    const jittered = getShapePoints({ type: 'circle', count: 12, angle: 0, jitter });

    expect(jittered).toHaveLength(12);
    let moved = 0;
    for (let i = 0; i < jittered.length; i++) {
      const delta = Math.hypot(jittered[i].x - base[i].x, jittered[i].z - base[i].z);
      expect(delta).toBeLessThanOrEqual(jitter + 1e-9);
      moved += delta;
    }
    // Разброс реально двигает точки (не тождественный сдвиг).
    expect(moved).toBeGreaterThan(0);
  });

  it('jitter = 0 или отсутствие — точки как без разброса', () => {
    const plain = getShapePoints({ type: 'circle', count: 8, angle: 0 });

    expect(getShapePoints({ type: 'circle', count: 8, angle: 0, jitter: 0 })).toEqual(plain);
  });

  it('работает у любой формы (здесь — периметр)', () => {
    const base = getShapePoints({ type: 'perimeter', count: 8 });
    const jittered = getShapePoints({ type: 'perimeter', count: 8, jitter: 1 });

    expect(jittered).toHaveLength(8);
    for (let i = 0; i < jittered.length; i++) {
      const delta = Math.hypot(jittered[i].x - base[i].x, jittered[i].z - base[i].z);
      expect(delta).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
