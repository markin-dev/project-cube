import { defineConfig } from 'vitest/config';

// Конфигурация Vitest для юнит-тестов (npm run test:unit). Браузерные E2E — в vitest.browser.config.ts.
//
// Тесты лежат в unit/, вне src. Vitest транспилирует их сам, а типы проверяет tsc (npm run typecheck,
// tsconfig.json включает unit/ и browser/).
//
// Окружение happy-dom даёт localStorage и минимальный DOM — их читают config.ts (сохранённые изменения
// при загрузке), config-storage.ts и панель настроек. Физика — настоящий Rapier, он работает в Node.
export default defineConfig({
  test: {
    include: ['unit/**/*.test.ts'],
    environment: 'happy-dom',

    // Перед каждым тестом конфиг возвращается к значениям из кода (см. unit/setup.ts).
    setupFiles: ['unit/setup.ts'],

    // Покрытие юнитами: npm run test:coverage. Отчёт в терминале — по каждому файлу src/.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text'],
    },
  },
});
