// Юнит-тесты подбора места появления (src/spawn-placement.ts): новый враг не появляется внутри
// существующего — сначала столбом вверх над точкой, потом вбок; внутрь безопасной зоны — никогда.
// Враги — обычного типа (0.8 м), созданные spawnEnemy: подборщик читает их позицию, поворот и размер.
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import type { Enemies } from '../src/enemies';
import { createSpawnPlacer } from '../src/spawn-placement';
import { addTestEnemy, createTestWorld } from './fixtures';

const { world, scene } = await createTestWorld();

const SIZE = 0.8;
const HALF = SIZE / 2;
const GAP = 0.15;
const LAYER_STEP = SIZE + GAP;

// Список врагов, стоящих в точках points (центр — на полу, если y не задан).
const createCrowd = (points: Array<{ x: number; y?: number; z: number }>): Enemies => {
  const enemies: Enemies = new Map();

  points.forEach(({ x, y = HALF, z }) => addTestEnemy({ world, scene, enemies, x, y, z }));

  return enemies;
};

// Точки сетки с шагом step в квадрате ±extent.
const getGridPoints = (extent: number, step: number): Array<{ x: number; z: number }> => {
  const coordinates = Array.from({ length: Math.floor((2 * extent) / step) + 1 }, (_, index) => -extent + index * step);

  return coordinates.flatMap((x) => coordinates.map((z) => ({ x, z })));
};

const place = ({ enemies, x, z }: { enemies: Enemies; x: number; z: number }): number[] =>
  createSpawnPlacer(enemies)({ point: { x, z }, size: SIZE }).toArray();

describe('подбор места без безопасной зоны', () => {
  it('Должен поставить врага в исходную точку на пол, если там свободно', () => {
    config.SAFE_RADIUS = 0;

    expect(place({ enemies: new Map(), x: 5, z: 5 })).toEqual([expect.closeTo(5, 5), HALF, expect.closeTo(5, 5)]);
  });

  it('Должен поставить врага ярусом выше, если точка занята', () => {
    config.SAFE_RADIUS = 0;

    expect(place({ enemies: createCrowd([{ x: 5, z: 5 }]), x: 5, z: 5 })).toEqual([
      expect.closeTo(5, 5),
      expect.closeTo(HALF + LAYER_STEP, 5),
      expect.closeTo(5, 5),
    ]);
  });

  it('Должен строить столб из врагов, появляющихся в одной точке', () => {
    config.SAFE_RADIUS = 0;

    const placer = createSpawnPlacer(new Map());
    const heights = [0, 1, 2].map(() => placer({ point: { x: 5, z: 5 }, size: SIZE }).y);

    expect(heights).toEqual([0, 1, 2].map((layer) => expect.closeTo(HALF + layer * LAYER_STEP, 5)));
  });

  it('Должен уйти вбок без наложения, только когда столб дорос до потолка', () => {
    config.SAFE_RADIUS = 0;

    const layersCount = Math.floor((config.DEATH_CEILING_HEIGHT - SIZE) / LAYER_STEP) + 1;
    const heights = Array.from({ length: layersCount }, (_, layer) => HALF + layer * LAYER_STEP);
    const column = createCrowd(heights.map((y) => ({ x: 5, y, z: 5 })));
    const [x, , z] = place({ enemies: column, x: 5, z: 5 });

    expect(Math.max(Math.abs(x - 5), Math.abs(z - 5))).toBeGreaterThanOrEqual(LAYER_STEP - 1e-9);
  });

  it('Должен учитывать поворот врага: угол повёрнутого куба торчит дальше', () => {
    config.SAFE_RADIUS = 0;

    const enemies = createCrowd([{ x: 5, z: 5 }]);
    const angle = Math.PI / 8;

    // Поворот на 45° вокруг вертикали: без учёта поворота точка в 1 м сбоку была бы свободна (нужно 0.95).
    for (const { body } of enemies.values()) {
      body.setRotation({ x: 0, y: Math.sin(angle), z: 0, w: Math.cos(angle) }, true);
    }

    expect(place({ enemies, x: 6, z: 5 })[1]).toBeCloseTo(HALF + LAYER_STEP, 5);
  });

  it('Должен поставить врага в исходную точку, если свободного места нет', () => {
    config.SAFE_RADIUS = 0;
    config.ARENA_SIZE = 4;
    config.DEATH_CEILING_HEIGHT = 1;

    const crowd = createCrowd(getGridPoints(2, 0.5));

    expect(place({ enemies: crowd, x: 0, z: 0 })).toEqual([expect.closeTo(0, 5), HALF, expect.closeTo(0, 5)]);
  });
});

describe('безопасная зона', () => {
  it('Должен прижать точку внутри зоны к её краю, сохранив направление от центра', () => {
    expect(place({ enemies: new Map(), x: 2, z: 0 })).toEqual([
      expect.closeTo(config.SAFE_RADIUS + HALF, 5),
      HALF,
      expect.closeTo(0, 5),
    ]);
  });

  it('Должен вынести точку из центра арены на край зоны', () => {
    const [x, , z] = place({ enemies: new Map(), x: 0, z: 0 });

    expect(Math.hypot(x, z)).toBeCloseTo(config.SAFE_RADIUS + HALF, 5);
  });

  it('Должен не искать свободное место внутри зоны, даже если там пусто', () => {
    // Весь пол вне зоны занят, свободен только «карман» внутри неё — подборщик обязан его обойти.
    const crowd = createCrowd(getGridPoints(14, 0.7).filter(({ x, z }) => Math.hypot(x, z) >= config.SAFE_RADIUS));
    const [x, , z] = place({ enemies: crowd, x: 2, z: 0 });

    expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(config.SAFE_RADIUS + HALF - 1e-9);
  });

  it('Должен ужать зону больше арены, чтобы у стены осталось кольцо', () => {
    config.ARENA_SIZE = 12;
    config.SAFE_RADIUS = 50;

    const [x, , z] = place({ enemies: new Map(), x: 0, z: 0 });

    // Эффективный радиус зоны = арена/2 − размер = 5.2, край — ещё на полкуба дальше.
    expect(Math.hypot(x, z)).toBeCloseTo(5.2 + HALF, 5);
  });
});
