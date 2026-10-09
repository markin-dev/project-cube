// Проверка фикса А3: касательная (боковая) скорость врага больше не убивается мгновенно
// (раньше обе составляющие загонялись в «чистый радиальный ход» общим бюджетом ускорения —
// кольцо врагов не могло скользить друг мимо друга). Через DEV-хук window.__game читаем
// скорости тел напрямую.
//
// Метод: берём самого одинокого врага, задаём ему чисто касательную скорость 2 м/с и снимаем
// разложенную на радиальную/касательную составляющие в моменты ~100, ~300, ~600 мс.
// Не стреляем (FIRE_INTERVAL 999), враги живучие и медленные (ENEMY_SPEED 1) — есть запас
// до того, как враги доходят до игрока и игра замирает.
//
// Фазы: ползунок 0 → через 300 мс остаётся больше всего боковой скорости; 0.5 (дефолт) —
// меньше; 5 — почти нет. Радиальная составляющая во всех фазх сходится к ENEMY_SPEED (= 1) —
// стратегия «идти к центру» работает. Плюс ползунок: дефолт, клампинг, сохранение, перезагрузка.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/?wave=1';
const OUT = __dirname + '/screenshots';
  require('fs').mkdirSync(OUT, { recursive: true });
const SPEED = 2; // с какой боковой скоростью «толкаем» врага
const MARK = 'Гашение боковой скорости';

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

// Самый одинокий враг: у которого максимально минимальное расстояние до соседа. Ему и задаём
// чисто касательную скорость (перпендикуляр радиусу-в-центр), чтобы наблюдать только её затухание.
const forceTangential = (page, speed) =>
  page.evaluate((speed) => {
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

    const p = bestEnemy.body.translation();
    const d = Math.hypot(p.x, p.z);
    const radialX = -p.x / d;
    const radialZ = -p.z / d;
    const tangentialX = -radialZ;
    const tangentialZ = radialX;

    bestEnemy.body.setLinvel({ x: tangentialX * speed, y: 0, z: tangentialZ * speed }, true);
    window.__testHandle = bestHandle;

    return { distanceToNeighbors: bestDistance, position: { x: p.x, z: p.z } };
  }, speed);

const sample = (page) =>
  page.evaluate(() => {
    const enemy = window.__game.enemies.get(window.__testHandle);
    if (!enemy) return null;

    const p = enemy.body.translation();
    const v = enemy.body.linvel();
    const d = Math.hypot(p.x, p.z);
    const radialX = -p.x / d;
    const radialZ = -p.z / d;
    const tangentialX = -radialZ;
    const tangentialZ = radialX;

    return {
      radial: Number((v.x * radialX + v.z * radialZ).toFixed(3)),
      tangential: Number((v.x * tangentialX + v.z * tangentialZ).toFixed(3)),
      y: Number(p.y.toFixed(2)),
    };
  });

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9333');
  const context = browser.contexts()[0];
  for (const p of context.pages()) await p.close();

  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await setupHooks(page);
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:sound-sets');
    localStorage.removeItem('project-animal:config-changes');
    localStorage.setItem(
      'project-animal:config-changes',
      JSON.stringify({
        // Не стрелять во время замера (кроме единственного первого выстрела) и медленно идти:
        // у теста есть запас до того, как враги доходят до игрока и игра замирает.
        FIRE_INTERVAL: 999,
        ENEMY_SPEED: 1,
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
  await page.waitForFunction(() => window.__game && window.__game.enemies.size > 0, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  await openPanel(page);

  // ─── 1. Ползунок: дефолт и клампинг ───
  const defaultDamping = await readSlider(page, 'Враги', MARK);
  console.log('default slider:', defaultDamping, '(нужно 0.5)');
  if (Number(defaultDamping) !== 0.5) throw new Error('default ENEMY_TANGENTIAL_DAMPING mismatch');

  await setSlider(page, 'Враги', MARK, 99);
  const clampedHigh = await readSlider(page, 'Враги', MARK);
  await setSlider(page, 'Враги', MARK, -2);
  const clampedLow = await readSlider(page, 'Враги', MARK);
  console.log('clamp: 99 →', clampedHigh, '(нужно 5), -2 →', clampedLow, '(нужно 0)');
  if (Number(clampedHigh) !== 5 || Number(clampedLow) !== 0) throw new Error('slider clamp failed');

  // ─── 2. Фазы: как гаснет боковая скорость при разных значениях гашения ───
  const results = {};

  for (const damping of [0, 0.5, 5]) {
    await setSlider(page, 'Враги', MARK, damping);
    const forced = await forceTangential(page, SPEED);
    const series = [];

    for (const wait of [100, 200, 300]) {
      await page.waitForTimeout(wait);
      series.push(await sample(page));
    }

    results[damping] = series;
    console.log(`damping=${damping} (соседи в ${forced.distanceToNeighbors.toFixed(1)} м):`, JSON.stringify(series));
  }

  const tangential300 = (damping) => results[damping][1]?.tangential ?? -1;
  const radial600 = (damping) => results[damping][2]?.radial ?? -1;

  // Через ~300 мс от начальных 2 м/с: без гашения остаётся больше всего, со 5 — почти ничего,
  // дефолт 0.5 — между ними. Разброс между прогонами есть (трут соседи, тайминги кадров),
  // поэтому пороги с запасом к измеренным 0.62 / 0.46 / 0.07.
  console.log(
    'боковая через 300 мс: 0 →', tangential300(0), ', 0.5 →', tangential300(0.5), ', 5 →', tangential300(5),
  );
  if (tangential300(0) < 0.45) throw new Error(`damping=0: боковая через 300 мс = ${tangential300(0)}, ожидалось ≥0.45`);
  if (tangential300(0.5) < 0.15) throw new Error(`damping=0.5: боковая через 300 мс = ${tangential300(0.5)}, ожидалось ≥0.15`);
  if (tangential300(5) > 0.15) throw new Error(`damping=5: боковая через 300 мс = ${tangential300(5)}, ожидалось ≤0.15`);
  if (tangential300(0) - tangential300(5) < 0.3) throw new Error('разница затухания между 0 и 5 слишком мала');

  // Радиальный ход во всех фазах сходится к ENEMY_SPEED (в конфиге 1): стратегия «к центру» цела.
  for (const damping of [0, 0.5, 5]) {
    const radial = radial600(damping);
    console.log(`радиальная через 600 мс (damping=${damping}):`, radial, '(нужно ~1)');
    if (radial < 0.6 || radial > 1.4) throw new Error(`радиальная скорость ${radial} вне 0.6..1.4`);
  }

  // ─── 3. Сохранение и перезагрузка ───
  const saved = await page.evaluate(() => localStorage.getItem('project-animal:config-changes'));
  console.log('saved config:', saved);
  if (!saved.includes('"ENEMY_TANGENTIAL_DAMPING":5')) throw new Error('damping not saved to localStorage');

  await page.screenshot({
    path: `${OUT}/enemy-tangential-panel.png`,
    clip: { x: 874, y: 0, width: 366, height: 608 },
  });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await openPanel(page);
  const afterReload = await readSlider(page, 'Враги', MARK);
  console.log('после перезагрузки:', afterReload, '(нужно 5)');
  if (Number(afterReload) !== 5) throw new Error('damping not persisted');

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
