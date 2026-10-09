// Проверка критических попаданий: CRIT_CHANCE / CRIT_MULTIPLIER и крит-вигил (цвет + кегль цифры).
//
// Крит бросается при выстреле (rollCrit) и запоминается в снаряде; урон крита = round(урон × CRIT_MULTIPLIER).
// Тест смотрит на DOM-цифры урона: наблюдатель собирает ТЕКСТ, ЦВЕТ и КЕГЛЬ каждого числа
// (элемент получает текст и style до добавления в слой — см. damage-numbers.ts). Крит-число
// отличается цветом (#ff5533 → rgb(255, 85, 51)) и кеглем (18 × 1.5 = 27px против 18px).
// Враги HP 1000 не умирают, FIRE_INTERVAL не трогаем — попадания идут ровным потоком, звук не разблокируем.
//
// Фазы (урон min = max = 10, чтобы крит был ровно 20):
//   A. CRIT_CHANCE = 1: все цифры — крит (20, 27px, алый);
//   B. CRIT_CHANCE = 0: ни одного крита (10, 18px, белый);
//   C. CRIT_CHANCE = 0.5: доля критов около половины (проверка случайности броска).
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/?wave=1';
const OUT = __dirname + '/screenshots';
  require('fs').mkdirSync(OUT, { recursive: true });

// Крит-число узнаём по кеглю: дефолтный DAMAGE_NUMBER_FONT_SIZE = 18, крит × 1.5 = 27.
const BASE_FONT = 18;
const CRIT_FONT = 27;

const setupHooks = (page) =>
  page.addInitScript(() => {
    window.__folderByTitle = (title) => {
      const button = [...document.querySelectorAll('button.lil-title')].find((b) => b.textContent.trim() === title);
      return button ? button.closest('div.lil-gui') : null;
    };

    window.__controllerByName = (folderEl, name) =>
      [...folderEl.querySelectorAll('.lil-controller')].find(
        (c) => c.closest('div.lil-gui') === folderEl && c.querySelector('.lil-name')?.textContent.trim().startsWith(name),
      );
  });

const openPanel = async (page) => {
  await page.locator('.lil-gui > .lil-title').first().click();
  await page.waitForTimeout(300);
};

const setSlider = async (page, folderTitle, controllerName, value) => {
  const result = await page.evaluate(
    ({ folderTitle, controllerName, value }) => {
      const folderEl = window.__folderByTitle(folderTitle);
      if (!folderEl) return 'no folder';
      const controller = window.__controllerByName(folderEl, controllerName);
      if (!controller) return 'no controller';
      const input = controller.querySelector('input');
      if (!input) return 'no input';
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    },
    { folderTitle, controllerName, value },
  );
  if (result !== 'ok') throw new Error(`slider «${folderTitle}/«${controllerName}»: ${result}`);
  await page.waitForTimeout(250);
};

// Наблюдатель за цифрами урона: текст, кегль и цвет каждого добавленного элемента.
const installDamageObserver = (page) =>
  page.evaluate(() => {
    window.__damageNumbers = [];
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          const text = node.textContent?.trim() ?? '';
          const value = Number(text);
          if (text === '' || !Number.isFinite(value)) continue;
          window.__damageNumbers.push({
            value,
            fontSize: parseFloat(node.style.fontSize),
            color: node.style.color,
          });
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    return 'ok';
  });

// Одна фаза: ждём, пока долетят снаряды со старым критом (~1 с), сбрасываем счётчик, собираем
// target цифр и проверяем предикатом по каждому { value, fontSize, color }.
const collectNumbers = async (page, target) => {
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__damageNumbers = [];
  });
  await page.waitForFunction((n) => window.__damageNumbers.length >= n, target, { timeout: 60000 });
  return page.evaluate(() => [...window.__damageNumbers]);
};

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9333');
  const context = browser.contexts()[0];
  for (const p of context.pages()) await p.close();

  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await setupHooks(page);

  // Настройки: враги живучие и медленные (цифры идут, никто не умирает), урон min = max = 10 —
  // чтобы крит был ровно 20 и границы были чёткими. Звук глушим до старта.
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:sound-sets');
    localStorage.setItem(
      'project-animal:config-changes',
      JSON.stringify({
        ENEMY_SPEED: 0.5,
        PROJECTILE_DAMAGE_MIN: 10,
        PROJECTILE_DAMAGE_MAX: 10,
        ENEMY_KINDS: {
          tiny: { hp: 1000 },
          small: { hp: 1000 },
          normal: { hp: 1000 },
          big: { hp: 1000 },
          brute: { hp: 1000 },
        },
      }),
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  // Звук не разблокируем — тест считает DOM-цифры, а пользователь рядом.
  await installDamageObserver(page);
  await openPanel(page);

  // ─── Фаза A: CRIT_CHANCE = 1 — все попадания криты ───
  await setSlider(page, 'Криты', 'Шанс крита', 1);
  const a = await collectNumbers(page, 30);
  const aCrits = a.filter((n) => n.fontSize === CRIT_FONT);
  const aAllCrit20 = a.every((n) => n.value === 20 && n.fontSize === CRIT_FONT);
  console.log(`A: шанс 1 — ${a.length} цифр, из них критов ${aCrits.length}, значения ${JSON.stringify([...new Set(a.map((n) => n.value))])}`);
  if (!aAllCrit20) throw new Error(`A: ожидались только криты со значением 20 и кеглем ${CRIT_FONT}px`);

  // ─── Фаза B: CRIT_CHANCE = 0 — ни одного крита ───
  await setSlider(page, 'Криты', 'Шанс крита', 0);
  const b = await collectNumbers(page, 30);
  const bCrits = b.filter((n) => n.fontSize === CRIT_FONT);
  const bAllNormal = b.every((n) => n.value === 10 && n.fontSize === BASE_FONT);
  console.log(`B: шанс 0 — ${b.length} цифр, из них критов ${bCrits.length}, значения ${JSON.stringify([...new Set(b.map((n) => n.value))])}`);
  if (!bAllNormal) throw new Error(`B: ожидались только обычные цифры со значением 10 и кеглем ${BASE_FONT}px`);

  // ─── Фаза C: CRIT_CHANCE = 0.5 — доля критов около половины (случайный бросок) ───
  await setSlider(page, 'Криты', 'Шанс крита', 0.5);
  const c = await collectNumbers(page, 80);
  const cCrits = c.filter((n) => n.fontSize === CRIT_FONT).length;
  const cFraction = cCrits / c.length;
  const cValuesOk = c.every((n) => n.value === 10 || n.value === 20);
  console.log(`C: шанс 0.5 — ${c.length} цифр, критов ${cCrits} (${(cFraction * 100).toFixed(0)}%)`);
  if (!cValuesOk) throw new Error('C: значения вне {10, 20}');
  if (cFraction < 0.2 || cFraction > 0.8) throw new Error(`C: доля критов ${(cFraction * 100).toFixed(0)}%, ожидалось 20…80%`);

  await page.screenshot({ path: `${OUT}/crit-panel.png`, clip: { x: 874, y: 0, width: 366, height: 608 } });

  console.log('console errors:', JSON.stringify(errors));
  if (errors.some((e) => !e.includes('404'))) throw new Error('unexpected console errors');

  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:sound-sets');
    localStorage.removeItem('project-animal:config-changes');
  });
  await page.close();
  console.log('ALL PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
