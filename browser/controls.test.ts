// E2E управления игрой из main.ts: пауза переключателем скорости, рестарт кликом после поражения,
// запуск волны из панели настроек. Каждый тест сам включает нужную скорость в начале.
import { expect, it } from 'vitest';
import '@/main';
import { getButton, getEnemiesCount, getGame, sleep, waitUntil } from './helpers';

const LOSE_HINT = 'Нажми, чтобы начать заново';

// Позиции живых врагов — снимок, чтобы сравнить «до» и «после».
const getEnemyPositions = (): number[][] =>
  [...(getGame()?.enemies.values() ?? [])].map(({ body }) => {
    const { x, y, z } = body.translation();

    return [x, y, z];
  });

const isLoseScreenShown = (): boolean => document.body.innerText.includes(LOSE_HINT);

// Селект «Волна» раздела «Волны (отладка)» — тот, у которого есть поздняя волна «50». Ищем по варианту,
// а не по порядку: выше него в панели стоит селект пресетов.
const getWaveSelect = (): HTMLSelectElement => {
  const select = [...document.querySelectorAll('.lil-gui select')].find((element): boolean =>
    [...element.querySelectorAll('option')].some((option) => option.textContent === '50'),
  );

  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('селект «Волна» не найден');
  }

  return select;
};

it('Должен остановить игру кнопкой паузы', async () => {
  getButton('×1')?.click();
  await waitUntil({ isDone: () => getEnemiesCount() > 0, timeoutMs: 15000, what: 'появление врагов' });
  getButton('⏸')?.click();

  const paused = getEnemyPositions();

  await sleep(500);

  expect(getEnemyPositions()).toEqual(paused);
});

it('Должен начать игру заново по клику после поражения', async () => {
  getButton('×1')?.click();
  await waitUntil({ isDone: () => getEnemiesCount() > 0, timeoutMs: 15000, what: 'появление врагов' });

  // Враг вплотную к кубу игрока — поражение на ближайшем шаге.
  for (const { body } of getGame()?.enemies.values() ?? []) {
    body.setTranslation({ x: 0.8, y: 0.4, z: 0 }, true);
  }

  await waitUntil({ isDone: isLoseScreenShown, timeoutMs: 5000, what: 'экран поражения' });
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await waitUntil({ isDone: () => !isLoseScreenShown(), timeoutMs: 5000, what: 'новая игра' });

  expect(isLoseScreenShown()).toBe(false);
});

it('Должен запустить волну, выбранную в панели', async () => {
  const select = getWaveSelect();

  getButton('×1')?.click();
  select.selectedIndex = 4;
  select.dispatchEvent(new Event('change'));

  await expect.poll(() => document.body.innerText, { timeout: 5000 }).toContain('Волна 5');
});
