// Проверка фикса А2 «опора вместо пола»: враг, стоящий на вершине кучи (на крыше другого
// врага, а не на полу), управляется и ползёт к центру — вместо того чтобы лежать статуей.
// Раньше управление требовало касания пола, и куча сверху вниз заменяла собой неподвижные фигуры.
//
// Метод: через DEV-хук window.__game берём двух далёких друг от друга врагов и телепортируем
// одного на вершину другого (без просачивания: ставим точно на крышу). Дальше:
//   фаза «куча» — оба стоят друг на друге: обе радиальные скорости сходятся к ENEMY_SPEED
//     (верхний управляется, хотя пола не касается); верхний не проваливается и не сброшен;
//   фаза «воздух» — верхнего телепортируем в воздух: управление НЕ включается (нет ни пола,
//     ни опоры) — старое поведение «в воздухе враг не управляется» сохранено.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/?wave=1';
const SPEED = 1; // ENEMY_SPEED из конфига теста — к нему сходятся радиальные скорости

// Берём двух самых далёких друг от друга врагов — они гарантированно не мешают друг другу
// и остальными врагами не задеты. Запоминаем их handle-ы, ставим A на пол, B — точно на крышу A.
const stackEnemies = (page) =>
  page.evaluate(() => {
    const entries = [...window.__game.enemies.entries()];
    let bestPair = null;
    let bestDistance = -1;

    for (let first = 0; first < entries.length; first++) {
      for (let second = first + 1; second < entries.length; second++) {
        const p = entries[first][1].body.translation();
        const q = entries[second][1].body.translation();
        const distance = Math.hypot(p.x - q.x, p.z - q.z);

        if (distance > bestDistance) {
          bestDistance = distance;
          bestPair = [entries[first], entries[second]];
        }
      }
    }

    // На дно стопки — более крупный (и тяжёлый) враг: тяжёлый низ удерживает лёгкий верх устойчиво.
    // Без этого тест ловил недетерминированность: тяжёлый высокий враг на лёгком маленьком — неустойчивая
    // пара, верх шатает низ, и тот не сходится к ENEMY_SPEED (радиальная скорость падала до ~0.4).
    const pair = [...bestPair].sort(([, a], [, b]) => b.kind.size - a.kind.size);
    const [[handleA, enemyA], [handleB, enemyB]] = pair;
    const sizeA = enemyA.kind.size;
    const sizeB = enemyB.kind.size;
    const p = enemyA.body.translation();

    // A — на полу (центр на половине роста), B — точно на крыше A (центр на росте A + половине B).
    enemyA.body.setTranslation({ x: p.x, y: sizeA / 2, z: p.z }, true);
    enemyA.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    enemyB.body.setTranslation({ x: p.x, y: sizeA + sizeB / 2, z: p.z }, true);
    enemyB.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    window.__stack = { handleA, handleB, sizeA, sizeB, x: p.x, z: p.z };

    return { sizeA, sizeB, distance: bestDistance };
  });

// Телепорт верхнего врага в воздух (выше всех, кто мог бы под ним оказаться, ниже потолка смерти).
const liftEnemy = (page, height) =>
  page.evaluate((height) => {
    const enemy = window.__game.enemies.get(window.__stack.handleB);
    const p = enemy.body.translation();
    enemy.body.setTranslation({ x: p.x, y: height, z: p.z }, true);
    enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }, height);

// Скорость врага, разложенная на радиальную (к центру арены) и высоту центра.
const sample = (page, handleKey) =>
  page.evaluate((handleKey) => {
    const enemy = window.__game.enemies.get(window.__stack[handleKey]);
    if (!enemy) return null;

    const p = enemy.body.translation();
    const v = enemy.body.linvel();
    const d = Math.hypot(p.x, p.z);
    const radialX = -p.x / d;
    const radialZ = -p.z / d;

    return {
      radial: Number((v.x * radialX + v.z * radialZ).toFixed(3)),
      y: Number(p.y.toFixed(3)),
    };
  }, handleKey);

