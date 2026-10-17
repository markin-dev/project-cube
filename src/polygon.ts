// Полигон — сцена для отработки урона, стрельбы и критов (SCENE_MODE = 'polygon'): враги стоят
// квадратной сеткой вокруг куба и к нему не идут, куб стреляет по ним как обычно. Когда сетка
// убита, сразу встаёт следующая. Здесь — только где стоят враги сетки и какого они типа;
// постройку сетки, её смену и отключение движения делает игровая логика (startPolygon в game.ts).
import { config, ENEMY_KIND_NAMES, type EnemyKindName } from './config';
import type { Point } from './patterns';

// Тип врагов сетки из конфига. Значение приходит строкой (селект панели, сохранение в браузере) —
// неизвестное имя, например из старого сохранения, заменяем на обычного врага.
export const getPolygonKindName = (): EnemyKindName =>
  ENEMY_KIND_NAMES.find((name) => name === config.POLYGON_ENEMY_KIND) ?? 'normal';

// Узел решётки: координаты на полу и номер узла по осям — по номерам считается порядок сетки.
type GridNode = Point & {
  column: number;
  row: number;
};

// Точки сетки для врагов типа kindName, ближайшие к кубу первыми.
// Решётка квадратная, с узлом в центре арены (там стоит куб). Шаг — сторона врага плюс расстояние
// POLYGON_ENEMY_GAP: соседи стоят на этом расстоянии грань к грани. Из всех узлов арены берём
// POLYGON_ENEMY_COUNT ближайших к центру — сетка заполняет круг вокруг куба и растёт наружу.
// Узел пропускается, если он:
//   внутри пустого круга POLYGON_CLEAR_RADIUS;
//   ближе к кубу, чем к соседям: враг и куб не повёрнуты, поэтому зазор между их гранями — это
//     max(|x|, |z|) минус половины их сторон, и он должен быть не меньше расстояния между врагами;
//   дальше стены минус ARENA_INSET — центр врага должен остаться над ареной (см. isEnemyOverArena).
// Узлов меньше, чем просили, — ставим сколько влезло.
// Порядок «ближе — раньше» считаем по номерам узлов (column² + row²): это целые числа, поэтому
// равноудалённые узлы сравниваются точно, а между ними порядок задаёт угол — сетка всегда одна и та же.
export const getPolygonPoints = (kindName: EnemyKindName): Point[] => {
  const { size } = config.ENEMY_KINDS[kindName];
  const gap = Math.max(0, config.POLYGON_ENEMY_GAP);
  const step = size + gap;
  const limit = config.ARENA_SIZE / 2 - config.ARENA_INSET;
  const playerClearance = (config.PLAYER_SIZE + size) / 2 + gap;

  // Сколько узлов помещается от центра до границы по одной оси. Отрицательная граница (отступ
  // больше половины арены) — ни одного узла, кроме центрального, а его займёт куб.
  const nodesPerHalf = Math.max(0, Math.floor(limit / step));
  const indices = Array.from({ length: nodesPerHalf * 2 + 1 }, (_, index) => index - nodesPerHalf);

  const isFree = ({ x, z }: GridNode): boolean =>
    Math.hypot(x, z) >= config.POLYGON_CLEAR_RADIUS && Math.max(Math.abs(x), Math.abs(z)) >= playerClearance;

  const getRank = ({ column, row }: GridNode): number => column * column + row * row;
  const getAngle = ({ column, row }: GridNode): number => Math.atan2(row, column);

  return indices
    .flatMap((column) => indices.map((row): GridNode => ({ x: column * step, z: row * step, column, row })))
    .filter(isFree)
    .sort((first, second) => getRank(first) - getRank(second) || getAngle(first) - getAngle(second))
    .slice(0, Math.max(0, Math.floor(config.POLYGON_ENEMY_COUNT)))
    .map(({ x, z }) => ({ x, z }));
};
