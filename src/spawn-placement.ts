// Место для появления врага без наложений. Если два врага появятся внутри друг друга, физический движок
// в первом же шаге выталкивает их с огромной скоростью, и они уродливо разлетаются. Поэтому перед появлением
// проверяем, свободно ли место, и если нет — ищем ближайшее свободное: сначала рядом на полу, а если на полу
// тесно — ярусом выше (враг появится в воздухе и упадёт на толпу), потом ещё выше и так до потолка смерти.
//
// Второй глобальный запрет — безопасная зона вокруг куба игрока (SAFE_RADIUS в config.ts): внутрь круга
// такого радиуса не появляется НИКТО — ни при каком счётчике, тесноте и ярусе. Зона живёт здесь, а не в
// формах: описание волны могло поставить точку внутрь (форма с малым distance, jitter), но подборщик
// прижимает её к краю зоны и никогда не ищет внутри неё свободных мест.
//
// Скорость важна: в огромной волне за один кадр появляются сотни врагов, и каждый перебирает сотни мест.
// Поэтому соседей ищем не перебором всех врагов, а через сетку (см. «Сетка соседей» ниже), а в самом
// горячем месте — проверке одного места — почти не создаём временных объектов.
import * as THREE from 'three';
import { config } from './config';
import type { Enemies, Enemy } from './enemies';
import type { Point } from './patterns';

// Сколько колец вокруг исходной точки перебирать на каждом ярусе. Шаг между кольцами — радиус нового врага,
// так что 12 колец — это примерно 12 его радиусов во все стороны.
const SEARCH_RINGS = 12;

// Коробка, которую занимает объект: центр и половина размера по каждой оси мира. Обычные числа,
// а не векторы Three.js: таких коробок проверяются миллионы, и лишние объекты замедлили бы работу.
type Box = {
  x: number;
  y: number;
  z: number;
  halfX: number;
  halfY: number;
  halfZ: number;
};

// Готовые массивы [0, 1, …, count - 1] — создаются один раз на каждую длину и дальше берутся отсюда:
// в проверке места они нужны миллионы раз. Изменять их нельзя — только перебирать.
const INDICES_CACHE = new Map<number, number[]>();

// Массив [0, 1, …, count - 1].
const getIndices = (count: number): number[] => {
  const cached = INDICES_CACHE.get(count);

  if (cached) {
    return cached;
  }

  const indices = Array.from({ length: count }, (_, index) => index);
  INDICES_CACHE.set(count, indices);

  return indices;
};

// Матрица и кватернион для расчёта коробок — одни на все вызовы, чтобы не создавать новые для каждого врага.
const ROTATION = new THREE.Matrix4();
const QUATERNION = new THREE.Quaternion();

// Коробка, описанная вокруг куба врага с учётом его поворота: враг мог развернуться или опрокинуться,
// и угол его куба торчит дальше половины стороны. Половина размера коробки по оси мира — сумма модулей
// проекций трёх полуосей куба на эту ось. Проекции — это строки матрицы поворота (elements хранит матрицу
// по столбцам, поэтому строка X — элементы 0, 4, 8, строка Y — 1, 5, 9, строка Z — 2, 6, 10).
const getEnemyBox = ({ body, kind }: Enemy): Box => {
  const half = kind.size / 2;
  const m = ROTATION.makeRotationFromQuaternion(QUATERNION.copy(body.rotation())).elements;
  const { x, y, z } = body.translation();

  return {
    x,
    y,
    z,
    halfX: half * (Math.abs(m[0]) + Math.abs(m[4]) + Math.abs(m[8])),
    halfY: half * (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])),
    halfZ: half * (Math.abs(m[2]) + Math.abs(m[6]) + Math.abs(m[10])),
  };
};

// Коробка куба со стороной size без поворота — так появляется новый враг, так же стоит куб-игрок.
const getCubeBox = ({ x, y, z, size }: Point & { y: number; size: number }): Box => ({
  x,
  y,
  z,
  halfX: size / 2,
  halfY: size / 2,
  halfZ: size / 2,
});

// ─── СЕТКА СОСЕДЕЙ ───────────────────────────────────────────────────────────
// Пол делим на квадратные клетки и раскладываем по ним коробки всех врагов (и куба-игрока). Чтобы проверить
// место, смотрим только клетки, на которые оно попадает, — там единицы соседей, а не сотни всех врагов арены.
// Высоту клетки не учитывают: все ярусы над клеткой лежат в ней же.

// Сторона клетки, м. Чуть больше самого крупного врага: тогда коробка обычно попадает в 1–4 клетки.
const GRID_CELL_SIZE = 2;

