// Проверка «честного ускорения врагов»: компенсация трения в moveEnemies.
//
// Раньше бюджет ускорения был ENEMY_ACCELERATION × delta, а трение пола каждый шаг снимало
// со скользящего врага до ENEMY_FRICTION × GRAVITY ≈ 5.9 м/с² — при ускорении ниже порога враг
// с места не сдвигался вообще (свежие дальние враги стояли намертво). С компенсацией ползунок
// означает чистый разгон: враг с места достигает ENEMY_SPEED за ENEMY_SPEED / ENEMY_ACCELERATION
// секунд на любом трении.
//
// Метод: через DEV-хук window.__game обнуляем скорость самого одинокого врага и смотрим
// радиальную скорость через заданное время. Конфиг: ENEMY_SPEED 1 (цель разгона), враги
// живучие, FIRE_INTERVAL 999 — игра не стреляет, звук не разблокируется.
//
// Фазы:
//   дефолт ползунка — 5 (чуть ниже прежнего 8: компенсация ускорила разгон, дефолт сбавили);
//   трение 0.6, ускорение 3 (ниже старого порога 5.9): с места доходит до ~1 за 1 с — раньше
//     было бы 0 (главное утверждение фикса);
//   трение 0.6, ускорение 8: через 150 мс уже ~1 — разгон честный; раньше за 150 мс было бы ~0.3;
//   трение 0.1 (перезагрузка), ускорение 3: контроль — при слабом трении и раньше работало.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/?wave=1';
const MARK = 'Ускорение';

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

// Обнуляем скорость самого одинокого врага — встали с места, как свежее появление.
const stopEnemy = (page) =>
  page.evaluate(() => {
    const entries = [...window.__game.enemies.entries()];
    let bestHandle = null;
    let bestEnemy = null;
    let bestDistance = -1;

    for (const [handle, enemy] of entries) {
      const p = enemy.body.translation();
      let minDistance = Infinity;

      for (const [otherHandle, other] of entries) {
        if (otherHandle === handle) continue;
        const q = other.body.translation();
        minDistance = Math.min(minDistance, Math.hypot(p.x - q.x, p.z - q.z));
      }

      if (minDistance > bestDistance) {
        bestDistance = minDistance;
        bestHandle = handle;
        bestEnemy = enemy;
      }
    }

    bestEnemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    window.__testHandle = bestHandle;

    return bestDistance;
  });

const radialSpeed = (page) =>
  page.evaluate(() => {
    const enemy = window.__game.enemies.get(window.__testHandle);
    if (!enemy) return null;

    const p = enemy.body.translation();
    const v = enemy.body.linvel();
    const d = Math.hypot(p.x, p.z);

    return Number(((v.x * -p.x + v.z * -p.z) / d).toFixed(3));
  });

// Одна фаза: обнуляем врага, ждём и снимаем радиальную скорость разгона.
const measureRamp = async (page, { label, acceleration, wait }) => {
  await setSlider(page, 'Враги', MARK, acceleration);
  const distance = await stopEnemy(page);
  await page.waitForTimeout(wait);
  const radial = await radialSpeed(page);
  console.log(`${label}: radial через ${wait} мс = ${radial} (сосед в ${distance.toFixed(1)} м)`);
  return radial;
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

  // Без звука: FIRE_INTERVAL 999 — игра не стреляет, аудио-контекст не разблокируется.
  const writeConfig = (friction) =>
    page.evaluate((friction) => {
      localStorage.removeItem('project-animal:muted');
      localStorage.removeItem('project-animal:sound-sets');
      localStorage.setItem(
        'project-animal:config-changes',
        JSON.stringify({
          FIRE_INTERVAL: 999,
          ENEMY_SPEED: 1,
          ENEMY_COUNT_MULTIPLIER: 1,
          ENEMY_FRICTION: friction,
          ENEMY_KINDS: {
            tiny: { hp: 1000 },
            small: { hp: 1000 },
            normal: { hp: 1000 },
            big: { hp: 1000 },
            brute: { hp: 1000 },
          },
        }),
      );
    }, friction);

  await page.goto(URL, { waitUntil: 'load' });
  await writeConfig(0.6);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.enemies.size > 0, null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  await openPanel(page);

  // ─── 1. Дефолт ползунка ───
  const defaultAccel = await readSlider(page, 'Враги', MARK);
  console.log('default slider:', defaultAccel, '(нужно 5)');
  if (Number(defaultAccel) !== 5) throw new Error('default ENEMY_ACCELERATION mismatch');

  // ─── 2. Ускорение ниже старого порога трения: с места доходит до цели ───
  const slow = await measureRamp(page, { label: 'трение 0.6, ускорение 3', acceleration: 3, wait: 1000 });
  if (slow < 0.7) throw new Error(`ускорение 3 при трении 0.6: radial = ${slow}, ожидалось ≥0.7 (раньше было ~0)`);

  // ─── 3. Ускорение 8: честный разгон — за 150 мс уже почти цель ───
  const fast = await measureRamp(page, { label: 'трение 0.6, ускорение 8', acceleration: 8, wait: 150 });
  if (fast < 0.7) throw new Error(`ускорение 8 через 150 мс: radial = ${fast}, ожидалось ≥0.7 (без компенсации было бы ~0.3)`);

  // ─── 4. Контроль: слабое трение — и раньше работало ───
  await writeConfig(0.1);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.enemies.size > 0, null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  await openPanel(page);

  const lightFriction = await measureRamp(page, { label: 'трение 0.1, ускорение 3', acceleration: 3, wait: 1000 });
  if (lightFriction < 0.7) throw new Error(`трение 0.1: radial = ${lightFriction}, ожидалось ≥0.7`);

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
