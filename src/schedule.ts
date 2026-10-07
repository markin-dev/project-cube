import { config, type EnemyKindName } from './config';
import { ENEMY_KIND_NAMES } from './enemies';
import { getShapePoints, type Point } from './patterns';
import type { Wave } from './waves';

// Событие расписания группы: через time секунд после начала группы появиться врагу типа kindName в точке (x, z).
export type SpawnEvent = Point & {
  time: number;
  kindName: EnemyKindName;
};

// Расписание одной группы волны: delay — не позже скольких секунд от начала волны группа начнётся
// (раньше — если все враги предыдущих групп уже убиты, см. startDueGroups в main.ts),
// events — её враги по порядку появления.
export type GroupSchedule = {
  delay: number;
  events: SpawnEvent[];
};

const getRandomKindName = (): EnemyKindName => ENEMY_KIND_NAMES[Math.floor(Math.random() * ENEMY_KIND_NAMES.length)];

// Превращает описание волны в расписание по группам: для каждой группы считаем точки её формы,
// время появления каждого врага от начала группы (номер врага × interval) и его тип
// (тип группы, а если он не указан — случайный для каждого врага).
// Точки и случайные типы считаются в момент вызова, поэтому каждый раз новые.
// config.ENEMY_COUNT_MULTIPLIER (см. config.ts) умножает число врагов в группе и во столько же раз
// сокращает интервал между ними — группа появляется за то же время, но гуще.
export const buildWaveSchedule = (wave: Wave): GroupSchedule[] =>
  wave.groups.map(({ shape, delay = 0, interval = 0, enemy }) => ({
    delay,
    events: getShapePoints({ ...shape, count: shape.count * config.ENEMY_COUNT_MULTIPLIER }).map((point, index) => ({
      ...point,
      time: (index * interval) / config.ENEMY_COUNT_MULTIPLIER,
      kindName: enemy ?? getRandomKindName(),
    })),
  }));