// Номер клетки — пара целых чисел (по X и по Z). Для ключа Map склеиваем их в одно число:
// сдвигаем, чтобы отрицательные номера стали положительными, и умножаем первый на большой шаг.
const GRID_INDEX_OFFSET = 10_000;
const GRID_KEY_STRIDE = 100_000;

// Сетка: ключ клетки → коробки, которые её задевают.
type Grid = Map<number, Box[]>;

const getCellIndex = (coordinate: number): number => Math.floor(coordinate / GRID_CELL_SIZE);

const getCellKey = (cellX: number, cellZ: number): number =>
  (cellX + GRID_INDEX_OFFSET) * GRID_KEY_STRIDE + (cellZ + GRID_INDEX_OFFSET);

// Сколько клеток задевает отрезок [from, to] по одной оси, считая от клетки, где лежит from.
const getCellCount = (from: number, to: number): number => getCellIndex(to) - getCellIndex(from) + 1;

// Кладёт коробку во все клетки, которые она задевает по горизонтали.
const addToGrid = (grid: Grid, box: Box): void => {
  const firstX = getCellIndex(box.x - box.halfX);
  const firstZ = getCellIndex(box.z - box.halfZ);

  for (const offsetX of getIndices(getCellCount(box.x - box.halfX, box.x + box.halfX))) {
    for (const offsetZ of getIndices(getCellCount(box.z - box.halfZ, box.z + box.halfZ))) {
      const key = getCellKey(firstX + offsetX, firstZ + offsetZ);
      const cell = grid.get(key);

      if (cell) {
        cell.push(box);
      } else {
        grid.set(key, [box]);
      }
    }
  }
};

// Проверка «коробка не пересекается ни с одной из сетки, даже с зазором?». Пересечься с ней может только
// коробка, задевающая ту же область, расширенную на зазор, — а такая лежит в одной из этих клеток.
// Две коробки не пересекаются, если хотя бы по одной оси между ними есть просвет: расстояние между
// центрами не меньше суммы половин размеров плюс зазор.
const isFreeInGrid = ({ grid, box, gap }: { grid: Grid; box: Box; gap: number }): boolean => {
  const fromX = box.x - box.halfX - gap;
  const fromZ = box.z - box.halfZ - gap;
  const firstX = getCellIndex(fromX);
  const firstZ = getCellIndex(fromZ);

  for (const offsetX of getIndices(getCellCount(fromX, box.x + box.halfX + gap))) {
    for (const offsetZ of getIndices(getCellCount(fromZ, box.z + box.halfZ + gap))) {
      const cell = grid.get(getCellKey(firstX + offsetX, firstZ + offsetZ));

      // В пустой клетке проверять нечего.
      if (!cell) {
        continue;
      }

      for (const other of cell) {
        const isSeparated =
          Math.abs(box.x - other.x) >= box.halfX + other.halfX + gap ||
          Math.abs(box.y - other.y) >= box.halfY + other.halfY + gap ||
          Math.abs(box.z - other.z) >= box.halfZ + other.halfZ + gap;

        if (!isSeparated) {
          return false;
        }
      }
    }
  }

  return true;
};

// ─── ПОИСК МЕСТА ─────────────────────────────────────────────────────────────

// Точки поиска на полу: сама исходная точка, потом кольца вокруг неё — от ближнего к дальнему.
// На кольце точки идут с шагом примерно в радиус врага (длина окружности / радиус). Каждое кольцо
// начинаем с направления «от центра арены»: если свободно и там, и там, враг сдвинется скорее наружу,
// чем ближе к игроку.
const getFloorCandidates = (point: Point, radius: number): Point[] => {
  const outwardAngle = Math.atan2(point.z, point.x);

  const rings = getIndices(SEARCH_RINGS).flatMap((ring) => {
    const ringRadius = (ring + 1) * radius;
    const pointsCount = Math.ceil((2 * Math.PI * ringRadius) / radius);

    return getIndices(pointsCount).map((index): Point => {
      const angle = outwardAngle + (index / pointsCount) * Math.PI * 2;

      return { x: point.x + Math.cos(angle) * ringRadius, z: point.z + Math.sin(angle) * ringRadius };
    });
  });

  return [point, ...rings];
};

// Точка на границе безопасной зоны: сдвигает точку наружу по направлению от центра арены до радиуса
// radius. Точка ровно в центре — направление неизвестно, берём «верх» экрана (любое фиксированное).
const projectToZoneRim = (point: Point, radius: number): Point => {
  const distance = Math.hypot(point.x, point.z);

  if (distance === 0) {
    return { x: -Math.SQRT1_2 * radius, z: -Math.SQRT1_2 * radius };
  }

  return { x: (point.x / distance) * radius, z: (point.z / distance) * radius };
};

