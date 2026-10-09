// Проверка «Снарядов за выстрел» (PROJECTILE_COUNT): залп идёт по РАЗНЫМ врагам,
// по одному снаряду на каждого; врагов меньше, чем снарядов, — по одному на каждого,
// лишние снаряды не выпускаются.
//
// Метод: один звук выстрела = один залп (см. shoot в main.ts), цифра урона = попадание
// (все враги в тесте падают с одного урона — HP = урон = 20). Окно звука — до первого
// попадания (после него возможны добивающие залпы из-за перекрытий), окно цифр — от
// первого попадания до спавна следующей группы.
//
// Сценарии:
//   Волна 4 «С двух сторон», 4 врага ПОПЕРЁК выстрела (перекрытий нет — залпы точны):
//     count=20 → 1 залп;  count=4 → 1 залп;  count=2 → 2 залпа;  count=1 → 4 залпа;
//     каждый раз 4 цифры урона = все 4 врага поражены.
//   Волна 2 «Дуга сверху», 20 врагов в дуге (плотно, бывают перекрытия — залпы с поправкой):
//     count=5 → залпов 3…8 (без бага «все снаряды в одного» их было бы 20), цифр урона 20.
//   Плюс: ползунок по умолчанию 1, диапазон 1…20 шаг 1 (клампингом), загрузка из
//   config-changes и сохранение в localStorage.
const fs = require('fs');
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/?wave=1';
const OUT = __dirname + '/screenshots';
  require('fs').mkdirSync(OUT, { recursive: true });
const WAVE2 = '2 · Дуга сверху';
const WAVE4 = '4 · С двух сторон';

const setupHooks = (page) =>
  page.addInitScript(() => {
    window.__gains = [];
    window.__plays = [0, 0, 0, 0];
    window.__shotTimes = [];

    const originalCreateGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function (...args) {
      const node = originalCreateGain.apply(this, args);
      window.__gains.push(node);
      return node;
    };

    const originalConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...rest) {
      if (this instanceof AudioBufferSourceNode) {
        const index = window.__gains.indexOf(destination);
        if (index >= 1 && index <= 3) window.__plays[index] += 1;
        // Время каждого звука выстрела — чтобы резать окно измерения на первом попадании.
        if (index === 2) window.__shotTimes.push(performance.now());
      }
      return originalConnect.call(this, destination, ...rest);
    };

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

// Читает значение ползунка (на десктопе lil-gui рисует свой div-слайдер и input[type="text"],
// атрибутов min/max в DOM нет — диапазон проверяется клампингом, см. checkRange ниже).
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

// Проверяет диапазон ползунка поведением: значение за пределами прижимается к краям,
// дробное приближается к шагу. Возвращает ползунок в from.
const checkRange = async (page, folderTitle, controllerName, { min, max, from }) => {
  const probe = async (value, expected) => {
    await setSlider(page, folderTitle, controllerName, value);
    const shown = await readSlider(page, folderTitle, controllerName);
    if (Number(shown) !== expected) {
      throw new Error(`range: ввод ${value} → ${shown}, ожидалось ${expected}`);
    }
    console.log(`range: ввод ${value} → ${shown} (нужно ${expected})`);
  };

  await probe(max + 100, max); // за верхней границей — прижимается к max
  await probe(min - 10, min); // за нижней — к min
  await probe(7.5, 8); // дробное — к шагу 1
  await setSlider(page, folderTitle, controllerName, from);
};

// Наблюдатель за цифрами урона: каждый добавленный в DOM элемент — время попадания.
const installNumberObserver = (page) =>
  page.evaluate(() => {
    window.__numberTimes = [];
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) window.__numberTimes.push(performance.now());
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    return 'ok';
  });

// Наблюдатель за строкой «Группа N / M» в HUD: время каждой смены. Смена группы происходит в
// начале кадра после полной гибели предыдущей — строго ПОСЛЕ её последней цифры урона, поэтому
// по ней можно резать окно цифр: всё, что после смены, — уже прилёты следующей группы.
const installGroupObserver = (page) =>
  page.evaluate(() => {
    const groupLine = [...document.querySelectorAll('body div')].find(
      (el) => el.children.length === 0 && /^Группа \d+ \/ \d+$/.test(el.textContent),
    );
    if (!groupLine) return 'no group line';
    window.__groupChanges = [{ t: performance.now(), text: groupLine.textContent }];
    new MutationObserver(() => window.__groupChanges.push({ t: performance.now(), text: groupLine.textContent })).observe(
      groupLine,
      { characterData: true, childList: true, subtree: true },
    );
    return 'ok';
  });

