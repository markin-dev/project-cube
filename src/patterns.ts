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

// Кольцо (arc = 360, по умолчанию) или дуга (arc < 360) на окружности спавна.
// Кольцо: первый враг на angle, остальные по часовой. Дуга: angle — её середина, крайние точки включены.
// Отрицательный arc — тот же обход, но против часовой.
type CircleShape = {
  type: 'circle';
  count: number;
  angle?: number;
  arc?: number;
};

// «То тут то там»: случайные точки на окружности спавна.
// angle и arc ограничивают сектор (например, angle: 0, arc: 90 — только сверху). По умолчанию весь круг.
type RandomShape = {
  type: 'random';
  count: number;
  angle?: number;
  arc?: number;
};

// Шеренга: враги в ряд поперёк направления на куб, центр ряда на окружности спавна под углом angle.
// width — длина ряда. Порядок — по часовой (слева направо, если смотреть от куба наружу).
type LineShape = {
  type: 'line';
  count: number;
  angle?: number;
  width?: number;
};

// Кучка: враги случайно разбросаны в круге радиуса radius вокруг точки окружности спавна под углом angle.
type ClusterShape = {
  type: 'cluster';
  count: number;
  angle?: number;
  radius?: number;
};

export type Shape = CircleShape | RandomShape | LineShape | ClusterShape;

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

// Точка на окружности спавна под экранным углом.
const getSpawnCirclePoint = (degrees: number): Point => {
  const direction = getScreenDirection(degrees);

  return { x: direction.x * config.SPAWN_RADIUS, z: direction.z * config.SPAWN_RADIUS };
};

const getRandomAngle = (): number => Math.random() * 360;

// Массив [0, 1, …, count - 1] — индексы врагов группы.
const getIndices = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

// ─── ФОРМЫ ───────────────────────────────────────────────────────────────────

const getCirclePoints = ({ count, angle = getRandomAngle(), arc = 360 }: CircleShape): Point[] => {
  const isFullCircle = Math.abs(arc) >= 360;

  // Кольцо: count равных шагов по кругу — последний враг не совпадает с первым.
  // Дуга: count - 1 шаг от одного края до другого, оба края заняты.
  const getAngle = (index: number): number => {
    if (isFullCircle) {
      return angle + (index * arc) / count;
    }

    return count === 1 ? angle : angle - arc / 2 + (index * arc) / (count - 1);
  };

  return getIndices(count).map((index) => getSpawnCirclePoint(getAngle(index)));
};

const getRandomPoints = ({ count, angle = getRandomAngle(), arc = 360 }: RandomShape): Point[] =>
  getIndices(count).map(() => getSpawnCirclePoint(angle - arc / 2 + Math.random() * arc));

const getLinePoints = ({
  count,
  angle = getRandomAngle(),
  width = config.DEFAULT_LINE_WIDTH,
}: LineShape): Point[] => {
  const center = getSpawnCirclePoint(angle);

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
}: ClusterShape): Point[] => {
  const center = getSpawnCirclePoint(angle);

  // Случайная точка в круге: случайное направление и случайное расстояние.
  // Корень из случайного числа нужен, чтобы точки ложились равномерно, а не скучивались у центра.
  // Если враги появятся вплотную, физика сама их растолкает.
  return getIndices(count).map(() => {
    const direction = Math.random() * Math.PI * 2;
    const distance = radius * Math.sqrt(Math.random());

    return {
      x: center.x + Math.cos(direction) * distance,
      z: center.z + Math.sin(direction) * distance,
    };
  });
};

// Точки для любой формы. switch по полю type: TypeScript внутри каждой ветки знает точный тип формы.
export const getShapePoints = (shape: Shape): Point[] => {
  switch (shape.type) {
    case 'circle':
      return getCirclePoints(shape);
    case 'random':
      return getRandomPoints(shape);
    case 'line':
      return getLinePoints(shape);
    case 'cluster':
      return getClusterPoints(shape);
  }
};
