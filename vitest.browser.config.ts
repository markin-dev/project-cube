import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Конфигурация Vitest Browser Mode + Playwright (Фаза 2 миграции E2E).
//
// В отличие от юнит-тестов (vitest.config.ts, окружение node), здесь тесты идут в НАСТОЯЩЕМ chromium,
// который Playwright запускает. Это нужно для E2E, которые без браузера проверить нельзя: реальный
// WebGL (рендер сцены, крит-цифры, искры) и Web Audio (автоматизация гейнов звука).
//
// МОДЕЛЬ ОТЛИЧАЕТСЯ от старых CDP-скриптов: vitest не «открывает URL приложения и гоняет его как бот».
// Вместо этого тест-файл исполняется прямо в тестовой странице браузера, а игру мы ЗАВОДИМ ИМПОРТОМ
// её точки входа (import '../src/main'). main.ts — модуль с top-level await: он создаёт физику, сцену,
// расставляет UI и запускает игровой цикл в текущей странице, выставляя window.__game (DEV-хук).
//
// headless: true — без окна. Флаги --enable-unsafe-swiftshader и --use-angle=swiftshader нужны, чтобы
// WebGL работал на программном рендерере (в headless нет GPU).
export default defineConfig({
  test: {
    include: ['browser/**/*.test.ts'],
    // Browser mode гоняет каждый файл в отдельной странице, но страниц у нас одна — файлы идут по очереди.
    fileParallelism: false,
    testTimeout: 30000,
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
