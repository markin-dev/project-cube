// Юнит-тесты геометрии форм спавна (src/patterns.ts).
//
// Формы — чистые функции: по параметрам возвращают точки на полу. Единственный источник случайности —
// угол по умолчанию и позиции внутри random, но даже там геометрические инварианты (все точки
// лежат на окружности спавна / внутри сектора) выполняются всегда — тесты детерминированы.
import { describe, expect, it, beforeEach } from 'vitest';
import { config } from '../src/config';
import { getShapePoints } from '../src/patterns';
import { WAVES } from '../src/waves';

// Радиус окружности спавна фиксируем, чтобы считать ожидаемые координаты.
const R = 10;

// Расстояние точки от центра арены.
const dist = (p: { x: number; z: number }): number => Math.hypot(p.x, p.z);

// «Вверх по экрану» = направление 0° = (-1, -1) / √2, умноженное на радиус.
const screenUp = { x: -R * Math.SQRT1_2, z: -R * Math.SQRT1_2 };

describe('кольцо / дуга (circle)', () => {
  it('count точек, все на окружности спавна, первый враг под заданным углом', () => {
    const points = getShapePoints({ type: 'circle', count: 4, angle: 0, distance: R });

    expect(points).toHaveLength(4);
    for (const p of points) expect(dist(p)).toBeCloseTo(R, 6);

    // 0° — «вверх по экрану»: (-R/√2, -R/√2).
    expect(points[0].x).toBeCloseTo(screenUp.x, 6);
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
  });

  it('полное кольцо расставляет врагов поровну: шаг 360°/count', () => {
    // count=4, angle=0 → углы 0°, 90°, 180°, 270° (вверх, вправо, вниз, влево).
    const points = getShapePoints({ type: 'circle', count: 4, angle: 0, distance: R });

    expect(points[1].x).toBeCloseTo(R * Math.SQRT1_2, 6); // вправо
    expect(points[1].z).toBeCloseTo(-R * Math.SQRT1_2, 6);
    expect(points[2].x).toBeCloseTo(R * Math.SQRT1_2, 6); // вниз
    expect(points[2].z).toBeCloseTo(R * Math.SQRT1_2, 6);
    expect(points[3].x).toBeCloseTo(-R * Math.SQRT1_2, 6); // влево
    expect(points[3].z).toBeCloseTo(R * Math.SQRT1_2, 6);
  });

  it('дуга: count точек от края до края, все на окружности', () => {
    const points = getShapePoints({ type: 'circle', count: 3, angle: 0, arc: 90, distance: R });

    expect(points).toHaveLength(3);
    for (const p of points) expect(dist(p)).toBeCloseTo(R, 6);
    // Края дуги не совпадают между собой (это не полное кольцо).
    expect(points[0]).not.toEqual(points[2]);
  });

  it('один враг — одна точка под углом', () => {
    const points = getShapePoints({ type: 'circle', count: 1, angle: 0, distance: R });

    expect(points).toHaveLength(1);
    expect(points[0].x).toBeCloseTo(screenUp.x, 6);
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
  });

  it('distance: кольцо на заданном удалении от центра арены', () => {
    const distance = 5;
    const points = getShapePoints({ type: 'circle', count: 6, angle: 0, distance });

    expect(points).toHaveLength(6);
    for (const p of points) expect(dist(p)).toBeCloseTo(distance, 6);
    expect(points[0].x).toBeCloseTo((-distance) * Math.SQRT1_2, 6);
    expect(points[0].z).toBeCloseTo((-distance) * Math.SQRT1_2, 6);
  });
});

