// Юнит-тесты анимации повышения уровня (src/level-up.ts): кривые вспышки, пульса и кольца, а также сам эффект
// на настоящих объектах three — куб игрока раздувается и светится, кольцо, столб и свет появляются
// и после конца анимации возвращаются в покой.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '@/config';
import { createLevelUpEffect, getFlash, getPulse, getRingSpread, type LevelUpEffect } from '@/level-up';
import { createPlayerCube } from '@/player';

type TestEffect = {
  effect: LevelUpEffect;
  scene: THREE.Scene;
  cube: THREE.Mesh;
};

// Эффект на свежем кубе игрока в пустой сцене.
const createTestEffect = (): TestEffect => {
  const scene = new THREE.Scene();
  const cube = createPlayerCube();

  scene.add(cube);

  return { effect: createLevelUpEffect({ scene, playerCube: cube }), scene, cube };
};

// Запускает анимацию и проматывает долю progress от её длительности.
const playTo = (effect: LevelUpEffect, progress: number): void => {
  effect.play();
  effect.update(config.LEVEL_UP_DURATION * progress);
};

// Свечение материала куба игрока (общий материал — Lambert); другой материал — свечения нет.
const getGlow = (cube: THREE.Mesh): number =>
  cube.material instanceof THREE.MeshLambertMaterial ? cube.material.emissiveIntensity : 0;

// Цвет куба (без «#»), как в конфиге; другой материал — пусто.
const getColorHex = (cube: THREE.Mesh): string =>
  cube.material instanceof THREE.MeshLambertMaterial ? cube.material.color.getHexString() : '';

// Видны ли кольцо и столб.
const getPartsVisibility = (scene: THREE.Scene): boolean[] =>
  ['level-up-ring', 'level-up-beam'].map((name) => scene.getObjectByName(name)?.visible ?? false);

describe('getFlash', () => {
  it.each([
    [0, 0],
    [0.1, 1],
    [1, 0],
  ])('Должен в момент %s дать яркость %s', (t, expected) => {
    expect(getFlash(t)).toBeCloseTo(expected, 6);
  });

  it('Должен гаснуть после пика', () => {
    expect(getFlash(0.6)).toBeLessThan(getFlash(0.3));
  });
});

describe('getPulse', () => {
  it.each([
    [0, 0],
    [0.15, 1],
    [1, 0],
  ])('Должен в момент %s дать пульс %s', (t, expected) => {
    expect(getPulse(t)).toBeCloseTo(expected, 6);
  });

  it('Должен сжать куб после пика — пружинка', () => {
    // Треть возврата: косинус дошёл до −1.
    expect(getPulse(0.15 + 0.85 / 3)).toBeLessThan(0);
  });
});

describe('getRingSpread', () => {
  it.each([
    [0, 0],
    [0.5, 0.875],
    [1, 1],
  ])('Должен в момент %s развести кольцо на долю %s', (t, expected) => {
    expect(getRingSpread(t)).toBeCloseTo(expected, 6);
  });
});

describe('createLevelUpEffect', () => {
  describe('во время анимации', () => {
    it('Должен раздуть куб на LEVEL_UP_PULSE в пике пульса', () => {
      const { effect, cube } = createTestEffect();

      playTo(effect, 0.15);

      expect(cube.scale.x).toBeCloseTo(1 + config.LEVEL_UP_PULSE, 5);
    });

    it('Должен зажечь куб до LEVEL_UP_GLOW в пике вспышки', () => {
      const { effect, cube } = createTestEffect();

      playTo(effect, 0.1);

      expect(getGlow(cube)).toBeCloseTo(config.LEVEL_UP_GLOW, 5);
    });

    it('Должен показать кольцо и столб', () => {
      const { effect, scene } = createTestEffect();

      playTo(effect, 0.3);

      expect(getPartsVisibility(scene)).toEqual([true, true]);
    });

    it('Должен дать источник света', () => {
      const { effect } = createTestEffect();

      playTo(effect, 0.3);

      expect(effect.getGlowSources()).toHaveLength(1);
    });
  });

  describe('после анимации', () => {
    it('Должен вернуть куб к обычному размеру и погасить его', () => {
      const { effect, cube } = createTestEffect();

      playTo(effect, 1.5);

      expect([cube.scale.x, getGlow(cube)]).toEqual([1, 0]);
    });

    it('Должен вернуть кубу цвет игрока', () => {
      const { effect, cube } = createTestEffect();

      playTo(effect, 1.5);

      expect(getColorHex(cube)).toBe(config.PLAYER_COLOR.slice(1));
    });

    it('Должен скрыть кольцо и столб', () => {
      const { effect, scene } = createTestEffect();

      playTo(effect, 1.5);

      expect(getPartsVisibility(scene)).toEqual([false, false]);
    });

    it('Должен убрать источник света', () => {
      const { effect } = createTestEffect();

      playTo(effect, 1.5);

      expect(effect.getGlowSources()).toEqual([]);
    });
  });

  it('Должен начать анимацию заново при повторном play', () => {
    const { effect, cube } = createTestEffect();

    playTo(effect, 0.9);
    playTo(effect, 0.1);

    expect(getGlow(cube)).toBeCloseTo(config.LEVEL_UP_GLOW, 5);
  });

  it('Должен держать куб в покое до первого play', () => {
    const { effect, cube } = createTestEffect();

    effect.update(0.5);

    expect(cube.scale.x).toBe(1);
  });
});
