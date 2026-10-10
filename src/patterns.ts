// Паттерны — формы, по которым расставляются враги группы. Каждая форма — функция,
// которая по параметрам возвращает список точек на полу. КОГДА враги появятся в этих точках,
// решает не форма, а тайминг группы (см. src/waves.ts и src/schedule.ts).
import { config } from './config';

// Точка на полу. Высоту (y) задаёт сам враг при появлении.
export type Point = {
  x: number;
  z: number;
};

// Углы во всех формах — в градусах относительно ЭКРАНА, как на циферблате:
// 0° — вверх, 90° — вправо, 180° — вниз, 270° — влево. Угол не указан — выбирается случайно.

// Общее поле ВСЕХ форм: случайный сдвиг каждой точки после построения — края формы дрожат и
// не выглядят идеально. Сдвиг — равномерный в круге радиуса jitter (0 или не указано — без сдвига).
// Применяется в getShapePoints для любой формы.
type BaseShape = {
  jitter?: number;
};

// Кольцо (arc = 360, по умолчанию) или дуга (arc < 360) на окружности спавна.
// Кольцо: первый враг на angle, остальные по часовой. Дуга: angle — её середина, крайние точки включены.
// Отрицательный arc — тот же обход, но против часовой.
// distance — на каком удалении от центра арены лежит окружность (по умолчанию SPAWN_RADIUS): меньше —
// ближе к игроку (внутренний обстрел), больше — дальше (осада). Есть у всех форм.
type CircleShape = BaseShape & {
  type: 'circle';
  count: number;
  angle?: number;
  arc?: number;
  distance?: number;
};

// «То тут то там»: случайные точки на окружности спавна.
// angle и arc ограничивают сектор (например, angle: 0, arc: 90 — только сверху). По умолчанию весь круг.
type RandomShape = BaseShape & {
  type: 'random';
  count: number;
  angle?: number;
  arc?: number;
  distance?: number;
};

// Шеренга: враги в ряд поперёк направления на куб, центр ряда на окружности спавна под углом angle.
// width — длина ряда. Порядок — по часовой (слева направо, если смотреть от куба наружу).
type LineShape = BaseShape & {
  type: 'line';
  count: number;
  angle?: number;
  width?: number;
  distance?: number;
};

// Кучка: враги случайно разбросаны в круге радиуса radius вокруг точки окружности спавна под углом angle.
type ClusterShape = BaseShape & {
  type: 'cluster';
  count: number;
  angle?: number;
  radius?: number;
  distance?: number;
};

// Многоугольник: count точек вдоль ПЕРИМЕТРА правильного sides-угольника, вписанного в окружность
// радиуса distance и повёрнутого на angle. В отличие от circle (точки по дуге) — прямые рёбра.
// sides — ЧИСЛО УГЛОВ (3 — треугольник, 6 — шестиугольник): форма универсальна, углов сколько угодно.
type PolygonShape = BaseShape & {
  type: 'polygon';
  count: number;
  sides?: number;
  angle?: number;
  distance?: number;
};

// Точка опоры пути: экранной угол плюс необязательный радиус (по умолчанию distance формы).
type PathAnchor = {
  angle: number;
  radius?: number;
};

// Путь: count точек вдоль ломаной через anchors — ПОРЯДКОВО, от первой опоры к последней.
// Порядок точек = порядок появления при interval, поэтому путь «марширует»: враги ползут по кривой
// (змейка, поезд). Опоры с разными радиусами описывают заход внутрь/наружу и спираль.
type PathShape = BaseShape & {
  type: 'path';
  count: number;
  anchors: PathAnchor[];
  distance?: number;
};

