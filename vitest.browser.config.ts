import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Конфигурация Vitest Browser Mode + Playwright (npm run test:e2e): тесты из browser/ идут в настоящем
// chromium — там, где нужен реальный браузер: WebGL, Web Audio, DOM интерфейса, раскладка.
//
// Тест-файл исполняется прямо в тестовой странице, а игру заводим импортом точки входа
// (import '../src/main'): модуль с top-level await сам поднимает физику, сцену, интерфейс и цикл
// и выставляет window.__game (DEV-хук).
//
// headless: true — без окна. Флаги --enable-unsafe-swiftshader и --use-angle=swiftshader нужны, чтобы
// WebGL работал на программном рендерере (в headless нет GPU).
export default defineConfig({
  // Алиас @/ → src/ — из paths в tsconfig.json.
  resolve: { tsconfigPaths: true },

  test: {
    include: ['browser/**/*.test.ts'],

    // Перед каждым тестом localStorage очищается (см. browser/setup.ts).
    setupFiles: ['browser/setup.ts'],
    // Browser mode гоняет каждый файл в отдельной странице, но страниц у нас одна — файлы идут по очереди.
    fileParallelism: false,
    testTimeout: 30000,

    // Покрытие E2E: npm run test:coverage:e2e — показывает, что из интерфейса, звука и main.ts
    // проверено в браузере (юниты эти модули почти не трогают).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text'],
    },
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({
        launchOptions: {
          args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
        },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1024, height: 768 },
    },
  },
});
