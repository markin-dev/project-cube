import { defineConfig } from 'vite';

// Сайт живёт не в корне домена, а по адресу /cube/ — пути к скриптам в index.html должны это учитывать.
export default defineConfig({
  base: '/cube/',
});
