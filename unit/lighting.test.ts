// Юнит-тесты света (src/lighting.ts): refreshLights применяет к источникам текущий конфиг —
// положение солнца, цвета, яркости и настройки карты теней; пул источников от снарядов
// (createGlowLights, refreshGlowLights, setGlowLights) включается, гаснет и переезжает по кадрам.
// Свет — обычные объекты THREE, их можно создать и проверить без WebGL, поэтому тесты идут в Node.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '@/config';
import {
  createGlowLights,
  createLights,
  refreshGlowLights,
  refreshLights,
  setGlowLights,
  MAX_GLOW_LIGHTS,
  type GlowSource,
} from '@/lighting';

// Ось вектора позиции: так положение солнца проверяется по одной координате за тест.
type Axis = 'x' | 'y' | 'z';

// Расстояние солнца от центра арены — константа модуля lighting.ts (SUN_DISTANCE).
const SUN_DISTANCE = 50;

describe('положение солнца', () => {
  // Солнце на высоте 30° и азимуте 90°: y = sin(30°) × 50 = 25, горизонтальная составляющая
  // cos(30°) × 50 ≈ 43.3 уходит целиком в z, потому что азимут 90° — это направление к z.
  const SUN_POSITION: Array<[Axis, number]> = [
    ['x', 0],
    ['y', 25],
    ['z', 43.301],
  ];

  it.each(SUN_POSITION)('Должен ставить солнце с координатой %s = %s', (axis, expected) => {
    config.SUN_ELEVATION = 30;
    config.SUN_AZIMUTH = 90;

    const lights = createLights();

    refreshLights(lights);

    expect(lights.sun.position[axis]).toBeCloseTo(expected, 3);
  });

  it('Должен держать солнце на SUN_DISTANCE от центра арены при любом направлении', () => {
    config.SUN_ELEVATION = 12;
    config.SUN_AZIMUTH = 213;

    const lights = createLights();

    refreshLights(lights);

    expect(lights.sun.position.length()).toBeCloseTo(SUN_DISTANCE, 6);
  });
});

describe('цвета и яркости', () => {
  it('Должен окрашивать солнце в цвет из конфига', () => {
    config.SUN_COLOR = '#ff0000';

    const lights = createLights();

    refreshLights(lights);

    expect(lights.sun.color.getHexString()).toBe('ff0000');
  });

  it('Должен задавать рассеянному свету цвета неба и земли из конфига', () => {
    config.HEMISPHERE_SKY_COLOR = '#00ff00';
    config.HEMISPHERE_GROUND_COLOR = '#0000ff';

    const lights = createLights();

    refreshLights(lights);

    expect(`${lights.hemisphere.color.getHexString()}-${lights.hemisphere.groundColor.getHexString()}`).toBe(
      '00ff00-0000ff',
    );
  });

  const INTENSITY_CASES: Array<[string, 'SUN_INTENSITY' | 'HEMISPHERE_INTENSITY', number]> = [
    ['солнце', 'SUN_INTENSITY', 3.5],
    ['рассеянный свет', 'HEMISPHERE_INTENSITY', 0.25],
  ];

  it.each(INTENSITY_CASES)('Должен задавать яркость %s из конфига', (_, key, intensity) => {
    config[key] = intensity;

    const lights = createLights();

    refreshLights(lights);

    expect(key === 'SUN_INTENSITY' ? lights.sun.intensity : lights.hemisphere.intensity).toBe(intensity);
  });
});

describe('отбрасывание теней', () => {
  it('Должен отбрасывать тени, когда тени включены и солнце светит', () => {
    const lights = createLights();

    refreshLights(lights);

    expect(lights.sun.castShadow).toBe(true);
  });

  it('Должен не отбрасывать тени, когда тени выключены в конфиге', () => {
    config.SHADOWS_ENABLED = false;

    const lights = createLights();

    refreshLights(lights);

    expect(lights.sun.castShadow).toBe(false);
  });

  it('Должен не отбрасывать тени, когда солнце не светит', () => {
    config.SUN_INTENSITY = 0;

    const lights = createLights();

    refreshLights(lights);

    expect(lights.sun.castShadow).toBe(false);
  });
});