// Волна: как line — ряд поперёк направления на куб от точки окружности спавна под углом angle, но
// каждая точка сдвинута по радиусу по синусоиде: получается волна. width — длина ряда, amplitude —
// амплитуда колебания (по радиусу внутрь/наружу), periods — полных колебаний на длине width.
// Порядок точек — вдоль волны от одного края к другому (при interval волна «расползается»).
type WaveShape = BaseShape & {
  type: 'wave';
  count: number;
  angle?: number;
  width?: number;
  amplitude?: number;
  periods?: number;
  distance?: number;
};

// Периметр: count точек вдоль КВАДРАТА арены (мировые оси, на экране — ромб, т.к. оси X/Z идут по
// диагоналям). Замкнутый обход по часовой от «верхней» вершины. inset — отступ внутрь от стенки:
// центр врага обязан остаться над ареной, иначе он погибнет сразу (см. isEnemyOverArena).
type PerimeterShape = BaseShape & {
  type: 'perimeter';
  count: number;
  inset?: number;
};

export type Shape =
  | CircleShape
  | RandomShape
  | LineShape
  | ClusterShape
  | PolygonShape
  | PathShape
  | WaveShape
  | PerimeterShape;

// ─── ПЕРЕВОД ЭКРАННОГО УГЛА В НАПРАВЛЕНИЕ НА ПОЛУ ───────────────────────────

// Камера стоит в точке (d, d, d) и смотрит в центр (см. src/scene.ts), поэтому оси X и Z мира
// на экране идут по диагоналям. «Вверх по экрану» на полу — это направление (-1, -1) по (x, z),
// «вправо по экрану» — (1, -1). Делим на √2, чтобы длина направления была 1.
const SCREEN_UP: Point = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
const SCREEN_RIGHT: Point = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };

// Направление длиной 1 для экранного угла: смесь «вверх» и «вправо» в пропорции cos/sin,
// как стрелка циферблата. 0° — вверх, 90° — вправо.
const getScreenDirection = (degrees: number): Point => {
  const radians = (degrees * Math.PI) / 180;

  return {
    x: SCREEN_UP.x * Math.cos(radians) + SCREEN_RIGHT.x * Math.sin(radians),
    z: SCREEN_UP.z * Math.cos(radians) + SCREEN_RIGHT.z * Math.sin(radians),
  };
};

// Точка на окружности спавна под экранным углом. distance — радиус этой окружности (по умолчанию
// SPAWN_RADIUS): уменьшает/увеличивает удалённость формы от центра арены.
const getSpawnCirclePoint = (degrees: number, distance: number = config.SPAWN_RADIUS): Point => {
  const direction = getScreenDirection(degrees);

  return { x: direction.x * distance, z: direction.z * distance };
};

const getRandomAngle = (): number => Math.random() * 360;

// Массив [0, 1, …, count - 1] — индексы врагов группы.
const getIndices = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

// ─── ФОРМЫ ───────────────────────────────────────────────────────────────────

const getCirclePoints = ({
  count,
  angle = getRandomAngle(),
  arc = 360,
  distance = config.SPAWN_RADIUS,
}: CircleShape): Point[] => {
  const isFullCircle = Math.abs(arc) >= 360;

  // Кольцо: count равных шагов по кругу — последний враг не совпадает с первым.
  // Дуга: count - 1 шаг от одного края до другого, оба края заняты.
  const getAngle = (index: number): number => {
    if (isFullCircle) {
      return angle + (index * arc) / count;
    }

    return count === 1 ? angle : angle - arc / 2 + (index * arc) / (count - 1);
  };

  return getIndices(count).map((index) => getSpawnCirclePoint(getAngle(index), distance));
};

const getRandomPoints = ({
  count,
  angle = getRandomAngle(),
  arc = 360,
  distance = config.SPAWN_RADIUS,
}: RandomShape): Point[] =>
  getIndices(count).map(() => getSpawnCirclePoint(angle - arc / 2 + Math.random() * arc, distance));

