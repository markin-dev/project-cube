// Список волн игры. Чтобы поменять или добавить волну, достаточно править этот файл.
//
// Волна состоит из групп. У каждой группы две независимые части:
//   shape    — ГДЕ появятся враги: форма и её параметры (все формы описаны в src/patterns.ts);
//   delay    — КОГДА группа начнёт появляться: секунд от начала волны (по умолчанию 0);
//   interval — пауза между врагами группы в секундах. 0 или не указан — все разом,
//              иначе по одному в порядке формы (кольцо — по часовой, шеренга — слева направо).
//
// Углы — в градусах относительно экрана: 0° — вверх, 90° — вправо, 180° — вниз, 270° — влево.
// Угол не указан — выбирается случайно (один раз на группу).
//
// Волна закончена, когда все её враги появились и убиты. Следующая начинается сразу,
// так что паузу перед волной делаем через delay у её групп. Последняя волна пройдена — победа.
//
// Ориентир по балансу: куб стреляет раз в секунду, враг идёт до куба ~5 секунд.
// Значит, из врагов, появившихся одновременно, куб успеет убить не больше ~5.
//
// Чтобы проверить конкретную волну, открой игру с параметром ?wave=N — она начнётся с волны N.
import type { Shape } from './patterns';

export type SpawnGroup = {
  shape: Shape;
  delay?: number;
  interval?: number;
};

export type Wave = {
  // Название показывается на экране рядом с номером волны — удобно при отладке.
  name: string;
  groups: SpawnGroup[];
};

export const WAVES: Wave[] = [
  {
    name: 'Разминка',
    groups: [{ shape: { type: 'random', count: 3 }, interval: 1.5 }],
  },
  {
    name: 'Дуга сверху',
    groups: [{ shape: { type: 'circle', count: 4, angle: 0, arc: 90 } }],
  },
  {
    name: 'Кольцо по часовой',
    groups: [{ shape: { type: 'circle', count: 8, angle: 0 }, interval: 0.4 }],
  },
  {
    name: 'С двух сторон',
    groups: [
      { shape: { type: 'line', count: 4, angle: 90 } },
      { shape: { type: 'line', count: 4, angle: 270 }, delay: 5 },
    ],
  },
  {
    name: 'Кучки',
    groups: [
      { shape: { type: 'cluster', count: 4 } },
      { shape: { type: 'cluster', count: 4 }, delay: 5 },
      { shape: { type: 'cluster', count: 4 }, delay: 10 },
    ],
  },
  {
    name: 'То тут то там',
    groups: [{ shape: { type: 'random', count: 12 }, interval: 0.9 }],
  },
  {
    name: 'Клещи',
    groups: [
      { shape: { type: 'circle', count: 3, angle: 90, arc: 60 } },
      { shape: { type: 'circle', count: 3, angle: 270, arc: 60 }, delay: 2 },
    ],
  },
  {
    name: 'Карусель против часовой',
    groups: [{ shape: { type: 'circle', count: 10, angle: 180, arc: -360 }, interval: 0.6 }],
  },
  {
    name: 'Крест',
    groups: [
      { shape: { type: 'line', count: 3, angle: 0 } },
      { shape: { type: 'line', count: 3, angle: 180 }, delay: 2.5 },
      { shape: { type: 'line', count: 3, angle: 90 }, delay: 5 },
      { shape: { type: 'line', count: 3, angle: 270 }, delay: 7.5 },
    ],
  },
  {
    name: 'Финал',
    groups: [
      { shape: { type: 'circle', count: 4, angle: 45 } },
      { shape: { type: 'circle', count: 4, angle: 0 }, delay: 5 },
      { shape: { type: 'random', count: 6 }, delay: 9, interval: 0.8 },
      { shape: { type: 'cluster', count: 4 }, delay: 15 },
    ],
  },
];