// Сбрасывает счётчики и запускает волну одним evaluate — игровой цикл не вклинивается
// между сбросом и стартом, звуки/цифры предыдущей волны не попадают в окно измерения.
// waveOption — выбор волны в селекте; null — перезапуск текущей волны кнопкой
// «Перезапустить волну» (кнопка в закрытой папке — клик по DOM работает и так).
const resetAndStartWave = (page, waveOption) =>
  page.evaluate((waveOption) => {
    window.__plays[2] = 0;
    window.__shotTimes = [];
    window.__numberTimes = [];

    if (waveOption) {
      const folderEl = window.__folderByTitle('Волны (отладка)');
      const controller = window.__controllerByName(folderEl, 'Волна');
      const select = controller.querySelector('select');
      const option = [...select.options].find((o) => o.text === waveOption);
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Перезапустить волну',
      );
      button.click();
    }

    // Текущая строка группы уже «Группа 1 / …» (startWave сменил её синхронно в том же вызове).
    const groupLine = [...document.querySelectorAll('body div')].find(
      (el) => el.children.length === 0 && /^Группа \d+ \/ \d+$/.test(el.textContent),
    );
    window.__groupChanges = [{ t: performance.now(), text: groupLine.textContent }];

    return performance.now();
  }, waveOption);