const getLinePoints = ({
  count,
  angle = getRandomAngle(),
  width = config.DEFAULT_LINE_WIDTH,
  distance = config.SPAWN_RADIUS,
}: LineShape): Point[] => {
  const center = getSpawnCirclePoint(angle, distance);

  // Ряд идёт поперёк направления на куб, то есть вдоль направления «угол + 90°» — по часовой.
  const along = getScreenDirection(angle + 90);

  // Смещение врага от центра ряда: от -width/2 до +width/2 равными шагами.
  const getOffset = (index: number): number => (count === 1 ? 0 : -width / 2 + (index * width) / (count - 1));

  return getIndices(count).map((index) => ({
    x: center.x + along.x * getOffset(index),
    z: center.z + along.z * getOffset(index),
  }));
};

const getClusterPoints = ({
  count,
  angle = getRandomAngle(),
  radius = config.DEFAULT_CLUSTER_RADIUS,
  distance = config.SPAWN_RADIUS,
}: ClusterShape): Point[] => {
  const center = getSpawnCirclePoint(angle, distance);

  // Случайная точка в круге: случайное направление и случайное расстояние.
  // Корень из случайного числа нужен, чтобы точки ложились равномерно, а не скучивались у центра.
  // Если враги появятся вплотную, физика сама их растолкает.
  return getIndices(count).map(() => {
    const direction = Math.random() * Math.PI * 2;
    const dist = radius * Math.sqrt(Math.random());

    return {
      x: center.x + Math.cos(direction) * dist,
      z: center.z + Math.sin(direction) * dist,
    };
  });
};

const getPolygonPoints = ({
  count,
  sides = config.DEFAULT_POLYGON_SIDES,
  angle = getRandomAngle(),
  distance = config.SPAWN_RADIUS,
}: PolygonShape): Point[] => {
  // Число сторон — целое и не меньше треугольника.
  const n = Math.max(3, Math.round(sides));

  // Вершины правильного n-угольника на окружности радиуса distance, повёрнутого на angle.
  const vertices = getIndices(n).map((index) => getSpawnCirclePoint(angle + (index * 360) / n, distance));

  // count точек вдоль периметра равными шагами (все рёбра равны, поэтому шаг по t = index/count*n).
  return getIndices(count).map((index) => {
    const t = (index / count) * n; // пройденное число рёбер: 0 … n
    const edge = Math.floor(t) % n;
    const frac = t - Math.floor(t);
    const from = vertices[edge];
    const to = vertices[(edge + 1) % n];

    return { x: from.x + (to.x - from.x) * frac, z: from.z + (to.z - from.z) * frac };
  });
};

const getPathPoints = ({ count, anchors, distance = config.SPAWN_RADIUS }: PathShape): Point[] => {
  // Опоры пути в координатах пола: у каждой опоры свой радиус, по умолчанию — distance формы.
  const nodes = anchors.map((anchor) => getSpawnCirclePoint(anchor.angle, anchor.radius ?? distance));

  if (nodes.length === 0) {
    return [];
  }

  if (nodes.length === 1) {
    return getIndices(count).map(() => ({ ...nodes[0] }));
  }

  // Длины прямых между опорами и общий путь.
  const segments = nodes.slice(1).map((node, index) => Math.hypot(node.x - nodes[index].x, node.z - nodes[index].z));
  const total = segments.reduce((sum, length) => sum + length, 0);

  // count точек равными шагами ВДОЛЬ пути: первая в первой опоре, последняя — в последней.
  return getIndices(count).map((index) => {
    let rest = count === 1 ? 0 : (index / (count - 1)) * total;

    for (let i = 0; i < segments.length; i++) {
      if (rest <= segments[i] || i === segments.length - 1) {
        const frac = segments[i] === 0 ? 0 : rest / segments[i];
        const from = nodes[i];
        const to = nodes[i + 1];

        return { x: from.x + (to.x - from.x) * frac, z: from.z + (to.z - from.z) * frac };
      }

      rest -= segments[i];
    }

    return { ...nodes[nodes.length - 1] };
  });
};

