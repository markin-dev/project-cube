// Свет сцены: два источника и их тени. Освещённость сцены целиком описывается конфигом
// (разделы «Свет» и «Тени» в src/config.ts), поэтому любой параметр можно подкрутить в панели
// настроек и увидеть результат сразу, без перезагрузки.
//
// Свет — единственный «физически правдоподобный» объект, который живёт вне физического мира Rapier:
// он не имеет тела и известен только сцене (THREE).
import * as THREE from 'three';
import { config } from './config';

// Расстояние солнца от центра арены, м. На самом солнце расстояние не влияет — лучи параллельны
// и светят одинаково откуда угодно, — но от него зависят ближняя и дальняя границы карты теней
// (см. refreshLights): солнце стоит «камерой» карты теней, и вся арена должна помещаться между ними.
const SUN_DISTANCE = 50;

// Градусы в радианы: углы в конфиге в градусах, тригонометрия ждёт радианы.
const DEGREE = Math.PI / 180;

// Карта теней — обычный рендер в текстуру: чем она больше, тем дороже кадр, но запасаться
// «на всякий случай» незачем. Поэтому размер выбирается в панели явно, из списка степеней двойки.
// При смене размера старую текстуру отпускаем (dispose) и обнуляем — three создаст новую сама.
export const SHADOW_MAP_SIZE_OPTIONS: Record<string, number> = {
  '512': 512,
  '1024': 1024,
  '2048': 2048,
  '4096': 4096,
};

export type Lights = {
  // Рассеянный свет «от неба»: сверху — цвет неба, снизу — цвет земли.
  hemisphere: THREE.HemisphereLight;

  // «Солнце»: параллельные лучи из точки position в сторону центра арены. Его же тени.
  sun: THREE.DirectionalLight;
};

// Создаёт оба источника света. Значения здесь — временные, их сразу перепишет refreshLights
// (его зовут и при старте, и при каждом изменении панели настроек).
export const createLights = (): Lights => ({
  hemisphere: new THREE.HemisphereLight('white', '#444455', 1.5),
  sun: new THREE.DirectionalLight('white', 2),
});

// Куда смотрит солнце: направление из двух углов конфига — высота над горизонтом и угол по кругу.
// Азимут откладывается от оси X к оси Z, высота — по оси Y, длина вектора всегда SUN_DISTANCE.
const getSunPosition = (): THREE.Vector3 => {
  const elevation = config.SUN_ELEVATION * DEGREE;
  const azimuth = config.SUN_AZIMUTH * DEGREE;
  const horizontal = Math.cos(elevation) * SUN_DISTANCE;

  return new THREE.Vector3(
    horizontal * Math.cos(azimuth),
    Math.sin(elevation) * SUN_DISTANCE,
    horizontal * Math.sin(azimuth),
  );
};

