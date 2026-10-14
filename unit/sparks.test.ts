// Юнит-тесты искр (src/sparks.ts): сколько искр рождается, где, как гаснут и не проваливаются под пол,
// и вспышек попаданий (getBursts) — точек, которые подсвечивает свет от снарядов.
// Проверяем то, что уходит в отрисовку, — матрицы экземпляров InstancedMesh в сцене.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '@/config';
import { createSparks, type Sparks } from '@/sparks';
import { addTestEnemy, createTestWorld } from './fixtures';

const { world } = await createTestWorld();

const PROJECTILE_POSITION = { x: 3, y: 0.5, z: 0 };

// Сколько вспышек просим у getBursts: больше, чем их рождается в тесте, — чтобы лимит не прятал лишнее.
const BURST_COUNT = 8;

const createTestSparks = (): { scene: THREE.Scene; sparks: Sparks } => {
  const scene = new THREE.Scene();

  return { scene, sparks: createSparks({ scene }) };
};

// Положения видимых искр: экземпляры InstancedMesh с ненулевым масштабом. Масштаб — длина столбца
// матрицы: decompose у вырожденной (спрятанной) матрицы возвращает масштаб 1.
const getVisibleSparkPositions = (scene: THREE.Scene): THREE.Vector3[] => {
  const mesh = scene.children.find((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
  const matrix = new THREE.Matrix4();

  return Array.from({ length: mesh?.count ?? 0 }, (_, index) => {
    mesh?.getMatrixAt(index, matrix);

    const isVisible = new THREE.Vector3().setFromMatrixColumn(matrix, 0).length() > 0;

    return isVisible ? [new THREE.Vector3().setFromMatrixPosition(matrix)] : [];
  }).flat();
};

describe('spawn', () => {
  it.each([
    ['обычном', 6, false],
    ['критическом', 36, true],
  ])('Должен при %s попадании выпустить %s искр', (_, expected, isCrit) => {
    const { scene, sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: PROJECTILE_POSITION, isCrit });
    sparks.sync();

    expect(getVisibleSparkPositions(scene)).toHaveLength(expected);
  });

  it('Не должен выпускать искры при SPARKS_COUNT = 0', () => {
    config.SPARKS_COUNT = 0;

    const { scene, sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: PROJECTILE_POSITION });
    sparks.sync();

    expect(getVisibleSparkPositions(scene)).toHaveLength(0);
  });

  it('Должен рождать искры на поверхности врага, в которого попала пуля', () => {
    config.SPARKS_SPEED = 0;

    const { scene, sparks } = createTestSparks();
    const enemy = addTestEnemy({ world, scene, enemies: new Map(), x: 0, y: 0.4, z: 5 });

    sparks.spawn({ projectilePosition: { x: 0, y: 0.4, z: 3.5 }, enemy });
    sparks.sync();

    expect(getVisibleSparkPositions(scene)[0].toArray()).toEqual([
      expect.closeTo(0, 5),
      expect.closeTo(0.4, 5),
      expect.closeTo(4.6, 5),
    ]);
  });

  it('Должен перезаписывать самые старые искры, когда пул из 1000 полон', () => {
    config.SPARKS_COUNT = 30;

    const { scene, sparks } = createTestSparks();

    Array.from({ length: 40 }).forEach((): void => sparks.spawn({ projectilePosition: PROJECTILE_POSITION }));
    sparks.sync();

    expect(getVisibleSparkPositions(scene)).toHaveLength(1000);
  });
});

