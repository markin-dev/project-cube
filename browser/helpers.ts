// Общие хелперы для browser-mode E2E-тестов. Игровой цикл идёт в реальном времени
// (requestAnimationFrame), поэтому события игры ждём опросом условия каждые 100 мс.
import type { Enemies } from '@/enemies';

// Тестовый доступ к игре — DEV-хук window.__game в main.ts.
export type GameAccess = { enemies: Enemies };

const isGameHolder = (value: object): value is { __game: GameAccess } => '__game' in value;

export const getGame = (): GameAccess | undefined => (isGameHolder(window) ? window.__game : undefined);

export const getEnemiesCount = (): number => getGame()?.enemies.size ?? 0;

// Ждёт, пока условие isDone станет истинным. Бросает понятную ошибку (what), если не дождались.
export const waitUntil = async ({
  isDone,
  timeoutMs = 15000,
  what = 'условие',
}: {
  isDone: () => boolean;
  timeoutMs?: number;
  what?: string;
}): Promise<void> => {
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    if (isDone()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`waitUntil: ${what} не наступило за ${timeoutMs} мс`);
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Цифры урона на экране (все или только критические).
export const getDamageNumbers = (isOnlyCrit: boolean = false): NodeListOf<Element> =>
  document.querySelectorAll(isOnlyCrit ? '.damage-number.is-crit' : '.damage-number');

// Кнопка с текстом text (переключатель скорости, звук).
export const getButton = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((button) => button.textContent === text);

// Селект «Что показывать» раздела «Сцена» — тот, у которого есть вариант «Демо (модельки)». Ищем
// по тексту варианта — так тесты не зависят от порядка разделов в панели.
export const getSceneSelect = (): HTMLSelectElement => {
  const select = [...document.querySelectorAll('.lil-gui select')].find((element): boolean =>
    element.textContent?.includes('Демо (модельки)') ?? false,
  );

  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('селект «Сцена» не найден');
  }

  return select;
};

// Выбирает режим сцены по индексу варианта: 0 — игра, 1 — демо, 2 — полигон (см. SCENE_MODE_OPTIONS).
// Панель применяет выбор сразу — так же, как при клике пользователя.
export const setSceneMode = (index: number): void => {
  const select = getSceneSelect();

  select.selectedIndex = index;
  select.dispatchEvent(new Event('change'));
};
