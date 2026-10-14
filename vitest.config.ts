import { defineConfig } from 'vitest/config';

// Конфигурация Vitest для юнит-тестов (Фаза 1 миграции на vitest).
//
// Тесты лежат в unit/ — вне src, чтобы сборочный `tsc` (include: ["src"]) их не компилировал:
// Vitest транспилирует TS сам, через esbuild, tsc для тестов не нужен.
//
// Окружение happy-dom даёт localStorage и минимальный DOM — они нужны config.ts (читает сохранённые
// изменения при загрузке) и config-storage.ts (работает с localStorage). Остальные тестируемые функции
// чистые и в DOM не нуждаются, но общее окружение упрощает жизнь.
//
// E2E в реальном браузере (vitest browser mode + Playwright) — отдельная Фаза 2, конфиг для неё
// будет в vitest.browser.config.ts, чтобы юниты и браузерные тесты не мешали друг другу.
export default defineConfig({
  test: {
    include: ['unit/**/*.test.ts'],
    environment: 'happy-dom',

    // Перед каждым тестом конфиг возвращается к значениям из кода (см. unit/setup.ts).
    setupFiles: ['unit/setup.ts'],
  },
});
