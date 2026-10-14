// THREE — графика: рисует объекты на экране. О физике ничего не знает.
import * as THREE from 'three';
import { config } from './config';
import { createDeathWalls, refreshDeathWalls } from './death-walls';
import {
  createGlowLights,
  createLights,
  refreshGlowLights,
  refreshLights,
  type Lights,
} from './lighting';

// Как показывать места ярче белого, если задан тонмаппинг (см. TONE_MAPPING в config.ts).
// Ключи — значения из конфига, значения — режимы three. Partial (необязательные ключи): значение
// из панели может оказаться неизвестным, если конфиг поправили руками или сохранилось старое.
const TONE_MAPPING_BY_NAME: Partial<Record<string, THREE.ToneMapping>> = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
};

// Те же режимы для селекта в панели настроек: подпись в списке → имя режима в конфиге.
export const TONE_MAPPING_OPTIONS: Record<string, string> = {
  'Нет': 'none',
  'ACES Filmic': 'aces',
  'Reinhard': 'reinhard',
  'Cineon': 'cineon',
};

// Проверка «у объекта есть материал?» (меш, спрайт, линии) — type guard: запись
// `object is ... & { material: ... }` говорит компилятору, что после проверки у объекта есть поле
// material, и `as` не нужен. У части объектов материалов несколько — на один меш их список.
const hasMaterial = (
  object: THREE.Object3D,
): object is THREE.Object3D & { material: THREE.Material | THREE.Material[] } => 'material' in object;

// Просит three пересобрать шейдеры всех материалов сцены. Нужно, когда меняется то, что зашито
// в шейдер, а не в uniform: включение теней (в них закладывается работа с картой теней)
// и тонмаппинг (он применяется прямо в материале при отрисовке на экран).
const recompileMaterials = (scene: THREE.Scene): void => {
  scene.traverse((object): void => {
    if (!hasMaterial(object)) {
      return;
    }

    if (Array.isArray(object.material)) {
      object.material.forEach((material): void => {
        material.needsUpdate = true;
      });

      return;
    }

    object.material.needsUpdate = true;
  });
};

// ─── РАСЧЁТ ВИДИМОЙ ОБЛАСТИ ──────────────────────────────────────────────────

// В изометрии камера смотрит на пол по диагонали, поэтому квадрат арены выглядит как ромб.
// Левый и правый углы ромба — концы диагонали пола, до них от центра половина диагонали.
// Размер арены читается один раз при загрузке: пол и камера создаются один раз, поэтому
// ARENA_SIZE из панели настроек применяется только после перезагрузки страницы.
const ARENA_HALF_DIAGONAL = (config.ARENA_SIZE / 2) * Math.SQRT2;

// Верхний и нижний углы ромба — тоже концы диагонали, но камера смотрит на неё под углом ~35°,
// и в изометрии она сжимается ровно в √3 раз. Сверху над дальним углом ещё торчат стенки границы
// (death-walls.ts): вертикальный отрезок на экране укорачивается в √(3/2) раза. Их высота тоже читается
// при загрузке — если поменять её в панели, камера подстроится после перезагрузки.
// Запас 10% — чтобы арена не упиралась в края экрана.
const VIEW_MARGIN = 1.1;
const NEED_HALF_WIDTH = ARENA_HALF_DIAGONAL * VIEW_MARGIN;

const NEED_HALF_HEIGHT =
  (ARENA_HALF_DIAGONAL / Math.sqrt(3) + config.DEATH_WALL_HEIGHT * Math.sqrt(2 / 3)) * VIEW_MARGIN;

// Расстояние камеры от центра по каждой оси. На картинку в ортографической камере не влияет,
// важно лишь, чтобы вся арена оказалась между ближней и дальней границами отрисовки.
const CAMERA_DISTANCE = 30;

// Материал пола общий на модуль, чтобы его цвет можно было поменять из панели настроек (refreshSceneLook).
const FLOOR_MATERIAL = new THREE.MeshLambertMaterial({ color: config.FLOOR_COLOR });

type SceneParts = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;

  // Стенки границы смерти — нужны, чтобы обновлять их из панели настроек (refreshSceneLook).
  deathWalls: THREE.Group;

  // Источники света — их же обновляет refreshSceneLook (разделы «Свет» и «Тени» панели).
  lights: Lights;

  // Пул источников света от снарядов и искр — их же обновляет refreshSceneLook (раздел
  // «Свет от снарядов» панели); передвигает их по кадру setGlowLights.
  glowLights: THREE.PointLight[];
};

// Ортографическая камера видит прямоугольник мира: left/right/top/bottom — его границы в метрах.
// Подбираем их так, чтобы арена влезла целиком и по ширине, и по высоте:
// на широком экране упираемся в высоту, на узком (телефон вертикально) — в ширину.
// Пропорции прямоугольника совпадают с пропорциями экрана, иначе картинка растянется.
const fitCamera = (camera: THREE.OrthographicCamera): void => {
  const aspect = window.innerWidth / window.innerHeight;
  const halfHeight = Math.max(NEED_HALF_HEIGHT, NEED_HALF_WIDTH / aspect);
  const halfWidth = halfHeight * aspect;

  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;

  // Камера кэширует свои параметры и сама не узнает, что они поменялись.
  camera.updateProjectionMatrix();
};

