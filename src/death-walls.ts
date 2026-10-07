// Граница смерти: прозрачные стенки по краям арены. Они только для вида — физики у них нет,
// враги пролетают сквозь них. Враг, чей центр пересёк край арены, сразу погибает
// (см. turnOutOfArenaIntoCorpses в corpses.ts), а стенки показывают, где проходит эта граница.
import * as THREE from 'three';
import { config } from './config';

// Градиент прозрачности: у пола стенка видна сильнее всего, а кверху тает до нуля — как силовое поле.
// Так стенки, стоящие между камерой и ареной, почти не мешают смотреть на игру.
// alphaMap — текстура, яркость которой задаёт непрозрачность: белое — видно, чёрное — прозрачно.
// Рисуем её на маленьком canvas: полоска 1×64 пикселя с вертикальным градиентом сверху вниз.
const createFadeTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 64;

  const context = canvas.getContext('2d');

  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);

    // Верх стенки — прозрачный, низ — видимый.
    gradient.addColorStop(0, 'black');
    gradient.addColorStop(1, 'white');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  return new THREE.CanvasTexture(canvas);
};

// Материал общий на все стенки — цвет и прозрачность меняются на ходу (refreshDeathWalls).
// MeshBasicMaterial не зависит от света: стенка светится ровным цветом.
// DoubleSide — видна с обеих сторон (дальние стенки мы видим изнутри арены, ближние — снаружи).
// depthWrite: false — прозрачная стенка не загораживает то, что за ней.
const WALL_MATERIAL = new THREE.MeshBasicMaterial({
  color: config.DEATH_WALL_COLOR,
  transparent: true,
  opacity: config.DEATH_WALL_OPACITY,
  alphaMap: createFadeTexture(),
  side: THREE.DoubleSide,
  depthWrite: false,
});

// Плоскость 1×1, сдвинутая вверх на половину высоты: нижний край на полу (y = 0), и при растягивании
// по высоте (scale.y) стенка растёт вверх от пола. Длина и высота стенки задаются масштабом меша.
const WALL_GEOMETRY = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

// Где стоят четыре стенки: на краях по Z (вдоль оси X) и на краях по X (повёрнуты на 90° — вдоль оси Z).
// x и z — сторона арены: -1 или 1 (0 — посередине).
const WALL_PLACEMENTS = [
  { x: 0, z: -1, rotationY: 0 },
  { x: 0, z: 1, rotationY: 0 },
  { x: -1, z: 0, rotationY: Math.PI / 2 },
  { x: 1, z: 0, rotationY: Math.PI / 2 },
];

// Создаёт четыре стенки по краям пола. Длина — размер арены (он меняется только после перезагрузки),
// высота — DEATH_WALL_HEIGHT (меняется на ходу через refreshDeathWalls).
export const createDeathWalls = (): THREE.Group => {
  const halfArena = config.ARENA_SIZE / 2;
  const walls = new THREE.Group();

  for (const { x, z, rotationY } of WALL_PLACEMENTS) {
    const wall = new THREE.Mesh(WALL_GEOMETRY, WALL_MATERIAL);
    wall.position.set(x * halfArena, 0, z * halfArena);
    wall.rotation.y = rotationY;
    wall.scale.set(config.ARENA_SIZE, config.DEATH_WALL_HEIGHT, 1);
    walls.add(wall);
  }

  return walls;
};

// Обновляет высоту, цвет и прозрачность стенок по текущему конфигу — вызывается из панели настроек.
export const refreshDeathWalls = (walls: THREE.Group): void => {
  WALL_MATERIAL.color.set(config.DEATH_WALL_COLOR);
  WALL_MATERIAL.opacity = config.DEATH_WALL_OPACITY;

  for (const wall of walls.children) {
    wall.scale.y = config.DEATH_WALL_HEIGHT;
  }
};
