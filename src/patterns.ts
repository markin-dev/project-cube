// Паттерны — формы, по которым расставляются враги группы. Каждая форма — функция,
// которая по параметрам возвращает список точек на полу. КОГДА враги появятся в этих точках,
// решает не форма, а тайминг группы (см. src/waves.ts и src/schedule.ts).
//
// ВАЖНО про ёмкость форм (2026-10-11): подборщик места при спавне не даёт врагам наложиться
// (см. src/spawn-placement.ts), поэтому у формы с фиксированным габаритом L есть потолок числа
// точек ≈ L / зазор. Формы line (шеренга), cluster (кучка) и wave (волна) имели габарит 3–6 м
// и при счётчике больше ~9 размазывались плейсером в толпу — они удалены. Форма path (ломаная
// через опоры) удалена тем же днём по решению пользователя — не прижилась (см. Сессию 29 в
// docs/memory.md). Оставшиеся формы большие (габарит 15–28 м, потолок 40–120 точек); идея
// на будущее — формы-области, у которых
// ёмкость растёт с площадью, а не с длиной контура (подробно — в docs/memory.md, Сессии 24–25).
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
// distance — на каком удалении от центра арены лежит окружность: меньше — ближе к игроку
// (внутренний обстрел), больше — дальше (осада). Обязательный параметр: радиус спавна — не
// глобальная настройка, а значение конкретной формы, его задают в описании волны (src/waves.ts).
// Есть у всех форм, кроме random — у него точек нет «домашней» окружности: он сеет кольцо
// всей арены от SAFE_RADIUS до стены.
type CircleShape = BaseShape & {
  type: 'circle';
  count: number;
  angle?: number;
  arc?: number;
  distance: number;
};

// «То тут то там»: случайные точки по всей арене РАВНОМЕРНО по площади, но вне безопасной зоны —
// круга радиуса SAFE_RADIUS вокруг центра арены (там куб игрока). Это ОБЩЕЕ правило подборщика
// мест, оно действует на все формы (см. src/spawn-placement.ts), здесь же формируется «домашнее»
// кольцо random: от края зоны до стены арены с отступом PERIMETER_INSET — центр врага должен
// остаться над полом, иначе он погибнет сразу (см. isEnemyOverArena).
// Как и раньше, у random нет «домашней» окружности спавна, поэтому distance/angle/arc не работают.
// Внутренняя граница кольца — SAFE_RADIUS с запасом на половину самого крупного типа врага: без
// него подборщик прижал бы точку крупного врага к краю зоны (типы в группе случайные).
type RandomShape = BaseShape & {
  type: 'random';
  count: number;
};

// Многоугольник: count точек вдоль ПЕРИМЕТРА правильного sides-угольника, вписанного в окружность
// радиуса distance и повёрнутого на angle. В отличие от circle (точки по дуге) — прямые рёбра.
// sides — ЧИСЛО УГЛОВ (3 — треугольник, 6 — шестиугольник): форма универсальна, углов сколько угодно.
type PolygonShape = BaseShape & {
  type: 'polygon';
  count: number;
  sides?: number;
  angle?: number;
  distance: number;
};

// Периметр: count точек вдоль КВАДРАТА арены (мировые оси, на экране — ромб, т.к. оси X/Z идут по
// диагоналям). Замкнутый обход по часовой от «верхней» вершины. inset — отступ внутрь от стенки:
// центр врага обязан остаться над ареной, иначе он погибнет сразу (см. isEnemyOverArena).
type PerimeterShape = BaseShape & {
  type: 'perimeter';
  count: number;
  inset?: number;
};

export type Shape = CircleShape | RandomShape | PolygonShape | PerimeterShape;

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

// Точка на окружности спавна под экранным углом. distance — радиус этой окружности:
// уменьшает/увеличивает удалённость формы от центра арены.
const getSpawnCirclePoint = (degrees: number, distance: number): Point => {
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
  distance,
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

const getRandomPoints = ({ count }: RandomShape): Point[] => {
  // Кольцо спавна — от края безопасной зоны до стены арены с отступом. Запас на половину самого
  // крупного типа врага: без него подборщик прижал бы точку крупного врага к краю зоны.
  const maxHalf = Math.max(...Object.values(config.ENEMY_KINDS).map((kind) => kind.size)) / 2;
  const inner = config.SAFE_RADIUS + maxHalf;
  const outer = config.ARENA_SIZE / 2 - config.PERIMETER_INSET;

  // Защита от вырождения: если зона съела кольцо целиком — прижимаем к внешней границе
  // с запасом в полметра, иначе корень из отрицательного числа дал бы NaN.
  const innerClamped = Math.min(Math.max(0, inner), Math.max(0, outer - 0.5));

  // Равномерное распределение по ПЛОЩАДИ кольца: направление — любое, квадрат радиуса —
  // равномерная случайная, отсюда корень. Без корня точки скопились бы у внутреннего края,
  // ведь площадь тонких колец растёт с радиусом.
  return getIndices(count).map(() => {
    const radius = Math.sqrt(innerClamped ** 2 + Math.random() * (outer ** 2 - innerClamped ** 2));
    const direction = Math.random() * Math.PI * 2;

    return { x: Math.cos(direction) * radius, z: Math.sin(direction) * radius };
  });
};

const getPolygonPoints = ({
  count,
  sides = config.DEFAULT_POLYGON_SIDES,
  angle = getRandomAngle(),
  distance,
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

  // Длина стороны и полный периметр квадрата.
  const edge = 2 * h;
  const total = edge * corners.length;

  // count точек равными шагами вдоль периметра: от вершины вверх по часовой.
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
      case 'polygon':
        return getPolygonPoints(shape);
      case 'perimeter':
        return getPerimeterPoints(shape);
    }
  })();

  return shape.jitter ? applyJitter(points, shape.jitter) : points;
};
