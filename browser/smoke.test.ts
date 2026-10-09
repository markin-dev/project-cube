// Эталонный smoke-тест Фазы 2: проверяем, что игру можно завести ИМПОРТОМ точки входа внутри
// browser-mode теста и что игровой цикл (физика + рендер + волны) реально идёт в настоящем chromium.
//
// Это скелет E2E: если он зелёный — значит паттерн «импорт игры + чтение window.__game / DOM» работает,
// и остальные E2E (крит-цифры, звук) можно переносить тем же способом.
import { describe, expect, it } from 'vitest';
import '../src/main';

// Тестовый доступ к состоянию игры (см. DEV-хук в main.ts). window.__game = { enemies }.
const game = (): { enemies: Map<unknown, unknown> } | undefined =>
  (window as typeof window & { __game?: { enemies: Map<unknown, unknown> } }).__game;

// Ждём, пока условие станет истинным, опрашивая каждые 100 мс. Игровой цикл идёт в реальном времени
// (requestAnimationFrame), поэтому появления врагов ждём опросом, а не фиксированной паузой.
const waitUntil = async (predicate: () => boolean, timeoutMs = 15000, what = 'условие'): Promise<void> => {
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`waitUntil: ${what} не наступило за ${timeoutMs} мс`);
};

describe('игра в реальном браузере', () => {
  it('заводится: есть canvas, рендер и тестовый доступ __game', async () => {
    // main.ts — модуль с top-level await, статический импорт выше уже дождался его выполнения,
    // но подождём __game явно для ясности ошибки, если физика не поднялась.
    await waitUntil(() => game() !== undefined, 15000, 'game().__game');

    expect(game()).toBeTruthy();
    expect(document.querySelector('canvas')).toBeTruthy();
  });

  it('первая волна выпускает врагов на арену', async () => {
    await waitUntil(() => (game()?.enemies.size ?? 0) > 0, 15000, 'появление врагов');

    expect(game()!.enemies.size).toBeGreaterThan(0);
  });
});
