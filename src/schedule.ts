import { config, type EnemyKindName } from './config';
import { ENEMY_KIND_NAMES } from './enemies';
import { getShapePoints, type Point } from './patterns';
import type { Wave } from './waves';

// Событие расписания: в момент time (секунд от начала волны) появиться врагу типа kindName в точке (x, z).
export type SpawnEvent = Point & {
  time: number;
  kindName: EnemyKindName;
};

const getRandomKindName = (): EnemyKindName => ENEMY_KIND_NAMES[Math.floor(Math.random() * ENEMY_KIND_NAMES.length)];

// Превращает описание волны в расписание: для каждой группы считаем точки её формы,
// время появления каждого врага (delay группы + номер врага × interval) и его тип
// (тип группы, а если он не указан — случайный для каждого врага).
// Потом события всех групп сливаются в один список, отсортированный по времени,
// — игровому циклу остаётся доставать их по порядку, пока время события наступило.
// Точки и случайные типы считаются в момент вызова, поэтому каждый раз новые.
// config.ENEMY_COUNT_MULTIPLIER (см. config.ts) умножает число врагов в группе и во столько же раз
// сокращает интервал между ними — группа появляется за то же время, но гуще.
export const buildWaveSchedule = (wave: Wave): SpawnEvent[] =>
  wave.groups
    .flatMap(({ shape, delay = 0, interval = 0, enemy }) =>
      getShapePoints({ ...shape, count: shape.count * config.ENEMY_COUNT_MULTIPLIER }).map((point, index) => ({
        ...point,
        time: delay + (index * interval) / config.ENEMY_COUNT_MULTIPLIER,
        kindName: enemy ?? getRandomKindName(),
      })),
    )
    .sort((first, second) => first.time - second.time);
