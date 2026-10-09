// Проверка звуков выстрелов и смертей: три типа × 5 наборов, свои громкости и муты в панели,
// паузы между частыми звуками, перезагрузка.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/?wave=6';
const OUT = __dirname + '/screenshots';
  require('fs').mkdirSync(OUT, { recursive: true });

// В странице: __gains[0] = master, [1] = гейн попадания, [2] = выстрела, [3] = смерти
// (порядок создания в createSound); __plays[i] — сколько источников подключилось к гейну;
// __buffers — множество реально запущенных буферов. Хелперы панели — __folderByTitle /
// __controllerByName: папка lil-gui — div.lil-gui с кнопкой .lil-title, контроллер папки —
// .lil-controller, чей ближайший div.lil-gui и есть эта папка (вложенные — из своих папок).
const setupHooks = (page) =>
  page.addInitScript(() => {
    window.__gains = [];
    window.__plays = [0, 0, 0, 0];
    window.__buffers = new Set();

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
      }
      return originalConnect.call(this, destination, ...rest);
    };

    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) window.__buffers.add(this.buffer);
      return originalStart.apply(this, args);
    };

    window.__folderByTitle = (title) => {
      const button = [...document.querySelectorAll('button.lil-title')].find((b) => b.textContent.trim() === title);
      return button ? button.closest('div.lil-gui') : null;
    };

    // Сравнение по префиксу: панель дописывает к подписи способ применения («· волна», «· новые»).
    window.__controllerByName = (folderEl, name) =>
      [...folderEl.querySelectorAll('.lil-controller')].find(
        (c) => c.closest('div.lil-gui') === folderEl && c.querySelector('.lil-name')?.textContent.trim().startsWith(name),
      );
  });

const plays = (page) =>
  page.evaluate(() => ({ hit: window.__plays[1], shot: window.__plays[2], death: window.__plays[3] }));
const gains = (page) => page.evaluate(() => window.__gains.slice(0, 4).map((g) => g.gain.value));
const buffersCount = (page) => page.evaluate(() => window.__buffers.size);

const getWave = (page) =>
  page.evaluate(() => {
    const wave = [...document.querySelectorAll('div')].find(
      (d) => /^Волна \d+ \/ \d+$/.test(d.textContent.trim()) && d.children.length === 0,
    );
    return wave ? Number(wave.textContent.trim().match(/\d+/)[0]) : null;
  });

const openPanel = async (page) => {
  await page.locator('.lil-gui > .lil-title').first().click();
  await page.waitForTimeout(300);
};

