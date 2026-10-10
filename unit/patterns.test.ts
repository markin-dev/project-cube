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

  it('distance: кольцо на заданном удалении от центра, а не на SPAWN_RADIUS', () => {
    const distance = 5;
    const points = getShapePoints({ type: 'circle', count: 6, angle: 0, distance });

    expect(points).toHaveLength(6);
    for (const p of points) expect(dist(p)).toBeCloseTo(distance, 6);
    expect(points[0].x).toBeCloseTo((-distance) * Math.SQRT1_2, 6);
    expect(points[0].z).toBeCloseTo((-distance) * Math.SQRT1_2, 6);
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

describe('радиальный луч (ray)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
    config.DEFAULT_RAY_LENGTH = 6;
  });

  it('ряд идёт ВДОЛЬ радиуса: центр луча на окружности, длина = length', () => {
    const length = 4;
    const points = getShapePoints({ type: 'ray', count: 3, angle: 0, length });

    expect(points).toHaveLength(3);

    // Центр луча — точка окружности спавна под углом 0 («вверх»), как у line.
    expect(points[1].x).toBeCloseTo(screenUp.x, 6);
    expect(points[1].z).toBeCloseTo(screenUp.z, 6);

    // Вектор крайних точек параллелен радиусу (screenUp: x и z с одинаковым знаком), а не поперёк,
    // как у line — это и есть отличие ray от line.
    const spanX = points[2].x - points[0].x;
    const spanZ = points[2].z - points[0].z;
    expect(Math.hypot(spanX, spanZ)).toBeCloseTo(length, 6);
    expect(spanX / spanZ).toBeCloseTo(1, 6); // у line этот же отношение было бы ≈ -1.
  });

  it('без length берёт DEFAULT_RAY_LENGTH из конфига', () => {
    const points = getShapePoints({ type: 'ray', count: 3, angle: 0 });

    const spanX = points[2].x - points[0].x;
    const spanZ = points[2].z - points[0].z;
    expect(Math.hypot(spanX, spanZ)).toBeCloseTo(config.DEFAULT_RAY_LENGTH, 6);
  });

  it('один враг — точка в центре луча', () => {
    const points = getShapePoints({ type: 'ray', count: 1, angle: 0, length: 10 });

    expect(points).toHaveLength(1);
    expect(points[0].x).toBeCloseTo(screenUp.x, 6);
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
  });
});

describe('крест (cross)', () => {
  beforeEach(() => {
    config.SPAWN_RADIUS = R;
    config.DEFAULT_CROSS_ARM_LENGTH = 3;
  });

  it('count точек делятся на 4 плеча: концы на armLength от центра', () => {
    const armLength = 3;
    const points = getShapePoints({ type: 'cross', count: 8, angle: 0, armLength });

    expect(points).toHaveLength(8);

    // По 2 точки на плечо: одна в середине (armLength/2), одна на конце (armLength).
    const dists = points.map((p) => Math.hypot(p.x - screenUp.x, p.z - screenUp.z));
    const atTip = dists.filter((d) => Math.abs(d - armLength) < 1e-6);
    const atMid = dists.filter((d) => Math.abs(d - armLength / 2) < 1e-6);
    expect(atTip).toHaveLength(4);
    expect(atMid).toHaveLength(4);
  });

  it('плечо при angle = 0 смотрит по осям экрана: точка «вправо» присутствует', () => {
    const armLength = 3;
    const points = getShapePoints({ type: 'cross', count: 4, angle: 0, armLength });

    expect(points).toHaveLength(4);

    // Плечи: вверх/вправо/вниз/влево от центра — концы на расстоянии armLength от screenUp.
    const tips = [
      { x: screenUp.x + armLength * Math.SQRT1_2, z: screenUp.z - armLength * Math.SQRT1_2 }, // вправо
      { x: screenUp.x - armLength * Math.SQRT1_2, z: screenUp.z + armLength * Math.SQRT1_2 }, // влево
      { x: screenUp.x - armLength * Math.SQRT1_2, z: screenUp.z - armLength * Math.SQRT1_2 }, // вверх
      { x: screenUp.x + armLength * Math.SQRT1_2, z: screenUp.z + armLength * Math.SQRT1_2 }, // вниз
    ];

    for (const tip of tips) {
      expect(points.some((p) => Math.hypot(p.x - tip.x, p.z - tip.z) < 1e-6)).toBe(true);
    }
  });

  it('без armLength берёт DEFAULT_CROSS_ARM_LENGTH из конфига', () => {
    const points = getShapePoints({ type: 'cross', count: 4, angle: 0 });

    const maxDist = Math.max(...points.map((p) => Math.hypot(p.x - screenUp.x, p.z - screenUp.z)));
    expect(maxDist).toBeCloseTo(config.DEFAULT_CROSS_ARM_LENGTH, 6);
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
