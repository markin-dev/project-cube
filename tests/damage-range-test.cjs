// Проверка случайного урона: PROJECTILE_DAMAGE_MIN…PROJECTILE_DAMAGE_MAX вместо статического
// PROJECTILE_DAMAGE. Урон бросается на каждый снаряд при выстреле, попадание показывает своё число.
//
// Метод: наблюдатель за DOM собирает ТЕКСТЫ цифр урона (элемент получает текст до добавления
// в слой — см. damage-numbers.ts). Враги с HP 1000 не умирают — каждое попадание даёт цифру,
// и по числам виден диапазон.
//
// Фазы:
//   A. дефолты: ползунки 10 / 20, все цифры из [10, 20], целые, ≥5 разных (рандом работает);
//   B. min = max = 30: все цифры ровно 30 (равные значения — без рандома);
//   C. min = 50, max = 10 (границы перепутаны): цифры из [10, 50] — диапазон упорядочивается;
//   плюс сохранение пары в localStorage и переживание перезагрузки.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/?wave=1';
const OUT = __dirname + '/screenshots';
  require('fs').mkdirSync(OUT, { recursive: true });
const WINDOW = 30; // сколько цифр урона ждём в каждой фазе

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

const readSlider = async (page, folderTitle, controllerName) =>
  page.evaluate(
    ({ folderTitle, controllerName }) => {
      const folderEl = window.__folderByTitle(folderTitle);
      const controller = folderEl && window.__controllerByName(folderEl, controllerName);
      if (!controller) return null;
      const input = controller.querySelector('input');
      return input ? input.value : null;
    },
    { folderTitle, controllerName },
  );

// Наблюдатель за цифрами урона: текст добавленного элемента, если это число.
const installDamageObserver = (page) =>
  page.evaluate(() => {
    window.__damageValues = [];
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          const text = node.textContent?.trim() ?? '';
          const value = Number(text);
          if (text !== '' && Number.isFinite(value)) window.__damageValues.push(value);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    return 'ok';
  });

// Одна фаза: сброс счётчика → ждём WINDOW цифр → проверка предикатом по всем числам.
// minDistinct — сколько разных значений ожидаем: для честного диапазона ≥5 (иначе «рандом»
// мог бы прилипать к одному числу), для min = max достаточно одного.
const runPhase = async (page, { label, predicate, hint, minDistinct = 5 }) => {
  // Снаряды, выпущенные до смены настроек, ещё летят (~0.7 с) и попадают со старым уроном —
  // даём им долететь, и только потом открываем окно измерения.
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__damageValues = [];
  });

  await page.waitForFunction(
    (target) => window.__damageValues.length >= target,
    WINDOW,
    { timeout: 60000 },
  );

  const values = await page.evaluate(() => [...window.__damageValues]);
  const distinct = new Set(values).size;
  const ok = values.every(predicate);
  const sample = [...new Set(values)].sort((a, b) => a - b);

  console.log(
    `${label}: ${values.length} цифр, разных ${distinct} (нужно ≥${minDistinct}), значения ${JSON.stringify(sample.slice(0, 15))}${sample.length > 15 ? '…' : ''}`,
  );

  if (!ok) throw new Error(`${label}: есть цифры вне условия (${hint}): ${JSON.stringify(sample)}`);
  if (distinct < minDistinct) throw new Error(`${label}: разных значений ${distinct}, ожидалось ≥${minDistinct}`);
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

  // ─── 1. Дефолтные ползунки ───
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:sound-sets');
    localStorage.removeItem('project-animal:config-changes');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  await openPanel(page);
  const minDefault = await readSlider(page, 'Игрок и стрельба', 'Урон, мин');
  const maxDefault = await readSlider(page, 'Игрок и стрельба', 'Урон, макс');
  console.log('default sliders: min =', minDefault, '(нужно 10), max =', maxDefault, '(нужно 20)');
  if (Number(minDefault) !== 10 || Number(maxDefault) !== 20) throw new Error('default damage sliders mismatch');

  // ─── 2. Настройки: враги живучие (HP 1000), медленные — цифры идут, никто не умирает ───
  await page.evaluate(() => {
    localStorage.setItem(
      'project-animal:config-changes',
      JSON.stringify({
        ENEMY_SPEED: 0.5,
        // Криты выключаем: этот тест меряет базовый рандомный урон [MIN, MAX], а крит
        // (шанс 15% по умолчанию) удвоил бы часть попаданий и «засорил» диапазон.
        CRIT_CHANCE: 0,
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

  // Звук не разблокируем — тесту он не нужен (считаются DOM-цифры урона), а пользователь рядом.
  await installDamageObserver(page);
  await openPanel(page);

  // ─── 3. Фаза A: дефолтный диапазон [10, 20] ───
  const minA = await readSlider(page, 'Игрок и стрельба', 'Урон, мин');
  const maxA = await readSlider(page, 'Игрок и стрельба', 'Урон, макс');
  if (Number(minA) !== 10 || Number(maxA) !== 20) throw new Error(`sliders after reload: ${minA}..${maxA}`);
  await runPhase(page, {
    label: 'дефолт 10..20',
    predicate: (value) => Number.isInteger(value) && value >= 10 && value <= 20,
    hint: 'целое в [10, 20]',
  });

  // ─── 4. Фаза B: min = max = 30 — без рандома ───
  await setSlider(page, 'Игрок и стрельба', 'Урон, мин', 30);
  await setSlider(page, 'Игрок и стрельба', 'Урон, макс', 30);
  await runPhase(page, {
    label: 'min = max = 30',
    predicate: (value) => value === 30,
    hint: 'ровно 30',
    minDistinct: 1,
  });

  // ─── 5. Фаза C: границы перепутаны (50 и 10) — диапазон упорядочивается ───
  await setSlider(page, 'Игрок и стрельба', 'Урон, мин', 50);
  await setSlider(page, 'Игрок и стрельба', 'Урон, макс', 10);
  await runPhase(page, {
    label: 'min = 50, max = 10 (перепутаны)',
    predicate: (value) => value >= 10 && value <= 50,
    hint: 'целое в [10, 50]',
  });

  // ─── 6. Сохранение и перезагрузка ───
  const saved = await page.evaluate(() => localStorage.getItem('project-animal:config-changes'));
  console.log('saved config:', saved);
  if (!saved.includes('"PROJECTILE_DAMAGE_MIN":50') || !saved.includes('"PROJECTILE_DAMAGE_MAX":10')) {
    throw new Error('damage range not saved');
  }

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await openPanel(page);
  const minAfter = await readSlider(page, 'Игрок и стрельба', 'Урон, мин');
  const maxAfter = await readSlider(page, 'Игрок и стрельба', 'Урон, макс');
  console.log('after reload: min =', minAfter, '(нужно 50), max =', maxAfter, '(нужно 10)');
  if (Number(minAfter) !== 50 || Number(maxAfter) !== 10) throw new Error('range not persisted');

  await page.screenshot({
    path: `${OUT}/damage-range-panel.png`,
    clip: { x: 874, y: 0, width: 366, height: 608 },
  });
  console.log('console errors:', JSON.stringify(errors));

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