describe('карта теней', () => {
  it('Должен расширять камеру теней до SHADOW_CAMERA_SIZE с каждой стороны', () => {
    config.SHADOW_CAMERA_SIZE = 20;

    const lights = createLights();

    refreshLights(lights);

    expect(lights.sun.shadow.camera.left).toBe(-20);
  });

  it('Должен применять непрозрачность и сдвиги тени из конфига', () => {
    config.SHADOW_STRENGTH = 0.4;
    config.SHADOW_BIAS = -0.002;
    config.SHADOW_NORMAL_BIAS = 0.05;

    const lights = createLights();

    refreshLights(lights);

    const shadows = lights.sun.shadow;

    expect([shadows.intensity, shadows.bias, shadows.normalBias]).toEqual([0.4, -0.002, 0.05]);
  });

  it('Должен перевыделять карту теней, когда в конфиге другой её размер', () => {
    config.SHADOW_MAP_SIZE = 2048;

    const lights = createLights();

    // Старая карта — такая же, какую three создаёт сам: настоящий рендер-таргет, без контекста WebGL.
    lights.sun.shadow.map = new THREE.WebGLRenderTarget(64, 64);

    refreshLights(lights);

    expect([lights.sun.shadow.mapSize.x, lights.sun.shadow.map]).toEqual([2048, null]);
  });
});

describe('свет от снарядов: пул', () => {
  it('Должен создавать пул из MAX_GLOW_LIGHTS источников, не отбрасывающих теней', () => {
    const glowLights = createGlowLights();

    expect(glowLights).toHaveLength(MAX_GLOW_LIGHTS);

    // Тени от точечных источников не рисуем: это кубическая карта теней — шесть проходов сцены
    // за кадр на источник (см. createGlowLights).
    expect(glowLights.every(({ castShadow }) => castShadow === false)).toBe(true);
  });

  it('Должен включать первые GLOW_LIGHT_COUNT источников, а остальные держать выключенными', () => {
    config.GLOW_LIGHT_COUNT = 3;

    const glowLights = createGlowLights();

    refreshGlowLights(glowLights);

    expect(glowLights.map(({ visible }) => visible).filter(Boolean)).toHaveLength(3);
  });

  it('Должен выключать все источники, когда свет от снарядов выключен', () => {
    config.GLOW_LIGHTS_ENABLED = false;
    config.GLOW_LIGHT_COUNT = 4;

    const glowLights = createGlowLights();

    refreshGlowLights(glowLights);

    expect(glowLights.some(({ visible }) => visible)).toBe(false);
  });

  it('Должен не включать больше источников, чем есть в пуле', () => {
    config.GLOW_LIGHT_COUNT = MAX_GLOW_LIGHTS + 5;

    const glowLights = createGlowLights();

    refreshGlowLights(glowLights);

    expect(glowLights.filter(({ visible }) => visible)).toHaveLength(MAX_GLOW_LIGHTS);
  });

  it('Должен задавать радиус света из конфига', () => {
    config.GLOW_LIGHT_DISTANCE = 12;

    const glowLights = createGlowLights();

    refreshGlowLights(glowLights);

    expect(glowLights[0].distance).toBe(12);
  });
});

describe('свет от снарядов: распределение по кадру', () => {
  // Источник света на тест: позиция, цвет и яркость «горения» (см. GlowSource).
  const createSource = (brightness: number, x: number, color = '#ffffff'): GlowSource => ({
    position: { x, y: 1, z: 0 },
    color: new THREE.Color(color),
    brightness,
  });

  it('Должен отдавать места самым ярким источникам кадра', () => {
    const glowLights = createGlowLights();

    setGlowLights(glowLights, [createSource(0.2, 5), createSource(0.9, 7)]);

    expect(glowLights.map(({ position }) => position.x)).toEqual([7, 5, 0, 0, 0, 0, 0, 0]);
  });

  it('Должен умножать яркость источника на GLOW_LIGHT_INTENSITY', () => {
    config.GLOW_LIGHT_INTENSITY = 3;

    const glowLights = createGlowLights();

    setGlowLights(glowLights, [createSource(0.5, 0)]);

    expect(glowLights[0].intensity).toBe(1.5);
  });

  it('Должен перекрашивать источник в цвет светящейся точки', () => {
    const glowLights = createGlowLights();

    setGlowLights(glowLights, [createSource(1, 0, '#ff0000')]);

    expect(glowLights[0].color.getHexString()).toBe('ff0000');
  });

  it('Должен гасить источники, которым не хватило мест', () => {
    const glowLights = createGlowLights();

    setGlowLights(glowLights, [createSource(1, 0)]);

    expect(glowLights.slice(1).every(({ intensity }) => intensity === 0)).toBe(true);
  });
});
