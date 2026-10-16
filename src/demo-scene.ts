// Демо-сцена («витрина»): все модельки игры статично стоят на полу — куб игрока, пять типов врагов,
// призрак, обычный и крит-снаряд, полоска здоровья и две кучки искр. Нужна, чтобы в панели настроек
// крутить цвета и размеры и сразу видеть результат по всем объектам сразу, без ожидания подходящих
// врагов. Переключается селектом «Сцена» (SCENE_MODE в config.ts); в демо-режиме игра заморожена
// и рисуется только эта сцена (см. main.ts).
//
// Модельки собираются из тех же материалов и геометрий, что и в игре (createPlayerCube,
// createEnemyCube, applyCorpseLook, createProjectileMesh) — цвета игрока, врагов, призраков,
// снарядов и полосок обновляются автоматически вместе с игровыми материалами (refresh* из
// applyLiveConfig в main.ts). Свой refresh нужен только фону, свету и кучкам искр: у них
// материалы или объекты принадлежат этой сцене.
//
// Вся сцена статична: физика не участвует, объекты просто стоят на полу (центр куба на size / 2).
// Размеры читаются при создании (как у параметров «· новые»), цвета искр — живые.
import * as THREE from 'three';
import { config, ENEMY_KIND_NAMES } from './config';
import { applyCorpseLook } from './corpses';
import { createEnemyCube } from './enemies';
import { createHpBar, setHpBarValue, turnToCamera } from './hp-bar';
import { createLights, refreshLights } from './lighting';
import { createPlayerCube } from './player';
import { createProjectileMesh } from './projectiles';
import { createFloor, recompileMaterials, NEED_HALF_WIDTH } from './scene';
import { getSparkColor } from './sparks';

// Варианты для селекта «Сцена» в панели настроек (по образцу TONE_MAPPING_OPTIONS):
// подпись в списке → значение в config.SCENE_MODE.
export const SCENE_MODE_OPTIONS: Record<string, string> = {
  'Игра': 'game',
  'Демо (модельки)': 'demo',
};

// Направление линейки модельек: горизонталь экрана в изометрии. Камера смотрит на арену с угла
// (см. createScene), и только вдоль этого направления предметы не перекрывают друг друга на экране.
const ROW_DIRECTION = new THREE.Vector3(1, 0, -1).normalize();

// Линейка занимает не больше этой доли видимой половины ширины кадра (от цетра до края),
// но и не шире DEMO_MAX_STEP между соседями — так она влезает в кадр при любом размере арены,
// и на огромной арене модельки не слипаются в точку.
const ROW_FRACTION = 0.8;
const MAX_STEP = 3;

// Шаг между центрами предметов линейки: вся линейка из count предметов вписывается в кадр.
// NEED_HALF_WIDTH — минимальная половина ширины кадра при данном ARENA_SIZE (см. scene.ts);
// на широком экране кадр шире, поэтому линейка гарантированно влезает.
const getRowStep = (count: number): number =>
  Math.min(MAX_STEP, (NEED_HALF_WIDTH * ROW_FRACTION * 2) / Math.max(count - 1, 1));

// Здоровье «для вида» над врагом normal: доля от полоски при полном здоровье. Меньше единицы,
// иначе полоска скрылась бы (setHpBarValue прячет полоску при полном здоровье).
const DEMO_HP_FRACTION = 0.6;

// Смещения кубиков внутри кучки искр (доли размера искры) — фиксированные, без рандома:
// витрина должна выглядеть одинаково при каждом открытии.
const CLUSTER_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [0.9, 0.4],
  [-0.7, 0.8],
  [0.5, -0.9],
  [-0.8, -0.6],
  [1.1, -0.2],
];

// Геометрия кубика искры — единичный куб, нужный размер задаётся масштабом (как у врагов).
const SPARK_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);

// Кучка искр на витрине: кубики вокруг одной точки, статично. Материал свой (не игровой
// SPARK_MATERIAL): цвет кучки — базовый цвет искр, увеличенный на свечение, и он обновляется
// в refresh, как только панель поменяет SPARKS_COLOR или SPARKS_GLOW.
type SparkCluster = {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  isCrit: boolean;
};

// Размер искры кучки — как у настоящей искры: SPARKS_SIZE, у крита увеличенный в multiplier раз.
const getClusterSize = (isCrit: boolean): number =>
  config.SPARKS_SIZE * (isCrit ? config.SPARKS_CRIT_SIZE_MULTIPLIER : 1);

const createSparkCluster = ({ isCrit }: { isCrit: boolean }): SparkCluster => {
  const material = new THREE.MeshBasicMaterial({ color: getSparkColor(isCrit) });
  const group = new THREE.Group();

  group.name = isCrit ? 'demo-sparks-crit' : 'demo-sparks';
  group.add(...CLUSTER_OFFSETS.map((): THREE.Mesh => new THREE.Mesh(SPARK_GEOMETRY, material)));

  return { group, material, isCrit };
};

// Ставит кубики кучки по своим местам и красит их — зовётся при создании и из refresh.
// Полная итоговая искра в игре — это цвет (getSparkColor) на материале свечения (SPARKS_GLOW);
// здесь то же самое считается одним цветом материала.
const refreshSparkCluster = ({ group, material, isCrit }: SparkCluster): void => {
  const size = getClusterSize(isCrit);

  material.color.copy(getSparkColor(isCrit)).multiplyScalar(config.SPARKS_GLOW);

  group.children.forEach((cube, index): void => {
    const offset = CLUSTER_OFFSETS[index];

    cube.scale.setScalar(size);
    cube.position.set(offset[0] * size, size / 2, offset[1] * size);
  });
};

