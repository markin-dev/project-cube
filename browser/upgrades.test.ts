// E2E выбора усилений (src/upgrades.ts, src/upgrade-ui.ts): на новом уровне игра встаёт и показывает
// карточки, клик или клавиша выбирают усиление — оно появляется точкой в списке статов, игра идёт дальше.
// Базу опыта опускаем до 1 до старта игры (main.ts грузим после правки), чтобы уровни шли с первых крошек.
// Выборы приходят один за другим, поэтому каждый тест ждёт открытого выбора сам.
import { expect, it } from 'vitest';
import { config } from '@/config';
import { getGame, sleep, waitUntil } from './helpers';

config.LEVEL_XP_BASE = 1;
await import('@/main');

const isOfferShown = (): boolean => document.querySelector('.upgrade-overlay.is-shown') !== null;

const getCards = (): NodeListOf<HTMLButtonElement> => document.querySelectorAll('.upgrade-card');

// Сколько усилений уже взято — по точкам в списке статов.
const getTakenCount = (): number => document.querySelectorAll('.upgrade-stats__pip').length;

const waitForOffer = (): Promise<void> =>
  waitUntil({ isDone: isOfferShown, timeoutMs: 20000, what: 'выбор усиления' });

// Позиции живых врагов — снимок, чтобы сравнить «до» и «после».
const getEnemyPositions = (): number[][] =>
  [...(getGame()?.enemies.values() ?? [])].map(({ body }) => {
    const { x, y, z } = body.translation();

    return [x, y, z];
  });

it('Должен показать карточки выбора на новом уровне', async () => {
  await waitForOffer();

  expect(getCards()).toHaveLength(config.UPGRADE_CHOICES);
});

it('Должен остановить игру, пока выбор открыт', async () => {
  await waitForOffer();

  const frozen = getEnemyPositions();

  await sleep(500);

  expect(getEnemyPositions()).toEqual(frozen);
});

it('Должен взять усиление кликом по карточке', async () => {
  await waitForOffer();

  const takenBefore = getTakenCount();

  getCards()[0].click();

  expect(getTakenCount()).toBe(takenBefore + 1);
});

it('Должен взять усиление клавишей с номером карточки', async () => {
  await waitForOffer();

  const takenBefore = getTakenCount();

  window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));

  expect(getTakenCount()).toBe(takenBefore + 1);
});
