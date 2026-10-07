// Место для появления врага без наложений. Если два врага появятся внутри друг друга, физический движок
// в первом же шаге выталкивает их с огромной скоростью, и они уродливо разлетаются. Поэтому перед появлением
// проверяем, свободно ли место, и если нет — ищем ближайшее свободное: сначала рядом на полу, а если на полу
// тесно — ярусом выше (враг появится в воздухе и упадёт на толпу), потом ещё выше и так до потолка смерти.
import * as THREE from 'three';
import { config } from './config';
import type { Enemies, Enemy } from './enemies';
import type { Point } from './patterns';

// Сколько колец вокруг исходной точки перебирать на каждом ярусе. Шаг между кольцами — радиус нового врага,
// так что 12 колец — это примерно 12 его радиусов во все стороны.
const SEARCH_RINGS = 12;

// Коробка, которую занимает объект: центр и половина размера по каждой оси мира (X, Y, Z).
type Box = {
  center: THREE.Vector3;
  halfSize: THREE.Vector3;
};

// Массив [0, 1, …, count - 1].
const getIndices = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

// Коробка, описанная вокруг куба врага с учётом его поворота: враг мог развернуться или опрокинуться,
// и угол его куба торчит дальше половины стороны. Половина размера коробки по оси мира — сумма модулей
// проекций трёх полуосей куба на эту ось. Проекции — это строки матрицы поворота (elements хранит матрицу
// по столбцам, поэтому строка X — элементы 0, 4, 8, строка Y — 1, 5, 9, строка Z — 2, 6, 10).
const getEnemyBox = ({ body, kind }: Enemy): Box => {
  const half = kind.size / 2;
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().copy(body.rotation()));
  const m = rotation.elements;

  return {
    center: new THREE.Vector3().copy(body.translation()),
    halfSize: new THREE.Vector3(
      half * (Math.abs(m[0]) + Math.abs(m[4]) + Math.abs(m[8])),
      half * (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])),
      half * (Math.abs(m[2]) + Math.abs(m[6]) + Math.abs(m[10])),
    ),
  };
};

// Коробка куба со стороной size без поворота — так появляется новый враг, так же стоит куб-игрок.
const getCubeBox = (center: THREE.Vector3, size: number): Box => ({
  center,
  halfSize: new THREE.Vector3(size / 2, size / 2, size / 2),
});

// Проверка «коробки не пересекаются, даже с зазором?». Две коробки не пересекаются, если хотя бы по одной
// оси между ними есть просвет: расстояние между центрами не меньше суммы половин размеров плюс зазор.
const isSeparated = (first: Box, second: Box, gap: number): boolean =>
  Math.abs(first.center.x - second.center.x) >= first.halfSize.x + second.halfSize.x + gap ||
  Math.abs(first.center.y - second.center.y) >= first.halfSize.y + second.halfSize.y + gap ||
  Math.abs(first.center.z - second.center.z) >= first.halfSize.z + second.halfSize.z + gap;

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

type FreeSpawnPositionParams = {
  // Где враг должен появиться по описанию волны.
  point: Point;

  // Сторона куба нового врага.
  size: number;
  enemies: Enemies;
};

// Возвращает позицию центра нового врага (с высотой): исходную точку на полу, если там свободно, иначе
// ближайшее свободное место. Свободно — значит, коробка нового врага не пересекается с коробками живых врагов
// и куба-игрока с зазором SPAWN_GAP. Если и до потолка места нет (огромная толпа), враг появится в исходной
// точке на полу, как и раньше.
export const findFreeSpawnPosition = ({ point, size, enemies }: FreeSpawnPositionParams): THREE.Vector3 => {
  const gap = config.SPAWN_GAP;

  // Шаг колец поиска — половина диагонали основания куба: так соседние точки на кольце почти не дублируют
  // друг друга, но и не пропускают свободных мест.
  const radius = (size * Math.SQRT2) / 2;
  const searchDistance = SEARCH_RINGS * radius;
  const player = getCubeBox(new THREE.Vector3(0, config.PLAYER_SIZE / 2, 0), config.PLAYER_SIZE);

  // Сразу отбираем только соседей, которые по горизонтали могут помешать хоть одной точке поиска:
  // при сотнях врагов иначе пришлось бы проверять каждого врага для каждой точки.
  const neighbors = [player, ...[...enemies.values()].map(getEnemyBox)].filter(
    ({ center, halfSize }) =>
      Math.abs(center.x - point.x) < searchDistance + size / 2 + halfSize.x + gap &&
      Math.abs(center.z - point.z) < searchDistance + size / 2 + halfSize.z + gap,
  );

  const isFree = (position: THREE.Vector3): boolean => {
    const box = getCubeBox(position, size);

    return neighbors.every((neighbor) => isSeparated(box, neighbor, gap));
  };

  // Точка за краем арены не годится: враг, чей центр за краем, сразу погибает. Оставляем запас в полкуба,
  // чтобы и сам куб целиком был над полом. Исходную точку не проверяем — её задало описание волны.
  const halfArena = config.ARENA_SIZE / 2 - size / 2;

  const floorCandidates = getFloorCandidates(point, radius).filter(
    (candidate, index) => index === 0 || (Math.abs(candidate.x) <= halfArena && Math.abs(candidate.z) <= halfArena),
  );

  // Ярусы по высоте: на полу (центр на половине роста) и выше — каждый следующий на рост врага плюс зазор.
  // Ярусов столько, сколько помещается под потолком смерти: выше него враг сразу погиб бы.
  const layerStep = size + gap;
  const layersCount = Math.max(1, Math.floor((config.DEATH_CEILING_HEIGHT - size) / layerStep) + 1);

  // Перебираем позиции по порядку: весь пол (исходная точка и кольца), потом весь первый ярус и т. д.
  // Возвращаем первую свободную — то есть ближайшую; выше поднимаемся, только если ниже тесно.
  // Перебор с ранним выходом, а не готовый список: ярусов и точек может быть тысячи на каждого врага.
  for (const layer of getIndices(layersCount)) {
    const y = size / 2 + layer * layerStep;

    for (const { x, z } of floorCandidates) {
      const position = new THREE.Vector3(x, y, z);

      if (isFree(position)) {
        return position;
      }
    }
  }

  return new THREE.Vector3(point.x, size / 2, point.z);
};