export type DemoScene = {
  // Сцена с витриной — её рисует main.ts, когда SCENE_MODE = 'demo'.
  scene: THREE.Scene;

  // Перечитывает из конфига то, что принадлежит этой сцене: фон, свет, цвет и размер кучек искр.
  // Зовётся из applyLiveConfig (main.ts) при каждой правке панели настроек.
  refresh: () => void;
};

// Создаёт демо-сцену. camera нужен, чтобы один раз повернуть полоску здоровья к камере
// (камера в игре не двигается, поворота при смене кадра не требуется).
export const createDemoScene = ({ camera }: { camera: THREE.Camera }): DemoScene => {
  const scene = new THREE.Scene();

  scene.background = new THREE.Color(config.BACKGROUND_COLOR);
  scene.add(createFloor());

  // Свой свет — тот же, что в игре (createLights), поэтому смена света и теней в панели
  // действует на витрину через refresh, а не дублируется здесь.
  const lights = createLights();

  scene.add(lights.hemisphere, lights.sun);

  // Линейка предметов: каждый — объект и его центр по высоте (кубы стоят на полу, центр на size / 2;
  // кучки искр — группа, её кубики сами ставятся на пол внутри refreshSparkCluster).
  const rowItems: Array<{ object: THREE.Object3D; height: number }> = [];

  const player = createPlayerCube();

  player.name = 'demo-player';
  rowItems.push({ object: player, height: config.PLAYER_SIZE / 2 });

  // Кубы всех типов врагов. normal запоминаем отдельно — над ним висит полоска здоровья.
  let hpEnemyCube: THREE.Mesh | undefined;

  for (const name of ENEMY_KIND_NAMES) {
    const cube = createEnemyCube(name);

    cube.name = `demo-enemy-${name}`;
    rowItems.push({ object: cube, height: config.ENEMY_KINDS[name].size / 2 });

    if (name === 'normal') {
      hpEnemyCube = cube;
    }
  }

  // Призрак — куб типа normal с полупрозрачным материалом (как настоящий погибший враг).
  const corpse = createEnemyCube('normal');

  corpse.name = 'demo-corpse';
  applyCorpseLook(corpse);
  rowItems.push({ object: corpse, height: config.ENEMY_KINDS.normal.size / 2 });

  // Обычный и крит-снаряд: крит крупнее и крит-цветной — как в игре (см. createProjectileMesh).
  const projectile = createProjectileMesh(false);

  projectile.name = 'demo-projectile';
  rowItems.push({ object: projectile, height: config.PROJECTILE_SIZE / 2 });

  const critProjectile = createProjectileMesh(true);

  critProjectile.name = 'demo-projectile-crit';
  rowItems.push({
    object: critProjectile,
    height: (config.PROJECTILE_SIZE * config.CRIT_PROJECTILE_SIZE_MULTIPLIER) / 2,
  });

  // Две кучки искр — обычные и крит.
  const sparksCluster = createSparkCluster({ isCrit: false });
  const critSparksCluster = createSparkCluster({ isCrit: true });

  rowItems.push({ object: sparksCluster.group, height: 0 });
  rowItems.push({ object: critSparksCluster.group, height: 0 });

  // Раскладка линейкой вдоль экранной горизонтали, по центру арены.
  const step = getRowStep(rowItems.length);

  rowItems.forEach(({ object, height }, index): void => {
    const offset = (index - (rowItems.length - 1) / 2) * step;

    object.position.set(ROW_DIRECTION.x * offset, height, ROW_DIRECTION.z * offset);
    scene.add(object);
  });

  // Полоска здоровья над врагом normal — с частичным здоровьем, чтобы была видна.
  // Высота над центром врага — полстороны куба плюс зазор, как у настоящих врагов (spawnEnemy).
  if (hpEnemyCube) {
    const hpBar = createHpBar();

    hpBar.group.name = 'demo-hp-bar';
    setHpBarValue(hpBar, DEMO_HP_FRACTION);
    turnToCamera(hpBar, camera);
    hpBar.group.position.set(
      hpEnemyCube.position.x,
      hpEnemyCube.position.y + config.ENEMY_KINDS.normal.size / 2 + config.HP_BAR_GAP,
      hpEnemyCube.position.z,
    );

    scene.add(hpBar.group);
  }

  // Прошлые значения настроек, зашитых в шейдеры: при их смене шейдеры материалов сцены нужно
  // пересобрать — так же, как это делает refreshSceneLook для игровой сцены (см. scene.ts).
  let appliedToneMapping = config.TONE_MAPPING;
  let appliedShadows = config.SHADOWS_ENABLED;

  const refresh = (): void => {
    scene.background = new THREE.Color(config.BACKGROUND_COLOR);
    refreshLights(lights);
    refreshSparkCluster(sparksCluster);
    refreshSparkCluster(critSparksCluster);

    const isShadersChanged =
      appliedToneMapping !== config.TONE_MAPPING || appliedShadows !== config.SHADOWS_ENABLED;

    if (isShadersChanged) {
      appliedToneMapping = config.TONE_MAPPING;
      appliedShadows = config.SHADOWS_ENABLED;
      recompileMaterials(scene);
    }
  };

  // Первое применение конфига: сцена собирается по умолчаниям кода, а сохранённые в браузере
  // правки панели (цвета искр, свет) должны вступить в силу сразу при загрузке.
  refresh();

  return { scene, refresh };
};