// Применяет к светилам текущий конфиг. Всё читается здесь, при каждом вызове, — правки в панели
// действуют сразу на уже освещённую сцену. Ничего не пересоздаётся: three сам пересчитывает
// световые матрицы каждый кадр, а карту теней перевыделяет, когда у неё обнулена текстура.
export const refreshLights = ({ hemisphere, sun }: Lights): void => {
  hemisphere.color.set(config.HEMISPHERE_SKY_COLOR);
  hemisphere.groundColor.set(config.HEMISPHERE_GROUND_COLOR);
  hemisphere.intensity = config.HEMISPHERE_INTENSITY;

  sun.color.set(config.SUN_COLOR);
  sun.intensity = config.SUN_INTENSITY;
  sun.position.copy(getSunPosition());

  // Тени считает только солнце, и только когда тени включены в целом (SHADOWS_ENABLED, см. scene.ts)
  // и само солнце светит (при нулевой яркости карта теней рисовалась бы впустую — тени всё равно не видно).
  sun.castShadow = config.SHADOWS_ENABLED && config.SUN_INTENSITY > 0;

  // ─── КАРТА ТЕНЕЙ ───────────────────────────────────────────────────────────

  // Размер карты — степень двойки из списка в панели. От размера зависит и качество тени, и цена
  // кадра, поэтому старую карту не оставляем висеть в памяти: dispose отпускает текстуру,
  // а null заставляет three выделить новую нужного размера при следующем кадре.
  const mapSize = SHADOW_MAP_SIZE_OPTIONS[String(config.SHADOW_MAP_SIZE)] ?? 1024;

  if (sun.shadow.mapSize.x !== mapSize) {
    sun.shadow.mapSize.set(mapSize, mapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }

  // Квадрат, который видит солнце при расчёте теней. Центр — арена (солнце светит в её центр),
  // поэтому половины сторон равны SHADOW_CAMERA_SIZE с каждой стороны. Границы поменялись —
  // проекцию надо пересчитать, иначе three продолжит рисовать тени в старый квадрат.
  const cameraSize = config.SHADOW_CAMERA_SIZE;
  sun.shadow.camera.left = -cameraSize;
  sun.shadow.camera.right = cameraSize;
  sun.shadow.camera.top = cameraSize;
  sun.shadow.camera.bottom = -cameraSize;

  // Ближняя граница — в метрах от солнца: ничего ближе не рисуем; дальняя — чтобы арена целиком
  // оказалась внутри, с запасом на врагов, улетевших выше потолка смерти или ниже пола.
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = SUN_DISTANCE + cameraSize * 2;
  sun.shadow.camera.updateProjectionMatrix();

  sun.shadow.intensity = config.SHADOW_STRENGTH;
  sun.shadow.bias = config.SHADOW_BIAS;
  sun.shadow.normalBias = config.SHADOW_NORMAL_BIAS;
};

// ─── СВЕТ ОТ СНАРЯДОВ ───────────────────────────────────────────────────────

// Максимум источников в пуле. Пул создаётся один раз в этом размере, а GLOW_LIGHT_COUNT из панели
// решает, сколько из них светит: лишние не убираются из сцены, а просто гаснут до нуля — иначе
// менялось бы число источников в шейдере и материалы пересобирались бы на каждое изменение.
export const MAX_GLOW_LIGHTS = 8;

// Насколько быстро свет гаснет по расстоянию: 2 — как в реальном мире (интенсивность падает
// как квадрат расстояния), 0 — источник светит одинаково далеко.
const GLOW_LIGHT_DECAY = 2;

// Один источник света на кадр: где светить, каким цветом и насколько ярко.
export type GlowSource = {
  position: THREE.Vector3Like;
  color: THREE.Color;

  // Насколько источник ещё горит: у вспышки попадания 1 сразу после удара и падает до 0, у летящей
  // пули постоянная. По этому числу источники делят между собой ограниченный пул.
  brightness: number;
};

// Пул источников. Создаётся один раз, дальше только двигается, перекрашивается и гаснет.
export const createGlowLights = (): THREE.PointLight[] =>
  Array.from({ length: MAX_GLOW_LIGHTS }, (): THREE.PointLight => {
    // distance — радиус света, м; decay — как быстро гаснет. intensity 0 — источник есть, но не светит.
    const light = new THREE.PointLight('white', 0, config.GLOW_LIGHT_DISTANCE, GLOW_LIGHT_DECAY);

    // Тени от этих источников не рисуем: точечный источник с тенью — это кубическая карта теней,
    // то есть шесть дополнительных проходов сцены за кадр на каждый источник.
    light.castShadow = false;

    return light;
  });

// Применяет к пулу конфиг: сколько источников светит и как далеко. Вызывается при старте и при каждом
// изменении панели. Смена числа видимых источников меняет шейдер — three пересобирает материалы сам
// (у него для этого свой счётчик состояния света), руками ничего пересобирать не нужно.
export const refreshGlowLights = (lights: THREE.PointLight[]): void => {
  const count = Math.min(Math.max(config.GLOW_LIGHT_COUNT, 0), MAX_GLOW_LIGHTS);

  lights.forEach((light, index): void => {
    // Видимость решает и общий выключатель, и доля пула (GLOW_LIGHT_COUNT).
    light.visible = config.GLOW_LIGHTS_ENABLED && index < count;
    light.distance = config.GLOW_LIGHT_DISTANCE;
    light.intensity = 0;
  });
};

// Распределяет пул по источникам кадра: самые горящие получают свет, остальные гаснут.
export const setGlowLights = (lights: THREE.PointLight[], sources: GlowSource[]): void => {
  // Источников за кадр больше, чем мест в пуле, поэтому оставляем самые яркие: свежая вспышка
  // попадания (brightness ~ 1) перебивает летящие пули, а по мере остывания уступает им место.
  const brightest = [...sources]
    .sort((first, second): number => second.brightness - first.brightness)
    .slice(0, lights.length);

  lights.forEach((light, index): void => {
    const source = brightest[index];

    // Мест не хватило — источник просто не светит. Сам он остаётся в сцене (см. refreshGlowLights),
    // поэтому число источников в шейдере не меняется.
    if (!source) {
      light.intensity = 0;

      return;
    }

    light.position.set(source.position.x, source.position.y, source.position.z);
    light.color.copy(source.color);
    light.intensity = config.GLOW_LIGHT_INTENSITY * source.brightness;
  });
};