type SpawnRequest = {
  // Где враг должен появиться по описанию волны.
  point: Point;

  // Сторона куба нового врага.
  size: number;
};

// Подбирает место одному врагу: возвращает позицию его центра (с высотой).
export type SpawnPlacer = (request: SpawnRequest) => THREE.Vector3;

// Создаёт подборщик мест на один кадр: раскладывает живых врагов и куб-игрока по сетке. Пока враги
// появляются в этом кадре, никто не двигается, поэтому сетку достаточно построить один раз, а каждого
// появившегося врага подборщик сам добавляет в неё — следующие уже не встанут на его место.
// В следующем кадре все сдвинутся — нужен новый подборщик.
export const createSpawnPlacer = (enemies: Enemies): SpawnPlacer => {
  const grid: Grid = new Map();
  const playerSize = config.PLAYER_SIZE;

  addToGrid(grid, getCubeBox({ x: 0, y: playerSize / 2, z: 0, size: playerSize }));

  for (const enemy of enemies.values()) {
    addToGrid(grid, getEnemyBox(enemy));
  }

  // Возвращает исходную точку на полу, если там свободно, иначе ближайшее свободное место. Свободно — значит,
  // коробка нового врага не пересекается с коробками врагов и куба-игрока с зазором SPAWN_GAP. Если и до потолка
  // места нет (огромная толпа), враг появится в исходной точке (после прижатия к границе безопасной зоны).
  return ({ point, size }: SpawnRequest): THREE.Vector3 => {
    const gap = config.SPAWN_GAP;

    // Шаг колец поиска — половина диагонали основания куба: так соседние точки на кольце почти не дублируют
    // друг друга, но и не пропускают свободных мест.
    const radius = (size * Math.SQRT2) / 2;

    // Точка за краем арены не годится: враг, чей центр за краем, сразу погибает. Оставляем запас в полкуба,
    // чтобы и сам куб целиком был над полом. Исходную точку на границы арены не проверяем — её задало
    // описание волны.
    const halfArena = config.ARENA_SIZE / 2 - size / 2;

    // Безопасная зона: радиус, внутрь которого не появляется никто ни при каких условиях. 0 — зоны нет.
    // Если зона съела почти всю арену, ужимаем её до радиуса, при котором у стены ещё остаётся кольцо
    // свободного пола (арена/2 − размер), иначе места для спавна не осталось бы вовсе.
    const safeRadius = Math.min(Math.max(0, config.SAFE_RADIUS), Math.max(0, config.ARENA_SIZE / 2 - size));

    // Вся коробка врага за границей зоны — только такие места годятся.
    const isOutsideSafeZone = ({ x, z }: Point): boolean =>
      safeRadius === 0 || Math.hypot(x, z) >= safeRadius + size / 2;

    // Исходная точка внутри зоны — прижимаем наружу, к её границе: форма с малым distance или jitter
    // могли поставить её внутрь, но внутри зоны не появляется никто ни при каком условии.
    const spawnPoint = isOutsideSafeZone(point) ? point : projectToZoneRim(point, safeRadius + size / 2);

    // Кандидаты: внутри безопасной зоны не годится ни один, даже исходная точка описания волны.
    const floorCandidates = getFloorCandidates(spawnPoint, radius).filter(
      (candidate, index) =>
        (index === 0 || (Math.abs(candidate.x) <= halfArena && Math.abs(candidate.z) <= halfArena)) &&
        isOutsideSafeZone(candidate),
    );

    // Ярусы по высоте: на полу (центр на половине роста) и выше — каждый следующий на рост врага плюс зазор.
    // Ярусов столько, сколько помещается под потолком смерти: выше него враг сразу погиб бы.
    const layerStep = size + gap;
    const layersCount = Math.max(1, Math.floor((config.DEATH_CEILING_HEIGHT - size) / layerStep) + 1);

    // Занимаем найденное место в сетке — следующие враги этого кадра его обойдут.
    const occupy = (position: Point & { y: number }): THREE.Vector3 => {
      addToGrid(grid, getCubeBox({ ...position, size }));

      return new THREE.Vector3(position.x, position.y, position.z);
    };

    // Перебираем позиции по порядку: весь пол (исходная точка и кольца), потом весь первый ярус и т. д.
    // Возвращаем первую свободную — то есть ближайшую; выше поднимаемся, только если ниже тесно.
    for (const layer of getIndices(layersCount)) {
      const y = size / 2 + layer * layerStep;

      for (const { x, z } of floorCandidates) {
        if (isFreeInGrid({ grid, box: getCubeBox({ x, y, z, size }), gap })) {
          return occupy({ x, y, z });
        }
      }
    }

    return occupy({ x: spawnPoint.x, y: size / 2, z: spawnPoint.z });
  };
};
