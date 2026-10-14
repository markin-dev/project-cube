// Общие хелперы для browser-mode E2E-тестов. Игровой цикл идёт в реальном времени
// (requestAnimationFrame), поэтому события игры ждём опросом условия каждые 100 мс.
import type { Enemies } from '../src/enemies';

// Тестовый доступ к игре — DEV-хук window.__game в main.ts.
export type GameAccess = { enemies: Enemies };

const isGameHolder = (value: object): value is { __game: GameAccess } => '__game' in value;

export const getGame = (): GameAccess | undefined => (isGameHolder(window) ? window.__game : undefined);

export const getEnemiesCount = (): number => getGame()?.enemies.size ?? 0;

// Ждёт, пока условие станет истинным. Бросает понятную ошибку, если не дождались.
export const waitUntil = async (predicate: () => boolean, timeoutMs = 15000, what = 'условие'): Promise<void> => {
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`waitUntil: ${what} не наступило за ${timeoutMs} мс`);
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Цифры урона на экране (все или только критические).
export const getDamageNumbers = (isOnlyCrit = false): NodeListOf<Element> =>
  document.querySelectorAll(isOnlyCrit ? '.damage-number.is-crit' : '.damage-number');

// Кнопка с текстом text (переключатель скорости, звук).
export const getButton = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((button) => button.textContent === text);
