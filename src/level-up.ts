// Анимация повышения уровня куба игрока. Пять частей идут одновременно:
//   вспышка  — куб загорается цветом LEVEL_UP_COLOR ярче белого (вокруг него ореол bloom) и гаснет;
//   пульс    — куб раздувается на LEVEL_UP_PULSE и пружинисто возвращается (только картинка — коллайдер прежний);
//   кольцо   — по полу от куба расходится светящееся кольцо до LEVEL_UP_RING_RADIUS и тает;
//   столб    — над кубом встаёт столб света высотой LEVEL_UP_BEAM_HEIGHT, сужается и тает;
//   свет     — источник из пула света снарядов (см. lighting.ts) подсвечивает пол и врагов вокруг.
// Время — игровое, как у искр: шаги приходят из цикла кадров (main.ts), на паузе анимация замирает.
// Параметры читаются каждый кадр — правки панели действуют сразу.
import * as THREE from 'three';
import { config } from './config';
import type { GlowSource } from './lighting';
import { setPlayerGlow } from './player';

// Доля анимации, за которую вспышка набирает полную яркость. Дальше она гаснет до конца анимации.
const FLASH_RISE = 0.1;

// Доля анимации, за которую куб раздувается до пика пульса, и сколько полуколебаний «пружинки» он делает
// на возврате (3 — сжался, снова чуть раздулся, успокоился).
const PULSE_RISE = 0.15;
const PULSE_HALF_WAVES = 3;

// Доля анимации, за которую столб света вырастает на полную высоту.
const BEAM_RISE = 0.2;

// Столб чуть уже куба и полупрозрачен: он подсвечивает куб, а не закрывает его.
const BEAM_WIDTH = 0.9;
const BEAM_OPACITY = 0.5;

// Внутренний радиус кольца — доля внешнего: кольцо толщиной в десятую часть радиуса.
const RING_INNER = 0.9;

// Чуть выше пола, чтобы кольцо не мерцало, сливаясь с его поверхностью.
const RING_HEIGHT = 0.02;

// Яркость источника света в пике. Больше единицы — в пуле света (setGlowLights) вспышка уровня
// перебивает и вспышки попаданий (до 1), и летящие пули (0.6) и всегда получает источник.
const LIGHT_BRIGHTNESS = 2;

// Насколько выше верха куба висит источник света, м: так он освещает и куб, и пол вокруг.
const LIGHT_LIFT = 1;

// Яркость вспышки в момент t (доля анимации, 0…1): быстро вверх до 1, потом плавно вниз до 0
// (квадрат — гаснет сначала быстро, потом мягко). Вне анимации — 0.
export const getFlash = (t: number): number => {
  if (t <= 0 || t >= 1) {
    return 0;
  }

  return t < FLASH_RISE ? t / FLASH_RISE : ((1 - t) / (1 - FLASH_RISE)) ** 2;
};

// Пульс куба в момент t: доля от LEVEL_UP_PULSE, на которую куб сейчас больше обычного (меньше нуля —
// сжат). Сначала плавный подъём до 1 (четверть синусоиды), потом затухающее колебание косинусом:
// пик → сжатие → маленький пик → покой. Множитель (1 − x)² гасит колебание к концу ровно в ноль.
export const getPulse = (t: number): number => {
  if (t <= 0 || t >= 1) {
    return 0;
  }

  if (t < PULSE_RISE) {
    return Math.sin(((t / PULSE_RISE) * Math.PI) / 2);
  }

  const back = (t - PULSE_RISE) / (1 - PULSE_RISE);

  return Math.cos(back * PULSE_HALF_WAVES * Math.PI) * (1 - back) ** 2;
};

// Насколько кольцо разошлось в момент t (доля от LEVEL_UP_RING_RADIUS): быстро в начале, медленно
// к концу — как волна, теряющая силу (кубическое замедление).
export const getRingSpread = (t: number): number => 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3;

export type LevelUpEffect = {
  // Начать анимацию сначала — и когда она уже идёт (новый уровень посреди анимации).
  play: () => void;

  // Продвинуть анимацию на delta секунд игрового времени. После конца всё возвращается в покой.
  update: (delta: number) => void;

  // Источник света для пула (setGlowLights в lighting.ts): пока вспышка горит — один, иначе пусто.
  getGlowSources: () => GlowSource[];
};

// Материал, светящийся сам по себе: свет сцены на него не действует, цвет может быть ярче белого.
// Additive — цвет прибавляется к тому, что за ним (свет, а не краска); depthWrite: false — прозрачное
// не закрывает собой то, что за ним.
const createGlowMaterial = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

