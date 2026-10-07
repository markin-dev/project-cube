import { getShapePoints, type Point } from './patterns';
import type { Wave } from './waves';

// Событие расписания: в момент time (секунд от начала волны) появиться врагу в точке (x, z).
export type SpawnEvent = Point & {
  time: number;
};

// Превращает описание волны в расписание: для каждой группы считаем точки её формы
// и время появления каждого врага (delay группы + номер врага × interval).
// Потом события всех групп сливаются в один список, отсортированный по времени,
// — игровому циклу остаётся доставать их по порядку, пока время события наступило.
// Точки считаются в момент вызова, поэтому случайные углы и разброс каждый раз новые.
export const buildWaveSchedule = (wave: Wave): SpawnEvent[] =>
  wave.groups
    .flatMap(({ shape, delay = 0, interval = 0 }) =>
      getShapePoints(shape).map((point, index) => ({ ...point, time: delay + index * interval })),
    )
    .sort((first, second) => first.time - second.time);