const getWavePoints = ({
  count,
  angle = getRandomAngle(),
  width = config.DEFAULT_WAVE_WIDTH,
  amplitude = config.DEFAULT_WAVE_AMPLITUDE,
  periods = config.DEFAULT_WAVE_PERIODS,
  distance = config.SPAWN_RADIUS,
}: WaveShape): Point[] => {
  const center = getSpawnCirclePoint(angle, distance);

  // База — тот же поперечный ряд, что у line (вдоль «угол + 90°»), а колебание синусоиды идёт
  // по радиусу (вдоль «угол + 0°»): волна «бежит» по окружности спавна, качаясь внутрь/наружу.
  const along = getScreenDirection(angle + 90);
  const across = getScreenDirection(angle);

  if (count === 1) {
    return [{ ...center }];
  }

  // t — положение точки вдоль ряда от 0 до 1. Синус нулевой на обоих краях, поэтому концы волны
  // лежат на средней линии.
  return getIndices(count).map((index) => {
    const t = index / (count - 1);
    const alongOffset = -width / 2 + t * width;
    const waveOffset = amplitude * Math.sin(2 * Math.PI * periods * t);

    return {
      x: center.x + along.x * alongOffset + across.x * waveOffset,
      z: center.z + along.z * alongOffset + across.z * waveOffset,
    };
  });
};

const getPerimeterPoints = ({ count, inset = config.PERIMETER_INSET }: PerimeterShape): Point[] => {
  // Половина арены минус отступ от стенки: центр врага должен остаться над полом, иначе он погибнет.
  const h = config.ARENA_SIZE / 2 - inset;

  // Вершины квадрата в мировых координатах. На экране оси X/Z идут по диагоналям, поэтому
  // (-h,-h) — «верх», (h,-h) — «право», (h,h) — «низ», (-h,h) — «лево»: обход по часовой.
  const corners: Point[] = [
    { x: -h, z: -h },
    { x: h, z: -h },
    { x: h, z: h },
    { x: -h, z: h },
  ];
  const edge = 2 * h; // каждое ребро квадрата одинаковой длины
  const total = edge * corners.length;

  // Замкнутый обход: count точек равными шагами по периметру, последняя не совпадает с первой.
  return getIndices(count).map((index) => {
    const travelled = (index / count) * total;
    const corner = Math.floor(travelled / edge) % corners.length;
    const frac = (travelled % edge) / edge;
    const from = corners[corner];
    const to = corners[(corner + 1) % corners.length];

    return { x: from.x + (to.x - from.x) * frac, z: from.z + (to.z - from.z) * frac };
  });
};

// Случайный сдвиг каждой точки в круге радиуса jitter (равномерно: направление — любое,
// расстояние — корень из случайного, чтобы точки не скучивались у центра круга сдвига).
const applyJitter = (points: Point[], jitter: number): Point[] =>
  points.map((point) => {
    const direction = Math.random() * Math.PI * 2;
    const dist = jitter * Math.sqrt(Math.random());

    return { x: point.x + Math.cos(direction) * dist, z: point.z + Math.sin(direction) * dist };
  });

// Точки для любой формы. Сначала switch по полю type (TypeScript внутри ветки знает точный тип),
// потом — случайный сдвиг jitter, если он задан: он общий для всех форм.
export const getShapePoints = (shape: Shape): Point[] => {
  const points = (() => {
    switch (shape.type) {
      case 'circle':
        return getCirclePoints(shape);
      case 'random':
        return getRandomPoints(shape);
      case 'line':
        return getLinePoints(shape);
      case 'cluster':
        return getClusterPoints(shape);
      case 'polygon':
        return getPolygonPoints(shape);
      case 'path':
        return getPathPoints(shape);
      case 'wave':
        return getWavePoints(shape);
      case 'perimeter':
        return getPerimeterPoints(shape);
    }
  })();

  return shape.jitter ? applyJitter(points, shape.jitter) : points;
};