describe('цвет крит-искр', () => {
  it('Должен делать цвет крит-искр ярче на SPARKS_CRIT_GLOW_MULTIPLIER', () => {
    // По одной искре на попадание — чтобы цвет обычной лежал в слоте 0 буфера, критической — в слоте 1.
    config.SPARKS_COUNT = 1;
    config.SPARKS_CRIT_COUNT_MULTIPLIER = 1;

    const { scene, sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: PROJECTILE_POSITION });
    sparks.spawn({ projectilePosition: PROJECTILE_POSITION, isCrit: true });

    const mesh = scene.children.find((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    const colors = mesh?.instanceColor?.array ?? [];

    // Цвет крит-искры в её слоте буфера (r, g, b подряд) = SPARKS_CRIT_COLOR × множитель свечения.
    const expected = new THREE.Color(config.SPARKS_CRIT_COLOR).multiplyScalar(config.SPARKS_CRIT_GLOW_MULTIPLIER);

    expect(Array.from(colors.slice(3, 6))).toEqual([
      expect.closeTo(expected.r, 5),
      expect.closeTo(expected.g, 5),
      expect.closeTo(expected.b, 5),
    ]);
  });
});

describe('update', () => {
  it('Должен погасить искры после SPARKS_LIFETIME', () => {
    const { scene, sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: PROJECTILE_POSITION });
    sparks.update(config.SPARKS_LIFETIME + 0.01);
    sparks.sync();

    expect(getVisibleSparkPositions(scene)).toHaveLength(0);
  });

  it('Должен не проваливать искры под пол', () => {
    config.SPARKS_GRAVITY_SCALE = 2;

    const { scene, sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: { x: 3, y: 0.1, z: 0 } });
    Array.from({ length: 20 }).forEach((): void => sparks.update(0.02));
    sparks.sync();

    expect(Math.min(...getVisibleSparkPositions(scene).map(({ y }) => y))).toBeGreaterThanOrEqual(0);
  });
});

it('clear: Должен убрать все искры', () => {
  const { scene, sparks } = createTestSparks();

  sparks.spawn({ projectilePosition: PROJECTILE_POSITION });
  sparks.clear();
  sparks.sync();

  expect(getVisibleSparkPositions(scene)).toHaveLength(0);
});

describe('getBursts: вспышки попаданий для света', () => {
  it('Должен отдать вспышку с яркостью 1 сразу после удара', () => {
    const { sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: PROJECTILE_POSITION });

    const [burst] = sparks.getBursts(BURST_COUNT);

    expect(sparks.getBursts(BURST_COUNT)).toHaveLength(1);
    expect(burst.brightness).toBe(1);
    expect([burst.position.x, burst.position.y, burst.position.z]).toEqual([
      PROJECTILE_POSITION.x,
      PROJECTILE_POSITION.y,
      PROJECTILE_POSITION.z,
    ]);
  });

  it('Должен гасить вспышку по времени и отсеивать погасшие', () => {
    const { sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: PROJECTILE_POSITION });
    sparks.update(config.SPARKS_LIFETIME / 2);

    expect(sparks.getBursts(BURST_COUNT)[0].brightness).toBeCloseTo(0.5, 5);

    sparks.update(config.SPARKS_LIFETIME);

    expect(sparks.getBursts(BURST_COUNT)).toHaveLength(0);
  });

  it('Должен отдавать вспышки и гасить их, даже когда искры выключены', () => {
    config.SPARKS_COUNT = 0;

    const { sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: PROJECTILE_POSITION });

    expect(sparks.getBursts(BURST_COUNT)).toHaveLength(1);

    // Пул искр пуст (SPARKS_COUNT = 0), но вспышке света всё равно нужно стареть.
    sparks.update(config.SPARKS_LIFETIME / 4);

    expect(sparks.getBursts(BURST_COUNT)[0].brightness).toBeCloseTo(0.75, 5);
  });

  it('Должен отдать не больше count самых свежих вспышек', () => {
    const { sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: { x: 0, y: 1, z: 0 } });
    sparks.update(0.1);
    sparks.spawn({ projectilePosition: { x: 1, y: 1, z: 0 } });

    const bursts = sparks.getBursts(1);

    expect(bursts).toHaveLength(1);
    expect(bursts[0].brightness).toBe(1);
    expect(bursts[0].position.x).toBe(1);
  });

  it('clear: Должен убрать вспышки', () => {
    const { sparks } = createTestSparks();

    sparks.spawn({ projectilePosition: PROJECTILE_POSITION });
    sparks.clear();

    expect(sparks.getBursts(BURST_COUNT)).toHaveLength(0);
  });
});