export const createScene = (): SceneParts => {
  // Сцена — контейнер для всего, что нужно нарисовать: объектов, света, камер.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.BACKGROUND_COLOR);

  // Ортографическая камера, в отличие от перспективной, не уменьшает дальние объекты —
  // так устроены изометрические игры. Границы видимой области задаёт fitCamera,
  // здесь нули — временная заглушка. 0.1 и 100 — ближняя и дальняя границы отрисовки.
  const camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 100);

  // Классическая изометрия: камера на одинаковом расстоянии по X, Y и Z от центра
  // и смотрит в центр — то есть на 45° сбоку и примерно на 35° сверху.
  camera.position.set(CAMERA_DISTANCE, CAMERA_DISTANCE, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);
  fitCamera(camera);

  // Рендерер рисует сцену через WebGL (видеокарту) на элемент <canvas>.
  // antialias сглаживает «лесенки» на краях объектов.
  const renderer = new THREE.WebGLRenderer({ antialias: true });

  // На экранах с высокой плотностью пикселей (телефоны, Retina) рисуем чётче,
  // но не больше чем в 2 раза — иначе на слабых устройствах просядет частота кадров.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // renderer.domElement — это и есть <canvas>. Без добавления на страницу его не будет видно.
  document.body.append(renderer.domElement);

  // ─── ТЕНИ ──────────────────────────────────────────────────────────────────
  // Тени — карта теней, которую солнце «снимает» перед кадром: по ней видно, что загораживает свет.
  // Включаются сразу двумя условиями: здесь (renderer.shadowMap.enabled) и флагом castShadow
  // у самого источника (его поднимает refreshLights). Пока включены оба — тени рисуются.
  // PCFShadowMap — фильтрация карты теней (мягкие края); PCFSoftShadowMap в этой версии three удалён.
  renderer.shadowMap.enabled = config.SHADOWS_ENABLED;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // ─── СВЕТ ──────────────────────────────────────────────────────────────────

  // Без света MeshLambertMaterial будет чёрным. Два источника, оба настраиваются в панели
  // (разделы «Свет» и «Тени»): рассеянный «от неба» заполняет тени, а солнце даёт разную
  // яркость граням и отбрасывает тени. Подробно — src/lighting.ts.
  const lights = createLights();

  scene.add(lights.hemisphere, lights.sun);

  // Пул точечных источников, которые каждый кадр переезжают на светящиеся точки — летящие пули
  // и свежие вспышки попаданий (см. lighting.ts и main.ts). В сцене они с самого начала,
  // но пока не горят (intensity 0).
  const glowLights = createGlowLights();

  scene.add(...glowLights);

  // ─── ПОЛ ───────────────────────────────────────────────────────────────────

  // Видимый пол. Сталкиваются тела не с ним, а с его физическим двойником — коллайдером
  // такого же размера из physics.ts. Высота 0.2, центр опущен на 0.1 — верхняя поверхность ровно на y = 0.
  // receiveShadow — пол принимает тени (сам тени не отбрасывает: он плоский и лежит на месте солнца).
  const floor = new THREE.Mesh(new THREE.BoxGeometry(config.ARENA_SIZE, 0.2, config.ARENA_SIZE), FLOOR_MATERIAL);

  floor.position.y = -0.1;
  floor.receiveShadow = true;
  scene.add(floor);

  // Прозрачные стенки по краям пола — граница, за которой враг погибает.
  const deathWalls = createDeathWalls();
  scene.add(deathWalls);

  // Первое применение конфига к свету, теням и тонмаппингу: сцена собирается по умолчаниям кода,
  // а сохранённые в браузере правки панели должны вступить в силу сразу при загрузке.
  refreshSceneLook({ scene, renderer, deathWalls, lights, glowLights });

  // При изменении размера окна заново вписываем арену и меняем размер canvas.
  window.addEventListener('resize', (): void => {
    fitCamera(camera);
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, deathWalls, lights, glowLights };
};

// Обновляет фон, пол, стенки границы, свет и тени по текущему конфигу — вызывается из панели настроек
// при каждом изменении (applyLiveConfig в main.ts) и один раз при создании сцены.
export const refreshSceneLook = ({
  scene,
  renderer,
  deathWalls,
  lights,
  glowLights,
}: Pick<SceneParts, 'scene' | 'renderer' | 'deathWalls' | 'lights' | 'glowLights'>): void => {
  scene.background = new THREE.Color(config.BACKGROUND_COLOR);
  FLOOR_MATERIAL.color.set(config.FLOOR_COLOR);
  refreshDeathWalls(deathWalls);
  refreshLights(lights);
  refreshGlowLights(glowLights);

  // Тонмаппинг и работа с картой теней зашиты в шейдеры материалов — при их смене шейдеры нужно
  // пересобрать, иначе картинка останется прежней. Остальные настройки света (яркость, цвета,
  // положение солнца, карта теней) — uniform'ы: three обновит их сам, пересборка не нужна.
  const nextToneMapping = TONE_MAPPING_BY_NAME[config.TONE_MAPPING] ?? THREE.NoToneMapping;
  const isToneMappingChanged = renderer.toneMapping !== nextToneMapping;
  const isShadowsChanged = renderer.shadowMap.enabled !== config.SHADOWS_ENABLED;

  if (isToneMappingChanged || isShadowsChanged) {
    renderer.toneMapping = nextToneMapping;
    renderer.shadowMap.enabled = config.SHADOWS_ENABLED;
    recompileMaterials(scene);
  }
};
