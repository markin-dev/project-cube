// Smoke-тест: игра заводится импортом точки входа в настоящем chromium, игровой цикл
// (физика + рендер + волны) идёт.
import { expect, it } from 'vitest';
import '@/main';
import { getEnemiesCount, getGame } from './helpers';

it('Должен нарисовать игру на canvas', () => {
  expect(document.querySelector('canvas')).not.toBeNull();
});

it('Должен открыть тестовый доступ __game', () => {
  expect(getGame()).toBeDefined();
});

it('Должен выпустить врагов первой волны', async () => {
  await expect.poll(getEnemiesCount, { timeout: 15000 }).toBeGreaterThan(0);
});
