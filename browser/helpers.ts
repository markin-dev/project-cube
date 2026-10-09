// Общие хелперы для browser-mode E2E-тестов (Фаза 2 миграции).
//
// Игровой цикл идёт в реальном времени (requestAnimationFrame), поэтому появление врагов, попаданий
// и цифр урона мы ждём опросом условия каждые 100 мс, а не фиксированной паузой.

// Тестовый доступ к состоянию игры (DEV-хук window.__game в main.ts): { enemies }.
export type Game = { enemies: Map<unknown, { hp: number }> };

export const game = (): Game | undefined => (window as typeof window & { __game?: Game }).__game;

// Ждёт, пока условие станет истинным. Бросает понятную ошибку, если не дождались.
export const waitUntil = async (
  predicate: () => boolean,
  timeoutMs = 15000,
  what = 'условие',
): Promise<void> => {
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`waitUntil: ${what} не наступило за ${timeoutMs} мс`);
};

// Сколько сейчас цифр урона на экране (всех или только критических).
export const damageNumbers = (onlyCrit = false): NodeListOf<Element> =>
  document.querySelectorAll(onlyCrit ? '.damage-number.is-crit' : '.damage-number');