// Замер одной фазы: залпы до первого попадания, цифры урона после него.
// Окно цифр: если у волны есть следующая группа (label.groupSwitch — её строка в HUD), режем
// по смене группы: она случается строго после последней цифры своей группы, а прилёты новой
// группы — секундами позже. Если группы одной — временное окно numbersWindow мс.
const measure = async (page, { label, expectedShots, numbersWindow, takeShots }) => {
  const start = await resetAndStartWave(page, label.waveOption);
  const shotsLog = [];

  if (takeShots) {
    // Серия скриншотов на время полёта: пока цифры урона не пошли, снаряды в воздухе.
    for (let index = 0; index < 12; index++) {
      const time = await page.evaluate(() => performance.now());
      const path = `${OUT}/volley-fan-${index}.png`;
      await page.screenshot({ path });
      shotsLog.push({ path, time });
      if ((await page.evaluate(() => window.__numberTimes.length)) > 0) break;
      await page.waitForTimeout(300);
    }
  }

  await page.waitForFunction(() => window.__numberTimes.length > 0, null, { timeout: 30000 });

  const firstHit = (await page.evaluate(() => window.__numberTimes[0]));
  const shots = await page.evaluate(
    (firstHit) => window.__shotTimes.filter((time) => time < firstHit).length,
    firstHit,
  );

  let windowEnd;
  if (label.groupSwitch) {
    await page.waitForFunction(
      (text) => window.__groupChanges.some((change) => change.text === text),
      label.groupSwitch,
      { timeout: 20000 },
    );
    windowEnd =
      (await page.evaluate(
        (text) => window.__groupChanges.find((change) => change.text === text).t,
        label.groupSwitch,
      )) + 50;
  } else {
    await page.waitForTimeout(numbersWindow);
    windowEnd = firstHit + numbersWindow;
  }

  const numbers = await page.evaluate(
    ({ firstHit, windowEnd }) =>
      window.__numberTimes.filter((time) => time >= firstHit && time <= windowEnd).length,
    { firstHit, windowEnd },
  );

  const name = label.name;
  console.log(
    `${name}: залпов ${shots} (нужно ${expectedShots}), цифр урона ${numbers} (нужно ${label.expectedNumbers}), полёт ${Math.round(firstHit - start)} мс`,
  );

  if (shots !== expectedShots) throw new Error(`${name}: залпов ${shots}, ожидалось ${expectedShots}`);
  if (numbers !== label.expectedNumbers) {
    throw new Error(`${name}: цифр урона ${numbers}, ожидалось ${label.expectedNumbers}`);
  }

  if (takeShots && shotsLog.length > 0) {
    const best = shotsLog.filter((shot) => shot.time < firstHit - 250).pop() ?? shotsLog[0];
    fs.copyFileSync(best.path, `${OUT}/projectile-fan.png`);
    console.log('лучший скриншот веера:', best.path, '→ projectile-fan.png');
  }
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

  // ─── 1. Значения по умолчанию ───
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:sound-sets');
    localStorage.removeItem('project-animal:config-changes');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  await openPanel(page);
  const defaults = await readSlider(page, 'Игрок и стрельба', 'Снарядов за выстрел');
  console.log('default slider value:', defaults, '(нужно 1)');
  if (Number(defaults) !== 1) throw new Error(`default value ${defaults}, ожидалось 1`);

  // Диапазон 1…20, шаг 1 — проверяем клампингом (min/max не видны в DOM).
  await checkRange(page, 'Игрок и стрельба', 'Снарядов за выстрел', { min: 1, max: 20, from: 1 });

  // ─── 2. Настройки для точного измерения ───
  // Урон = HP = 20 — один снаряд убивает, каждое убийство даёт ровно одну цифру урона.
  // Множитель врагов 1 — волна 4 даёт ровно 4 врага, волна 2 — ровно 20.
  // Снаряды медленные (4 м/с) — полёт ~3 с, все залпы успевают до первого попадания.
  await page.evaluate(() => {
    localStorage.setItem(
      'project-animal:config-changes',
      JSON.stringify({
        PROJECTILE_COUNT: 20,
        PROJECTILE_DAMAGE_MIN: 20,
        PROJECTILE_DAMAGE_MAX: 20,
        PROJECTILE_SPEED: 4,
        PROJECTILE_SIZE: 0.5,
        PROJECTILE_COLOR: '#00ffff',
        ENEMY_SPEED: 0.5,
        ENEMY_COUNT_MULTIPLIER: 1,
        // Криты off: тест меряет точную логику добивания (крит-урон убил бы врага раньше и
        // сдвинул момент прибытия снарядов).
        CRIT_CHANCE: 0,
        ENEMY_KINDS: {
          tiny: { hp: 20 },
          small: { hp: 20 },
          normal: { hp: 20 },
          big: { hp: 20 },
          brute: { hp: 20 },
        },
      }),
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  // Звук: разблокировка жестом — иначе звуки залпов не играют (тест меряет автоматизацию
  // гейна выстрела). Глушим master-гейн (индекс 0 в живом контексте, sound.ts): в колонках
  // тишина, а гейн выстрела (индекс 2) продолжает работать — измерения от громкости не зависят.
  await page.mouse.click(450, 400);
  await page.evaluate(() => {
    window.__gains[0].gain.value = 0;
  });

  await installNumberObserver(page);
  await installGroupObserver(page);

  await openPanel(page);
  const configured = await readSlider(page, 'Игрок и стрельба', 'Снарядов за выстрел');
  console.log('slider with config-changes:', configured, '(нужно 20)');
  if (Number(configured) !== 20) throw new Error('PROJECTILE_COUNT from config not shown');

  // ─── 3. Волна 4, 4 врага вразброс ───
  // count=20 > 4 врагов → один залп на всех, по одному снаряду (не 20 в одного).
  await measure(page, {
    label: { name: 'волна4 count=20', waveOption: WAVE4, expectedNumbers: 4, groupSwitch: 'Группа 2 / 2' },
    expectedShots: 1,
    numbersWindow: 2500,
    takeShots: true,
  });

  // count=4 = числу врагов → тоже один залп (граница «равно»).
  await setSlider(page, 'Игрок и стрельба', 'Снарядов за выстрел', 4);
  await measure(page, {
    label: { name: 'волна4 count=4', waveOption: null, expectedNumbers: 4, groupSwitch: 'Группа 2 / 2' },
    expectedShots: 1,
    numbersWindow: 2500,
  });

  // count=2 < 4 → два залпа по 2: снаряды делятся между врагами, а не идут в одного.
  await setSlider(page, 'Игрок и стрельба', 'Снарядов за выстрел', 2);
  await measure(page, {
    label: { name: 'волна4 count=2', waveOption: null, expectedNumbers: 4, groupSwitch: 'Группа 2 / 2' },
    expectedShots: 2,
    numbersWindow: 2500,
  });

  // count=1 → по одному снаряду за выстрел: 4 врага = 4 залпа (как до появления настройки).
  await setSlider(page, 'Игрок и стрельба', 'Снарядов за выстрел', 1);
  await measure(page, {
    label: { name: 'волна4 count=1', waveOption: null, expectedNumbers: 4, groupSwitch: 'Группа 2 / 2' },
    expectedShots: 4,
    numbersWindow: 2500,
  });

  // ─── 4. Волна 2, 20 врагов в тесной дуге ───
  // Множитель врагов 5 (применяется при старте волны) — волна 2: 4 × 5 = 20 врагов сразу.
  // count=5 → ровно 4 залпа по 5 (залпы идут только пока есть непокрытые враги — до первого
  // попадания; добивающие после попаданий в окно не считаются; при баге «все снаряды в одного»
  // залпов было бы 20). Цифр урона 20 — каждый из 20 врагов получил свой снаряд и убит.
  await setSlider(page, 'Арена и волны', 'Множитель врагов', 5);
  await setSlider(page, 'Игрок и стрельба', 'Снарядов за выстрел', 5);
  const saved = await page.evaluate(() => localStorage.getItem('project-animal:config-changes'));
  console.log('saved config:', saved);
  if (!saved.includes('"PROJECTILE_COUNT":5')) throw new Error('PROJECTILE_COUNT=5 not saved');
  await measure(page, {
    label: { name: 'волна2 count=5', waveOption: WAVE2, expectedNumbers: 20 },
    expectedShots: 4,
    numbersWindow: 1500,
  });

  await page.screenshot({
    path: `${OUT}/projectile-count-panel.png`,
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
