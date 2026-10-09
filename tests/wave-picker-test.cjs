// Проверка ручного выбора волны в панели настроек.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/';
const OUT = __dirname + '/screenshots';
  require('fs').mkdirSync(OUT, { recursive: true });

const getHud = (page) =>
  page.evaluate(() => {
    const leaf = (re) =>
      [...document.querySelectorAll('div')].find((d) => re.test(d.textContent.trim()) && d.children.length === 0);
    const wave = leaf(/^Волна \d+ \/ \d+$/);
    const group = leaf(/^Группа \d+ \/ \d+$/);

    return {
      wave: wave ? wave.textContent.trim() : null,
      group: group ? group.textContent.trim() : null,
      name: wave ? wave.parentElement.children[2].textContent.trim() : null,
    };
  });

const pickWave = (page, index) =>
  page.evaluate((i) => {
    const select = document.querySelector('.lil-gui select');
    select.selectedIndex = i;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9333');
  const context = browser.contexts()[0];

  // Старые вкладки из прошлых прогонов мешают проверкам (память проекта) — закрываем все.
  for (const p of context.pages()) await p.close();

  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL, { waitUntil: 'load' });

  // Изоляция: подчищаем localStorage прошлых прогонов. Иначе если предыдущий тест оставил
  // config-changes, заголовок панели становится «Настройки · изменено: N» — и точный селектор
  // «Настройки» ниже не находит шапку. Кстати, это же проверка, что выбор волны НЕ пишется
  // в config-changes (storageBefore/After должны быть пустыми).
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:config-changes');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const log = (label, hud) => console.log(label, JSON.stringify(hud));

  log('start:', await getHud(page));
  const storageBefore = await page.evaluate(() => localStorage.getItem('project-animal:config-changes'));

  // Даём волне 1 выйти на арену — чтобы проверить очистку при переключении.
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/wp-1-wave1-enemies.png` });

  // Открываем панель и раздел «Волны (отладка)».
  await page.getByText('Настройки', { exact: true }).click();
  await page.getByText('Волны (отладка)', { exact: true }).click();
  await page.waitForTimeout(300);

  const options = await page.$$eval('.lil-gui select option', (els) => els.map((e) => e.textContent));
  const selects = await page.$$eval('.lil-gui select', (els) => els.length);
  console.log('selects in panel:', selects);
  console.log('options:', JSON.stringify(options));
  await page.screenshot({ path: `${OUT}/wp-2-panel-open.png` });

  // Выбираем волну 5 — должна запуститься сразу, арена очиститься.
  await pickWave(page, 4);
  await page.waitForTimeout(500);
  log('after pick wave 5:', await getHud(page));
  await page.screenshot({ path: `${OUT}/wp-3-after-pick-5.png` });
  await page.waitForTimeout(3000);
  log('wave 5 after 3s:', await getHud(page));
  await page.screenshot({ path: `${OUT}/wp-4-wave5-running.png` });

  // Ждём, пока начнётся вторая группа (delay 5 с), и перезапускаем волну кнопкой.
  await page.waitForTimeout(3500);
  log('before restart:', await getHud(page));
  await page.getByText('Перезапустить волну', { exact: true }).click();
  await page.waitForTimeout(400);
  log('after restart:', await getHud(page));
  await page.screenshot({ path: `${OUT}/wp-5-after-restart.png` });

  // Возвращаемся на волну 1 и проверяем, что обычное продвижение по волнам работает.
  await pickWave(page, 0);
  await page.waitForTimeout(500);
  log('after pick wave 1:', await getHud(page));

  let advanced = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    const hud = await getHud(page);
    if (hud.wave !== 'Волна 1 / 10') {
      advanced = { afterSeconds: i + 1, hud };
      break;
    }
  }
  console.log('auto-advance:', JSON.stringify(advanced));
  await page.screenshot({ path: `${OUT}/wp-6-advanced.png` });

  const storageAfter = await page.evaluate(() => localStorage.getItem('project-animal:config-changes'));
  console.log('config-changes before:', JSON.stringify(storageBefore), 'after:', JSON.stringify(storageAfter));
  console.log('console errors:', JSON.stringify(errors));

  // Вкладку оставляем открытой (закроем на следующем прогоне) — браузер держим для повторных проверок.
  await page.close();
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
