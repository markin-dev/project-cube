// THREE — графика: рисует объекты на экране. О физике ничего не знает.
import * as THREE from 'three';
import { config } from './config';

// ─── РАСЧЁТ ВИДИМОЙ ОБЛАСТИ ──────────────────────────────────────────────────

// В изометрии камера смотрит на пол по диагонали, поэтому квадрат арены выглядит как ромб.
// Левый и правый углы ромба — концы диагонали пола, до них от центра половина диагонали.
// Размер арены читается один раз при загрузке: пол и камера создаются один раз, поэтому
// ARENA_SIZE из панели настроек применяется только после перезагрузки страницы.
const ARENA_HALF_DIAGONAL = (config.ARENA_SIZE / 2) * Math.SQRT2;

// Верхний и нижний углы ромба — тоже концы диагонали, но камера смотрит на неё под углом ~35°,
// и в изометрии она сжимается ровно в √3 раз.
// Запас 10% — чтобы арена не упиралась в края экрана.
const VIEW_MARGIN = 1.1;
const NEED_HALF_WIDTH = ARENA_HALF_DIAGONAL * VIEW_MARGIN;
const NEED_HALF_HEIGHT = (ARENA_HALF_DIAGONAL / Math.sqrt(3)) * VIEW_MARGIN;

// Расстояние камеры от центра по каждой оси. На картинку в ортографической камере не влияет,
// важно лишь, чтобы вся арена оказалась между ближней и дальней границами отрисовки.
const CAMERA_DISTANCE = 30;

// Материал пола общий на модуль, чтобы его цвет можно было поменять из панели настроек (refreshSceneColors).
const FLOOR_MATERIAL = new THREE.MeshLambertMaterial({ color: config.FLOOR_COLOR });

type SceneParts = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
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

  // ─── СВЕТ ──────────────────────────────────────────────────────────────────

  // Без света MeshLambertMaterial будет чёрным. Два источника:
  // HemisphereLight — мягкий рассеянный свет «от неба» (сверху светлее) и «от земли» (снизу темнее);
  // DirectionalLight — «солнце»: параллельные лучи из точки position в сторону центра.
  // Солнце светит на грани куба под разными углами, поэтому грани получаются разной яркости
  // и куб выглядит объёмным, а не плоским шестиугольником.
  scene.add(new THREE.HemisphereLight('white', '#444455', 1.5));

  const sun = new THREE.DirectionalLight('white', 2);
  sun.position.set(4, 10, 7);
  scene.add(sun);

  // ─── ПОЛ ───────────────────────────────────────────────────────────────────

  // Видимый пол. Сталкиваются тела не с ним, а с его физическим двойником — коллайдером
  // такого же размера из physics.ts. Высота 0.2, центр опущен на 0.1 — верхняя поверхность ровно на y = 0.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(config.ARENA_SIZE, 0.2, config.ARENA_SIZE), FLOOR_MATERIAL);
  floor.position.y = -0.1;
  scene.add(floor);

  // При изменении размера окна заново вписываем арену и меняем размер canvas.
  window.addEventListener('resize', (): void => {
    fitCamera(camera);
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer };
};

// Перекрашивает фон и пол по текущему конфигу — вызывается, когда цвета меняют в панели настроек.
export const refreshSceneColors = (scene: THREE.Scene): void => {
  scene.background = new THREE.Color(config.BACKGROUND_COLOR);
  FLOOR_MATERIAL.color.set(config.FLOOR_COLOR);
};
