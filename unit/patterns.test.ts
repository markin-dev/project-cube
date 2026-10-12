// Юнит-тесты геометрии единственной формы спавна — random (src/patterns.ts).
//
// Форма — чистая функция: по параметрам возвращает точки на полу. Источник случайности — сами
// точки, но геометрические инварианты (все точки лежат в кольце спавна: вне безопасной зоны и
// не дальше внешней границы) выполняются всегда — тесты детерминированы.
import { describe, expect, it, beforeEach } from 'vitest';
import { config } from '../src/config';
import { getShapePoints } from '../src/patterns';
import { WAVES } from '../src/waves';

describe('случайные точки (random)', () => {
  const ARENA = 30;
  const INSET = 1;
  const SAFE = 6;
  const OUTER = ARENA / 2 - INSET; // 14

  beforeEach(() => {
    config.ARENA_SIZE = ARENA;
    config.ARENA_INSET = INSET;
    config.SAFE_RADIUS = SAFE;
  });

  it('все точки вне безопасной зоны и не дальше внешней границы (стена − ARENA_INSET)', () => {
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

  it('count = 0 — пусто; count = 1 — одна точка в кольце', () => {
    expect(getShapePoints({ type: 'random', count: 0 })).toHaveLength(0);

    const [point] = getShapePoints({ type: 'random', count: 1 });
    const r = Math.hypot(point.x, point.z);

    expect(r).toBeGreaterThanOrEqual(SAFE - 1e-9);
    expect(r).toBeLessThanOrEqual(OUTER + 1e-9);
  });

  it('зона, съевшая кольцо, не даёт NaN: точки прижимаются к внешней границе', () => {
    // Зона почти равна арене — внутренняя граница выше внешней, работает защитный clamp.
    config.SAFE_RADIUS = 13;

    const points = getShapePoints({ type: 'random', count: 20 });

    expect(points).toHaveLength(20);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(OUTER + 1e-9);
    }
  });
});

describe('безопасная зона в описаниях волн', () => {
  beforeEach(() => {
    config.ARENA_SIZE = 30;
    config.SAFE_RADIUS = 8;
    config.ARENA_INSET = 1;
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