describe('«то тут то там» (random)', () => {
  const ARENA = 30;
  const INSET = 1;
  const SAFE = 6;
  const OUTER = ARENA / 2 - INSET; // 14

  beforeEach(() => {
    config.ARENA_SIZE = ARENA;
    config.PERIMETER_INSET = INSET;
    config.SAFE_RADIUS = SAFE;
  });

  it('все точки вне безопасной зоны и не дальше внешней границы (стена − inset)', () => {
    const points = getShapePoints({ type: 'random', count: 60 });

    expect(points).toHaveLength(60);
    for (const p of points) {
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(SAFE - 1e-9);
      expect(r).toBeLessThanOrEqual(OUTER + 1e-9);
    }
  });

  it('точки заполняют всё кольцо: есть и у внутреннего края, и у внешнего', () => {
    // Равномерность по площади: при 200 точках точно найдутся и ближние к зоне, и дальние.
    const points = getShapePoints({ type: 'random', count: 200 });
    const radii = points.map((p) => Math.hypot(p.x, p.z));
    const middle = (SAFE + OUTER) / 2;

    expect(Math.min(...radii)).toBeLessThan(middle);
    expect(Math.max(...radii)).toBeGreaterThan(middle);
  });
});

describe('многоугольник (polygon)', () => {
  beforeEach(() => {
    config.DEFAULT_POLYGON_SIDES = 4;
  });

  it('count = sides: точки в вершинах на окружности радиуса distance', () => {
    const points = getShapePoints({ type: 'polygon', count: 3, sides: 3, angle: 0, distance: R });

    expect(points).toHaveLength(3);
    for (const p of points) expect(dist(p)).toBeCloseTo(R, 6);
    expect(points[0].x).toBeCloseTo(screenUp.x, 6); // вершина под angle = 0
    expect(points[0].z).toBeCloseTo(screenUp.z, 6);
  });

  it('count > sides: точки лежат на прямых рёбрах, не на дуге', () => {
    const points = getShapePoints({ type: 'polygon', count: 8, sides: 4, angle: 0, distance: R });

    expect(points).toHaveLength(8);

    // Квадрат (4 вершины на окружности): чётные точки — вершины (dist = R),
    // нечётные — середины рёбер (хорда), расстояние до центра = R/√2.
    expect(dist(points[0])).toBeCloseTo(R, 6);
    expect(dist(points[1])).toBeCloseTo(R / Math.SQRT2, 6);
    expect(dist(points[2])).toBeCloseTo(R, 6);
  });

  it('меньше трёх сторон поднимается до треугольника', () => {
    const points = getShapePoints({ type: 'polygon', count: 3, sides: 2, angle: 0, distance: R });

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
  it('каждая точка сдвигается не дальше заданного радиуса', () => {
    const jitter = 0.5;
    const base = getShapePoints({ type: 'circle', count: 12, angle: 0, distance: R });
    const jittered = getShapePoints({ type: 'circle', count: 12, angle: 0, distance: R, jitter });

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
    const plain = getShapePoints({ type: 'circle', count: 8, angle: 0, distance: R });

    expect(getShapePoints({ type: 'circle', count: 8, angle: 0, distance: R, jitter: 0 })).toEqual(plain);
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

describe('безопасная зона в описаниях волн', () => {
  beforeEach(() => {
    config.ARENA_SIZE = 30;
    config.SAFE_RADIUS = 8;
    config.PERIMETER_INSET = 1;
  });

  it('ни одна волна не ставит точки ближе зоны плюс половина самого крупного врага', () => {
    // Подборщик прижал бы такие точки к краю зоны (см. spawn-placement) — волна пошла бы не так,
    // как задумана. Запас на половину самого крупного типа нужен потому, что без enemy тип врага
    // случайный, и для брута (1.5 м) вся его коробка должна быть вне зоны.
    const maxHalf = Math.max(...Object.values(config.ENEMY_KINDS).map((kind) => kind.size)) / 2;
    const limit = config.SAFE_RADIUS + maxHalf;

    for (const wave of WAVES) {
      for (const group of wave.groups) {
        for (const point of getShapePoints(group.shape)) {
          expect(Math.hypot(point.x, point.z), `волна «${wave.name}»`).toBeGreaterThanOrEqual(limit - 1e-9);
        }
      }
    }
  });
});
