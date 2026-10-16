// Юнит-тесты демо-сцены (src/demo-scene.ts): все модельки на месте и стоят на полу,
// линейка выстроена вдоль экранной горизонтали без наложений, полоска здоровья показывает
// частичное здоровье, refresh перечитывает фон и цвета кучек искр.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { config, DEFAULT_CONFIG, ENEMY_KIND_NAMES } from '@/config';
import { createDemoScene, SCENE_MODE_OPTIONS } from '@/demo-scene';
import { getSparkColor } from '@/sparks';

const createTestCamera = (): THREE.OrthographicCamera => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

// Имена всех модельек линейки — как их раскладывает createDemoScene.
const ROW_NAMES = [
  'demo-player',
  ...ENEMY_KIND_NAMES.map((name) => `demo-enemy-${name}`),
  'demo-corpse',
  'demo-projectile',
  'demo-projectile-crit',
  'demo-sparks',
  'demo-sparks-crit',
];

const createDemo = (): ReturnType<typeof createDemoScene> => createDemoScene({ camera: createTestCamera() });

describe('Демо-сцена', () => {
  it('Должна содержать все модельки: игрока, пять типов врагов, призрак, снаряды, искры и полоску HP', () => {
    const { scene } = createDemo();

    ROW_NAMES.forEach((name): void => {
      expect(scene.getObjectByName(name), name).toBeDefined();
    });

    expect(scene.getObjectByName('demo-hp-bar')).toBeDefined();
  });

  it('Должна ставить кубы на пол: центр по высоте — половина стороны', () => {
    const { scene } = createDemo();

    const positions: Record<string, number> = {
      'demo-player': config.PLAYER_SIZE / 2,
      'demo-corpse': config.ENEMY_KINDS.normal.size / 2,
      'demo-projectile': config.PROJECTILE_SIZE / 2,
      'demo-projectile-crit': (config.PROJECTILE_SIZE * config.CRIT_PROJECTILE_SIZE_MULTIPLIER) / 2,
    };

    ENEMY_KIND_NAMES.forEach((name): void => {
      positions[`demo-enemy-${name}`] = config.ENEMY_KINDS[name].size / 2;
    });

    Object.entries(positions).forEach(([name, expectedY]): void => {
      expect(scene.getObjectByName(name)?.position.y, name).toBeCloseTo(expectedY, 5);
    });
  });

  it('Должна выстраивать линейку вдоль (1, 0, −1): x = −z и равные промежутки', () => {
    const { scene } = createDemo();

    const xs = ROW_NAMES.map((name): number => {
      const object = scene.getObjectByName(name);

      if (!object) {
        throw new Error(`моделька ${name} не найдена`);
      }

      expect(object.position.z, name).toBeCloseTo(-object.position.x, 5);

      return object.position.x;
    });

    // Одинаковый шаг между соседями — модельки не слипаются и не разбегаются.
    const steps = xs.slice(1).map((x, index): number => x - xs[index]);

    steps.forEach((step): void => {
      expect(step).toBeCloseTo(steps[0], 5);
    });

    // Шаг положительный: предметы идут по направлению, а не перепутаны местами.
    expect(steps[0]).toBeGreaterThan(0);
  });

  it('Должна показывать полоску HP с частичным здоровьем над врагом normal', () => {
    const { scene } = createDemo();

    const hpBar = scene.getObjectByName('demo-hp-bar');
    const enemyCube = scene.getObjectByName('demo-enemy-normal');

    if (!hpBar || !enemyCube) {
      throw new Error('полоска HP или куб normal не найдены');
    }

    // Видимая полоска (иначе setHpBarValue спрятал бы её) с длиной 0.6 от полной.
    expect(hpBar.visible).toBe(true);

    // В группе два меша: подложка (индекс 0) и зелёная заливка (индекс 1) — см. createHpBar.
    const fill = hpBar.children[1];

    if (!fill) {
      throw new Error('зелёная заливка полоски не найдена');
    }

    expect(fill.scale.x).toBeCloseTo(config.HP_BAR_WIDTH * 0.6, 5);

    // Над центром куба: полстороны куба плюс зазор (как у настоящих врагов).
    expect(hpBar.position.y).toBeCloseTo(
      enemyCube.position.y + config.ENEMY_KINDS.normal.size / 2 + config.HP_BAR_GAP,
      5,
    );
  });

  it('Должна обновлять фон и цвет кучек искр при refresh', () => {
    const { scene, refresh } = createDemo();

    config.BACKGROUND_COLOR = '#ff0000';
    config.SPARKS_GLOW = 2;
    config.SPARKS_CRIT_COLOR = '#00ff00';
    refresh();

    expect((scene.background as THREE.Color).getHexString()).toBe('ff0000');

    const sparks = scene.getObjectByName('demo-sparks');
    const critSparks = scene.getObjectByName('demo-sparks-crit');

    if (!sparks || !critSparks) {
      throw new Error('кучки искр не найдены');
    }

    const expectedColor = getSparkColor(false).multiplyScalar(2);
    const material = (sparks.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;

    expect(material.color.r).toBeCloseTo(expectedColor.r, 5);
    expect(material.color.g).toBeCloseTo(expectedColor.g, 5);
    expect(material.color.b).toBeCloseTo(expectedColor.b, 5);

    const expectedCritColor = getSparkColor(true).multiplyScalar(2);
    const critMaterial = (critSparks.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;

    expect(critMaterial.color.r).toBeCloseTo(expectedCritColor.r, 5);
  });
});

describe('Селект сцены в панели', () => {
  it('Должен предлагать режимы game и demo, по умолчанию — игра', () => {
    expect(SCENE_MODE_OPTIONS['Игра']).toBe('game');
    expect(SCENE_MODE_OPTIONS['Демо (модельки)']).toBe('demo');
    expect(DEFAULT_CONFIG.SCENE_MODE).toBe('game');
  });
});
