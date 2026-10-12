import { defineConfig } from 'vite';

// Сайт живёт не в корне домена, а по адресу /cube/ — пути к скриптам в index.html должны это учитывать.
export default defineConfig({
  base: '/cube/',
  build: {
    rolldownOptions: {
      output: {
        // Библиотеки — отдельными файлами: их имя (хеш) меняется только при обновлении версии,
        // поэтому после деплоя браузер перекачивает лишь код игры (~45 КБ), а не 4.9 МБ целиком.
        // Группы с равным приоритетом проверяются по порядку: сначала Rapier и Three, остальное — vendor.
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge[\\/]/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },

    // Rapier сам по себе ~4.3 МБ (WASM встроен в JS как base64) — предупреждение о размере только о нём.
    chunkSizeWarningLimit: 4500,
  },
});
