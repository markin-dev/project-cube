// E2E полигона (SCENE_MODE = 'polygon', см. polygon.ts): выбор в селекте «Сцена» строит сетку врагов,
// кнопка «Пересоздать сетку» строит её заново по текущим параметрам, убитая сетка сменяется следующей,
// а возврат к игре начинает её заново со стартовой волны.
import { expect, it } from 'vitest';
import '@/main';
import { config } from '@/config';
import { getButton, getEnemiesCount, setSceneMode, waitUntil } from './helpers';

// Переключает сцену через демо. browser/setup.ts перед каждым тестом пишет config.SCENE_MODE = 'game'
// мимо панели, и выбор «Игры» панель приняла бы за «ничего не поменялось». Шаг через демо всегда
// меняет значение — переход доходит до игры при любом состоянии, оставленном прошлым тестом.
const switchScene = (index: number): void => {
  setSceneMode(1);
  setSceneMode(index);
};

// Нажимает кнопку «Пересоздать сетку» в разделе «Полигон».
const rebuildGrid = (): void => {
  const button = getButton('Пересоздать сетку');

  if (!button) {
    throw new Error('кнопка «Пересоздать сетку» не найдена');
  }

  button.click();
};

it('Должен построить сетку из POLYGON_ENEMY_COUNT врагов при выборе полигона', () => {
  switchScene(0);
  config.POLYGON_ENEMY_COUNT = 12;
  switchScene(2);

  expect(getEnemiesCount()).toBe(12);
});

it('Должен построить следующую сетку, когда прежняя убита', async () => {
  // Три крошки и частая стрельба: крошке хватает одного попадания, сетка гибнет за секунду-другую.
  config.POLYGON_ENEMY_KIND = 'tiny';
  config.POLYGON_ENEMY_COUNT = 3;
  config.FIRE_INTERVAL = 0.05;
  switchScene(2);
  rebuildGrid();

  await waitUntil({
    isDone: () => document.body.innerText.includes('Полигон · сетка 2'),
    timeoutMs: 20000,
    what: 'вторая сетка',
  });

  expect(document.body.innerText).toContain('Полигон · сетка 2');
});

it('Должен начать игру заново со стартовой волны при возврате из полигона', () => {
  switchScene(2);
  switchScene(0);

  expect(document.body.innerText).toContain('Волна 1');
});
