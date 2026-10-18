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

// Масштаб волны: во сколько раз её делают больше и крепче, чем она записана в src/waves.ts.
export type WaveScale = {
  // Во сколько раз больше врагов в каждой группе (интервал между ними делится на столько же).
  count: number;

  // Во сколько раз крепче каждый враг: множитель его здоровья и опыта (см. spawnEnemy в enemies.ts).
  strength: number;
};

const getRandomKindName = (): EnemyKindName => ENEMY_KIND_NAMES[Math.floor(Math.random() * ENEMY_KIND_NAMES.length)];

// Здоровье врага группы: тип группы, а у группы без типа (случайный тип у каждого) — среднее по всем типам.
const getGroupEnemyHp = (enemy: EnemyKindName | undefined): number =>
  enemy === undefined
    ? ENEMY_KIND_NAMES.reduce((sum, name) => sum + config.ENEMY_KINDS[name].hp, 0) / ENEMY_KIND_NAMES.length
    : config.ENEMY_KINDS[enemy].hp;

// HP-бюджет волны: сколько здоровья во всех её врагах вместе, как она записана (по текущим ENEMY_KINDS).
// Мера тяжести волны: рост волн (getWaveScale) подгоняет под нужный бюджет любой состав.
export const getWaveBudget = (wave: Wave): number =>
  wave.groups.reduce((sum, { shape, enemy }) => sum + shape.count * getGroupEnemyHp(enemy), 0);

// Масштаб волны со сквозным номером waveNumber (с 1); cycleLength — сколько волн в списке.
// Первый проход по списку — обучающий круг: волны идут ровно как записаны. Дальше составы повторяются
// по кругу, а нужный HP-бюджет растёт: первая волна после круга — config.WAVE_ENDLESS_BUDGET,
// каждая следующая — в config.WAVE_GROWTH раз больше. Во сколько раз нужный бюджет больше бюджета
// состава (m), делится между числом врагов (m^доля) и их крепостью (m^(1 − доля)),
// доля — config.WAVE_COUNT_SHARE. Так волна-рой крошек и волна-громилы при одном номере одинаково тяжелы.
// Волна после круга не легче, чем записана (m не меньше 1): иначе тяжёлый состав, которому бюджет
// ещё не дорос (например, брут с отрядом сразу после круга), вышел бы с врагами слабее их типа.
export const getWaveScale = ({
  wave,
  waveNumber,
  cycleLength,
}: {
  wave: Wave;
  waveNumber: number;
  cycleLength: number;
}): WaveScale => {
  const budget = getWaveBudget(wave);

  if (waveNumber <= cycleLength || budget <= 0) {
    return { count: 1, strength: 1 };
  }

  const targetBudget = config.WAVE_ENDLESS_BUDGET * Math.pow(config.WAVE_GROWTH, waveNumber - cycleLength - 1);
  const multiplier = Math.max(1, targetBudget / budget);

  return {
    count: Math.pow(multiplier, config.WAVE_COUNT_SHARE),
    strength: Math.pow(multiplier, 1 - config.WAVE_COUNT_SHARE),
  };
};

// Превращает описание волны в расписание по группам: для каждой группы считаем точки её формы,
// время появления каждого врага от начала группы (номер врага × interval) и его тип
// (тип группы, а если он не указан — случайный для каждого врага).
// Точки и случайные типы считаются в момент вызова, поэтому каждый раз новые.
// countMultiplier (масштаб волны, см. getWaveScale) и config.ENEMY_COUNT_MULTIPLIER (см. config.ts)
// перемножаются: итоговый множитель умножает число врагов в группе (с округлением, но не меньше
// одного) и во столько же раз сокращает интервал между ними — группа появляется за то же время, но гуще.
export const buildWaveSchedule = (wave: Wave, countMultiplier: number = 1): GroupSchedule[] => {
  const multiplier = config.ENEMY_COUNT_MULTIPLIER * countMultiplier;

  return wave.groups.map(({ shape, delay = 0, interval = 0, enemy }) => {
    const count = Math.max(1, Math.round(shape.count * multiplier));

    return {
      delay,
      events: getShapePoints({ ...shape, count }).map((point, index) => ({
        ...point,
        time: (index * interval) / multiplier,
        kindName: enemy ?? getRandomKindName(),
      })),
    };
  });
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
