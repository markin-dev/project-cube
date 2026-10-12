// Паттерн — форма, по которой расставляются враги группы. ЕДИНСТВЕННАЯ форма — random:
// случайные точки по всей арене, равномерные по площади. КОГДА враги появятся в этих точках,
// решает не форма, а тайминг группы (см. src/waves.ts и src/schedule.ts).
//
// Формы circle (кольцо/дуга), polygon (многоугольник) и perimeter (квадрат по краю) удалены
// 2026-10-13 по решению пользователя — «упростим всё ещё сильнее: оставляем только рандомную».
// Ранее удалённые line/cluster/wave (малый габарит) и path (не прижилась) — история
// в docs/memory.md (Сессии 15–33). У random нет габарита контура: ёмкость растёт с площадью
// кольца спавна, а при огромном счётчике подборщик места строит врагов вверх столбами
// (см. src/spawn-placement.ts), так что форма не «распухает» при большом count.
import { config } from './config';

// Точка на полу. Высоту (y) задаёт сам враг при появлении.
export type Point = {
  x: number;
  z: number;
};

// Единственная форма: count случайных точек. Точки лежат вне безопасной зоны — круга радиуса
// SAFE_RADIUS вокруг центра арены (это общее правило подборщика мест, см. src/spawn-placement.ts) —
// и не дальше внешней границы: стена арены минус отступ ARENA_INSET. Отступ нужен, чтобы центр
// врага оставался над полом, иначе он погибнет сразу (см. isEnemyOverArena).
export type RandomShape = {
  type: 'random';
  count: number;
};

export type Shape = RandomShape;

// Массив [0, 1, …, count - 1] — индексы точек группы.
const getIndices = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

// Точки для random. Кольцо спавна — от края безопасной зоны до стены арены с отступом; запас на
// половину самого крупного типа врага: без него подборщик прижал бы точку крупного врага к краю
// зоны (типы в группе случайные). Равномерное распределение по ПЛОЩАДИ кольца: направление —
// любое, квадрат радиуса — равномерная случайная, отсюда корень. Без корня точки скопились бы
// у внутреннего края, ведь площадь тонких колец растёт с радиусом.
export const getShapePoints = ({ count }: RandomShape): Point[] => {
  const maxHalf = Math.max(...Object.values(config.ENEMY_KINDS).map((kind) => kind.size)) / 2;
  const inner = config.SAFE_RADIUS + maxHalf;
  const outer = config.ARENA_SIZE / 2 - config.ARENA_INSET;

  // Защита от вырождения: если зона съела кольцо целиком — прижимаем к внешней границе
  // с запасом в полметра, иначе корень из отрицательного числа дал бы NaN.
  const innerClamped = Math.min(Math.max(0, inner), Math.max(0, outer - 0.5));

  return getIndices(count).map(() => {
    const radius = Math.sqrt(innerClamped ** 2 + Math.random() * (outer ** 2 - innerClamped ** 2));
    const direction = Math.random() * Math.PI * 2;

    return { x: Math.cos(direction) * radius, z: Math.sin(direction) * radius };
  });
};
