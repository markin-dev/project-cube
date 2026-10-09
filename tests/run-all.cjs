// Единый раннер E2E-тестов: гоняет их ПОСЛЕДОВАТЕЛЬНО, потому что все они подключаются к одному
// headless Chrome по CDP и перебивают страницы/общий localStorage друг друга. Параллельный запуск
// сломает любой из них.
//
// Перед прогоном проверяет, что подняты dev-сервер Vite и Chrome с CDP — иначе понятная ошибка,
// а не таймауты внутри playwright.
//
// Запуск (нужен запущенный окружение — см. tests/README.md):
//   node tests/run-all.cjs          — все тесты
//   node tests/run-all.cjs crit     — только те, чьё имя содержит подстроку «crit»
const { spawnSync } = require('child_process');
const http = require('http');

const DEV_SERVER = 'http://127.0.0.1:5173/cube/';
const CDP = 'http://localhost:9333/json/version';

// Порядок не важен для логики (каждый тест сам настраивает конфиг), но криты идут первым —
// это самый новый и быстрый тест.
const TESTS = [
  'crit-test.cjs',
  'damage-range-test.cjs',
  'projectile-count-test.cjs',
  'enemy-acceleration-test.cjs',
  'enemy-tangential-test.cjs',
  'enemy-support-test.cjs',
  'hit-sound-test.cjs',
  'shot-death-test.cjs',
  'wave-picker-test.cjs',
];

const checkReachable = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });

(async () => {
  const filter = process.argv[2];
  const selected = filter ? TESTS.filter((name) => name.includes(filter)) : TESTS;

  if (selected.length === 0) {
    console.error(`Нет тестов по фильтру «${filter}». Доступно: ${TESTS.join(', ')}`);
    process.exit(1);
  }

  const [devUp, cdpUp] = await Promise.all([checkReachable(DEV_SERVER), checkReachable(CDP)]);

  if (!devUp) {
    console.error(`Dev-сервер не отвечает на ${DEV_SERVER}. Запусти «npm run dev» и повтори.`);
    process.exit(1);
  }

  if (!cdpUp) {
    console.error(`CDP не отвечает на ${CDP}. Запусти headless Chrome с --remote-debugging-port=9333 и повтори.`);
    process.exit(1);
  }

  const failed = [];

  for (const name of selected) {
    console.log(`\n════════ ${name} ════════`);
    const result = spawnSync(process.execPath, [`${__dirname}/${name}`], { stdio: 'inherit' });

    if (result.status !== 0) {
      failed.push(name);
      console.log(`─────── ${name}: FAILED ───────`);
      break; // Дальше гонять бессмысленно: следующие упадут на том же разобранном состоянии.
    }
  }

  console.log('\n═══════════════════════════════');

  if (failed.length > 0) {
    console.error(`FAILED: ${failed.join(', ')}`);
    process.exit(1);
  }

  console.log(`ALL PASSED (${selected.length} тестов)`);
  process.exit(0);
})();
