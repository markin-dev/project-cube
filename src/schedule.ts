import { config, ENEMY_KIND_NAMES, type EnemyKindName } from './config';
import { getShapePoints, type Point } from './patterns';
import type { Wave } from './waves';

// Событие расписания группы: через time секунд после начала группы появиться врагу типа kindName в точке (x, z).
export type SpawnEvent = Point & {
  time: number;
  kindName: EnemyKindName;
};

// Расписание одной группы волны: delay — не позже скольких секунд от начала волны группа начнётся
// (раньше — если все враги предыдущих групп уже убиты, см. startDueGroups в game.ts),
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
// config.ENEMY_COUNT_MULTIPLIER (см. config.ts) и множитель круга round (см. game.ts) перемножаются:
// итоговый множитель умножает число врагов в группе и во столько же раз сокращает интервал между
// ними — группа появляется за то же время, но гуще.
export const buildWaveSchedule = (wave: Wave, round: number = 1): GroupSchedule[] => {
  const multiplier = config.ENEMY_COUNT_MULTIPLIER * round;

  return wave.groups.map(({ shape, delay = 0, interval = 0, enemy }) => ({
    delay,
    events: getShapePoints({ ...shape, count: shape.count * multiplier }).map((point, index) => ({
      ...point,
      time: (index * interval) / multiplier,
      kindName: enemy ?? getRandomKindName(),
    })),
  }));
};

// Сколько первых событий группы наступило к моменту elapsed (секунд от начала группы). События идут
// по возрастанию времени, поэтому границу ищем двоичным поиском, а не перебором: в огромной группе
// (большой множитель врагов) событий тысячи, а спрашивают об этом на каждом шаге.
export const countDueEvents = (events: SpawnEvent[], elapsed: number): number => {
  const search = (low: number, high: number): number => {
    if (low >= high) {
      return low;
    }

    const middle = Math.floor((low + high) / 2);

    return events[middle].time <= elapsed ? search(middle + 1, high) : search(low, middle);
  };

  return search(0, events.length);
};