// Максимальная радиальная скорость за окно. Нижнего врага физика шатает от нагрузки сверху
// (контактный решатель даёт усадку/пружинение), и мгновенный снимок ловит спад скорости — тест
// из-за этого флакошил. Управляемый враг достигает ENEMY_SPEED хотя бы в какие-то моменты за окно,
// а враг без управления (старый баг) держал бы ~0 всё время. Максимум за окно чисто разделяет
// «управляется» и «не управляется», не чувствительный к кратковременной тряске.
const sampleMaxRadial = async (page, handleKey, count = 10, interval = 90) => {
  let max = -Infinity;

  for (let i = 0; i < count; i++) {
    const s = await sample(page, handleKey);
    if (s && s.radial > max) max = s.radial;
    await page.waitForTimeout(interval);
  }

  return max;
};

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9333');
  const context = browser.contexts()[0];
  for (const p of context.pages()) await p.close();

  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.addInitScript(() => {
    window.__folderByTitle = (title) => {
      const button = [...document.querySelectorAll('button.lil-title')].find((b) => b.textContent.trim() === title);
      return button ? button.closest('div.lil-gui') : null;
    };
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:sound-sets');
    localStorage.setItem(
      'project-animal:config-changes',
      JSON.stringify({
        // Не стрелять во время замера и медленно идти: врагам некуда спешить, тест кончается
        // задолго до того, как кто-то из врагов доходит до игрока и игра замирает.
        // CRIT_CHANCE: 0 — изолируем: крит-пуля в 2 раза тяжелее и сильнее толкает врага,
        // а тест меряет чистую физику опоры/управления, без посторонних толчков.
        FIRE_INTERVAL: 999,
        CRIT_CHANCE: 0,
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
  await page.waitForFunction(() => window.__game && window.__game.enemies.size >= 2, null, { timeout: 15000 });
  await page.waitForTimeout(500);

  // ─── 1. Куча: B стоит на крыше A — оба управляются ───
  const stacked = await stackEnemies(page);
  console.log('стопка: A ростом', stacked.sizeA, ', B ростом', stacked.sizeB, ', пара в', stacked.distance.toFixed(1), 'м');

  // Даём стопке успокоиться: посадка B на крышу A даёт импульс усадки, и первые кадры нижний
  // доворачивается (радиальная скорость падает ниже порога). Через ~1 с установившееся движение
  // обоих сходится к ENEMY_SPEED — замеряем уже установившийся режим, а не доворот.
  await page.waitForTimeout(1000);

  // Верхний проверяем по высоте сразу (позиция — величина стабильная), а радиальные скорости обоих
  // меряем максимумом за окно — против тряски от усадки стопки (см. sampleMaxRadial).
  const top = await sample(page, 'handleB');
  const expectedTopY = stacked.sizeA + stacked.sizeB / 2;
  console.log('верхний:  y =', top && top.y, '(нужно ~', expectedTopY.toFixed(2), ')');

  if (!top) throw new Error('верхний враг исчез из карты');
  if (Math.abs(top.y - expectedTopY) > 0.25) {
    throw new Error(`верхний сбит с крыши: y = ${top.y}, ожидалось ~${expectedTopY.toFixed(2)}`);
  }

  const topMax = await sampleMaxRadial(page, 'handleB');
  const bottomMax = await sampleMaxRadial(page, 'handleA');
  console.log('верхний max radial:', topMax, 'нижний max radial:', bottomMax, '(оба нужно ≥0.55)');

  if (topMax < 0.55) {
    throw new Error(`верхний не управляется: max radial = ${topMax}, ожидалось ≥0.55 (старый код дал бы ~0)`);
  }
  if (bottomMax < 0.55) {
    throw new Error(`нижний потерял управление: max radial = ${bottomMax}, ожидалось ≥0.55`);
  }

  // ─── 2. Воздух: B телепортирован вверх — управления по-прежнему нет ───
  await liftEnemy(page, 4);
  await page.waitForTimeout(300);

  const flying = await sample(page, 'handleB');
  console.log('в воздухе:', JSON.stringify(flying), '(нужно: radial ~0, y меньше 4 — падает)');

  if (!flying) throw new Error('враг исчез из карты после телепорта в воздух');
  if (Math.abs(flying.radial) > 0.3) {
    throw new Error(`в воздухе включилось управление: radial = ${flying.radial}, ожидалось ~0`);
  }
  if (flying.y >= 4) {
    throw new Error(`враг не падает: y = ${flying.y}`);
  }

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