const expandFolder = async (page, title) => {
  const state = await page.evaluate((t) => {
    const button = [...document.querySelectorAll('button.lil-title')].find((b) => b.textContent.trim() === t);
    if (!button) return 'missing';
    if (button.getAttribute('aria-expanded') === 'false') button.click();
    return 'ok';
  }, title);
  if (state !== 'ok') throw new Error(`folder «${title}»: ${state}`);
  await page.waitForTimeout(250);
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

const clickController = async (page, folderTitle, controllerName) => {
  const result = await page.evaluate(
    ({ folderTitle, controllerName }) => {
      const folderEl = window.__folderByTitle(folderTitle);
      if (!folderEl) return 'no folder';
      const controller = window.__controllerByName(folderEl, controllerName);
      if (!controller) return 'no controller';
      const input = controller.querySelector('input[type="checkbox"]');
      if (!input) return 'no checkbox';
      input.click();
      return 'ok';
    },
    { folderTitle, controllerName },
  );
  if (result !== 'ok') throw new Error(`checkbox «${folderTitle}/«${controllerName}»: ${result}`);
  await page.waitForTimeout(250);
};

const setSelect = async (page, folderTitle, controllerName, optionText) => {
  const result = await page.evaluate(
    ({ folderTitle, controllerName, optionText }) => {
      const folderEl = window.__folderByTitle(folderTitle);
      if (!folderEl) return 'no folder';
      const controller = window.__controllerByName(folderEl, controllerName);
      if (!controller) return 'no controller';
      const select = controller.querySelector('select');
      if (!select) return 'no select';
      const option = [...select.options].find((o) => o.text === optionText);
      if (!option) return 'no option';
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    },
    { folderTitle, controllerName, optionText },
  );
  if (result !== 'ok') throw new Error(`select «${folderTitle}/«${controllerName}»: ${result}`);
  await page.waitForTimeout(250);
};

const selectedOption = async (page, folderTitle, controllerName) =>
  page.evaluate(
    ({ folderTitle, controllerName }) => {
      const folderEl = window.__folderByTitle(folderTitle);
      const controller = folderEl && window.__controllerByName(folderEl, controllerName);
      const select = controller && controller.querySelector('select');
      return select ? select.options[select.selectedIndex].text : null;
    },
    { folderTitle, controllerName },
  );

const checkboxState = async (page, folderTitle, controllerName) =>
  page.evaluate(
    ({ folderTitle, controllerName }) => {
      const folderEl = window.__folderByTitle(folderTitle);
      const controller = folderEl && window.__controllerByName(folderEl, controllerName);
      const input = controller && controller.querySelector('input[type="checkbox"]');
      return input ? input.checked : null;
    },
    { folderTitle, controllerName },
  );

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9333');
  const context = browser.contexts()[0];
  for (const p of context.pages()) await p.close();

  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await setupHooks(page);

  // Чистое состояние; враги медленные и умирающие с одного попадания (игра не проиграет и не зависнет).
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:sound-sets');
    localStorage.setItem('project-animal:config-changes', JSON.stringify({ ENEMY_SPEED: 0.5, PROJECTILE_DAMAGE: 1000 }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);

  console.log('gains at start [master, hit, shot, death]:', await gains(page), '(нужно 0.5, 1, 0.8, 0.8)');

  // Жест — клик по арене.
  await page.mouse.click(450, 400);
  await page.waitForFunction(() => window.__plays[1] > 3 && window.__plays[2] > 3, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__plays[3] > 0, null, { timeout: 60000 });

  console.log('all three types play:', JSON.stringify(await plays(page)));
  console.log('distinct buffers:', await buffersCount(page));

  const waveBefore = await getWave(page);

  // ─── ГРОМКОСТИ через панель ───
  await openPanel(page);
  await expandFolder(page, 'Звук');

  await setSlider(page, 'Звук', 'Громкость (общая)', 0.9);
  console.log('gains after SOUND_VOLUME=0.9:', await gains(page), '(первый = 0.9)');

  await expandFolder(page, 'Выстрел');
  await setSlider(page, 'Выстрел', 'Громкость', 0.25);
  console.log('gains after SHOT_VOLUME=0.25:', await gains(page), '(третий = 0.25)');

  // ─── МУТ ТИПА: выстрел выключен — только его счётчик стоит ───
  const beforeShotMute = await plays(page);
  await clickController(page, 'Выстрел', 'Выключить звук');
  await page.waitForTimeout(3000);
  const afterShotMute = await plays(page);
  console.log(
    'shot mute: shot +%d (нужно 0), hit +%d, death +%d (нужно >0)',
    afterShotMute.shot - beforeShotMute.shot,
    afterShotMute.hit - beforeShotMute.hit,
    afterShotMute.death - beforeShotMute.death,
  );

  await clickController(page, 'Выстрел', 'Выключить звук'); // снять мут
  await page.waitForTimeout(1500);
  const resumed = await plays(page);
  console.log('shot unmute: shot +%d (нужно >0)', resumed.shot - afterShotMute.shot);

  // ─── СМЕНА НАБОРА СМЕРТИ: играют только смерти → новые буферы = новый набор ───
  await expandFolder(page, 'Попадание');
  await clickController(page, 'Попадание', 'Выключить звук');
  await clickController(page, 'Выстрел', 'Выключить звук'); // остаются только смерти

  const buffersBeforeSet = await buffersCount(page);
  const deathBeforeSet = (await plays(page)).death;
  await setSelect(page, 'Смерть', 'Набор', 'Осколки');
  await page.waitForFunction((base) => window.__plays[3] > base + 3, deathBeforeSet, { timeout: 60000 });
  const buffersAfterSet = await buffersCount(page);
  console.log(
    'death set «Осколки»: buffers %d → %d (нужно выросло), death plays +%d',
    buffersBeforeSet,
    buffersAfterSet,
    (await plays(page)).death - deathBeforeSet,
  );

  // вернуть как было
  await clickController(page, 'Попадание', 'Выключить звук');
  await clickController(page, 'Выстрел', 'Выключить звук');
  await setSelect(page, 'Смерть', 'Набор', 'Хлопок');

  // ─── ПАУЗА МЕЖДУ ВЫСТРЕЛАМИ: FIRE_INTERVAL 0.01 ───
  // Сначала просто: темп всё равно ограничен нехваткой целей (пули летят, врагов мало).
  await expandFolder(page, 'Игрок и стрельба');
  await setSlider(page, 'Игрок и стрельба', 'Пауза между выстрелами, с', 0.01);
  const fastBefore = await plays(page);
  await page.waitForTimeout(2000);
  const fastAfter = await plays(page);
  console.log('fast fire (обычные враги): shot sounds/sec = %d', (fastAfter.shot - fastBefore.shot) / 2);

  // Решающий опыт: ×30 врагов, быстрые пули, волна перезапущена (множитель применяется
  // со следующей волной) — целей хватает на любую частоту, стреляем можно 100 раз в секунду.
  // Замер: если пауза MIN_GAP_MS работает — не больше ~20 звуков в секунду.
  await expandFolder(page, 'Арена и волны');
  await setSlider(page, 'Арена и волны', 'Множитель врагов', 30);
  await expandFolder(page, 'Волны (отладка)');
  await page.getByText('Перезапустить волну', { exact: true }).click();
  await page.waitForTimeout(3500); // волна набирает врагов (лимит 50 появлений за кадр)
  const throttleBefore = await plays(page);
  await page.waitForTimeout(2000);
  const throttleAfter = await plays(page);
  console.log(
    'throttle proof: shot sounds/sec = %d (нужно ~20, максимум ~22 — иначе пауза не работает), hit/sec = %d',
    (throttleAfter.shot - throttleBefore.shot) / 2,
    (throttleAfter.hit - throttleBefore.hit) / 2,
  );

  // Возвращаем настройки к обычным.
  await setSlider(page, 'Арена и волны', 'Множитель врагов', 3);
  await setSlider(page, 'Игрок и стрельба', 'Скорость пули, м/с', 15);
  await setSlider(page, 'Игрок и стрельба', 'Пауза между выстрелами, с', 0.1);

  await expandFolder(page, 'Смерть');

  // Прокручиваем панель к разделу «Звук» — выше него раскрыт «Игрок и стрельба».
  await page.evaluate(() => {
    const title = [...document.querySelectorAll('button.lil-title')].find((b) => b.textContent.trim() === 'Звук');
    title?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/types-1-panel.png`, clip: { x: 874, y: 0, width: 366, height: 608 } });

  const waveAfter = await getWave(page);
  console.log('wave before/after panel:', waveBefore, waveAfter, '(не должна уменьшиться — игра не рестартнулась)');

  // ─── ПЕРЕЗАГРУЗКА: громкости, мут типа и набор выстрела переживают ───
  await expandFolder(page, 'Выстрел');
  await setSelect(page, 'Выстрел', 'Набор', 'Лазер');
  await clickController(page, 'Выстрел', 'Выключить звук'); // оставить выключенным

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  console.log('after reload gains:', await gains(page), '(нужно 0.9, 1, 0.25, 0.8)');

  await openPanel(page);
  await expandFolder(page, 'Звук');
  await expandFolder(page, 'Выстрел');
  console.log('after reload shot set:', await selectedOption(page, 'Выстрел', 'Набор'), '(нужно Лазер)');
  console.log('after reload shot muted:', await checkboxState(page, 'Выстрел', 'Выключить звук'), '(нужно true)');

  await page.mouse.click(450, 400); // разблокировка звука после перезагрузки
  await page.waitForFunction(() => window.__plays[1] > 0, null, { timeout: 30000 });
  const beforeReloadMute = await plays(page);
  await page.waitForTimeout(2500);
  const afterReloadMute = await plays(page);
  console.log(
    'shot still muted after reload: shot +%d (нужно 0), hit +%d (нужно >0)',
    afterReloadMute.shot - beforeReloadMute.shot,
    afterReloadMute.hit - beforeReloadMute.hit,
  );

  await clickController(page, 'Выстрел', 'Выключить звук'); // снять мут
  await setSlider(page, 'Звук', 'Громкость (общая)', 0.5);
  await setSlider(page, 'Выстрел', 'Громкость', 0.8);

  // ─── ОБЩИЙ МУТ В РЯДУ: замирают все три типа ───
  await page.locator('button[title="Выключить звук"]').click();
  await page.waitForTimeout(300);
  const beforeGlobalMute = await plays(page);
  await page.waitForTimeout(2500);
  const afterGlobalMute = await plays(page);
  console.log(
    'global mute: +%d / +%d / +%d (нужно 0, 0, 0)',
    afterGlobalMute.hit - beforeGlobalMute.hit,
    afterGlobalMute.shot - beforeGlobalMute.shot,
    afterGlobalMute.death - beforeGlobalMute.death,
  );
  await page.locator('button[title="Включить звук"]').click();
  await page.waitForTimeout(2000);
  const afterGlobalUnmute = await plays(page);
  console.log(
    'global unmute: +%d / +%d / +%d (нужно >0)',
    afterGlobalUnmute.hit - afterGlobalMute.hit,
    afterGlobalUnmute.shot - afterGlobalMute.shot,
    afterGlobalUnmute.death - afterGlobalMute.death,
  );

  await page.screenshot({ path: `${OUT}/types-2-row.png` });
  console.log('saved config:', await page.evaluate(() => localStorage.getItem('project-animal:config-changes')));

  // Оставляем браузер в чистом состоянии.
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:sound-sets');
    localStorage.removeItem('project-animal:config-changes');
  });

  console.log('console errors:', JSON.stringify(errors));
  await page.close();
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