// Плоское кольцо на полу с внешним радиусом 1 — нужный радиус задаёт масштаб.
const createRing = (): THREE.Mesh => {
  const ring = new THREE.Mesh(new THREE.RingGeometry(RING_INNER, 1, 64), createGlowMaterial());

  ring.name = 'level-up-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = RING_HEIGHT;
  ring.visible = false;

  return ring;
};

// Столб: открытый цилиндр радиуса 1 и высоты 1 (размер — масштабом). Цвет вершин тает снизу вверх
// от 1 до 0 — столб растворяется в высоте, а не обрывается.
const createBeam = (): THREE.Mesh => {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
  const positions = geometry.getAttribute('position');

  // y вершин цилиндра — от −0.5 (низ) до 0.5 (верх): низ получает 1, верх 0.
  const colors = Array.from({ length: positions.count }, (_, index) => 0.5 - positions.getY(index)).flatMap(
    (brightness) => [brightness, brightness, brightness],
  );

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = createGlowMaterial();

  material.vertexColors = true;

  const beam = new THREE.Mesh(geometry, material);

  beam.name = 'level-up-beam';
  beam.visible = false;

  return beam;
};

// Проверка «материал меша — простой самосветящийся (MeshBasicMaterial)?» — у кольца и столба он один.
const hasBasicMaterial = (mesh: THREE.Mesh): mesh is THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> =>
  mesh.material instanceof THREE.MeshBasicMaterial;

// Красит самосветящийся меш: цвет уровня × яркость вспышки, прозрачность — доля в моменте.
const paintGlow = ({ mesh, brightness, opacity }: { mesh: THREE.Mesh; brightness: number; opacity: number }): void => {
  if (!hasBasicMaterial(mesh)) {
    return;
  }

  mesh.material.color.set(config.LEVEL_UP_COLOR).multiplyScalar(brightness);
  mesh.material.opacity = opacity;
};

// Создаёт анимацию для куба игрока playerCube (он уже в сцене). Кольцо и столб добавляются в scene
// и стоят невидимыми до первого повышения уровня.
export const createLevelUpEffect = ({
  scene,
  playerCube,
}: {
  scene: THREE.Scene;
  playerCube: THREE.Mesh;
}): LevelUpEffect => {
  const ring = createRing();
  const beam = createBeam();

  scene.add(ring, beam);

  const state = { age: 0, isPlaying: false };

  // Доля пройденной анимации, 0…1. Нулевая длительность — анимация сразу закончена.
  const getProgress = (): number =>
    config.LEVEL_UP_DURATION > 0 ? Math.min(state.age / config.LEVEL_UP_DURATION, 1) : 1;

  // Ставит все части анимации в момент t. При t = 1 кривые дают ноль — куб обычного размера и не светится,
  // кольцо и столб скрыты.
  const applyFrame = (t: number): void => {
    const flash = getFlash(t);
    const fade = 1 - t;

    playerCube.scale.setScalar(1 + config.LEVEL_UP_PULSE * getPulse(t));
    setPlayerGlow({ color: config.LEVEL_UP_COLOR, intensity: config.LEVEL_UP_GLOW * flash, tint: flash });

    const ringRadius = config.LEVEL_UP_RING_RADIUS * getRingSpread(t);

    ring.visible = t < 1 && ringRadius > 0;
    ring.scale.setScalar(Math.max(ringRadius, 1e-3));
    paintGlow({ mesh: ring, brightness: config.LEVEL_UP_GLOW, opacity: fade * fade });

    const beamHeight = config.LEVEL_UP_BEAM_HEIGHT * Math.min(t / BEAM_RISE, 1);
    const beamRadius = (config.PLAYER_SIZE / 2) * BEAM_WIDTH * fade;

    beam.visible = t < 1 && beamHeight > 0 && beamRadius > 0;
    beam.scale.set(Math.max(beamRadius, 1e-3), Math.max(beamHeight, 1e-3), Math.max(beamRadius, 1e-3));
    beam.position.y = beamHeight / 2;
    paintGlow({ mesh: beam, brightness: config.LEVEL_UP_GLOW, opacity: BEAM_OPACITY * flash });
  };

  const play = (): void => {
    state.age = 0;
    state.isPlaying = true;
    applyFrame(0);
  };

  const update = (delta: number): void => {
    if (!state.isPlaying) {
      return;
    }

    state.age += delta;

    const t = getProgress();

    applyFrame(t);
    state.isPlaying = t < 1;
  };

  const getGlowSources = (): GlowSource[] => {
    const brightness = state.isPlaying ? LIGHT_BRIGHTNESS * getFlash(getProgress()) : 0;

    if (brightness <= 0) {
      return [];
    }

    return [
      {
        position: { x: 0, y: config.PLAYER_SIZE + LIGHT_LIFT, z: 0 },
        color: new THREE.Color(config.LEVEL_UP_COLOR),
        brightness,
      },
    ];
  };

  return { play, update, getGlowSources };
};
