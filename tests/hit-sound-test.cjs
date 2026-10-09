// Проверка звука попадания и кнопки отключения звука.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:5173/cube/?wave=6';
const OUT = __dirname + '/screenshots';
  require('fs').mkdirSync(OUT, { recursive: true });

const getHud = (page) =>
  page.evaluate(() => {
    const leaf = (re) =>
      [...document.querySelectorAll('div')].find((d) => re.test(d.textContent.trim()) && d.children.length === 0);
    const wave = leaf(/^Волна \d+ \/ \d+$/);
    return { wave: wave ? wave.textContent.trim() : null };
  });

// Считаем воспроизведения: патчим start у AudioBufferSourceNode, это делается на каждой странице заново.
const patchCounters = (page) =>
  page.evaluate(() => {
    window.__snd = { plays: 0, buffers: new Set() };
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__snd.plays++;
      if (this.buffer) window.__snd.buffers.add(this.buffer);
      return originalStart.apply(this, args);
    };

    // Доказательство, что попадания есть: цифры урона добавляются в DOM при каждом попадании.
    window.__hits = 0;
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLDivElement && node.style.position === 'absolute' && /^\d+$/.test(node.textContent)) {
            window.__hits++;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

const stats = (page) => page.evaluate(() => ({ plays: window.__snd.plays, buffers: window.__snd.buffers.size, hits: window.__hits }));

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9333');
  const context = browser.contexts()[0];
  for (const p of context.pages()) await p.close();

  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // Чистим состояние прошлых прогонов: звук включён, враги медленные (чтобы игра не проиграла во время теста).
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.setItem('project-animal:config-changes', JSON.stringify({ ENEMY_SPEED: 0.5 }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await patchCounters(page);

  // Жест — клик по арене: разблокирует аудио (игра при этом не перезапускается, мы играем).
  await page.mouse.click(450, 400);

  // Ждём первых звуков.
  await page.waitForFunction(() => window.__snd.plays >= 4, null, { timeout: 30000 });
  const first = await stats(page);
  console.log('after 4+ plays:', JSON.stringify(first), '(нужно buffers >= 2 — варианты не повторяются подряд)');

  const hudBefore = await getHud(page);
  await page.screenshot({ path: `${OUT}/snd-1-hits.png` });

  // Выключаем звук.
  const button = page.locator('button', { hasText: /[🔊🔇]/ });
  console.log('button count:', await button.count());
  await button.click();
  await page.waitForTimeout(300);

  const muted = await page.evaluate(() => ({
    icon: document.querySelector('button[title*="звук" i]')?.textContent,
    tooltip: document.querySelector('button[title*="звук" i]')?.title,
    stored: localStorage.getItem('project-animal:muted'),
  }));
  console.log('muted state:', JSON.stringify(muted));
  await page.screenshot({ path: `${OUT}/snd-2-muted.png` });

  // Пока звук выключен, попадания идут (цифры урона растут), а воспроизведения — нет.
  const beforeMute = await stats(page);
  await page.waitForTimeout(3000);
  const afterMute = await stats(page);
  console.log(
    'muted window: hits +',
    afterMute.hits - beforeMute.hits,
    ', plays +',
    afterMute.plays - beforeMute.plays,
    '(нужно hits > 0 и plays = 0)',
  );

  const hudAfterMute = await getHud(page);
  console.log('hud before/after mute click:', JSON.stringify(hudBefore), JSON.stringify(hudAfterMute));

  // Включаем обратно.
  await button.click();
  await page.waitForFunction((base) => window.__snd.plays > base, afterMute.plays, { timeout: 15000 });
  const unmuted = await page.evaluate(() => ({
    icon: document.querySelector('button[title*="звук" i]')?.textContent,
    stored: localStorage.getItem('project-animal:muted'),
  }));
  console.log('unmuted state:', JSON.stringify(unmuted));
  await page.screenshot({ path: `${OUT}/snd-3-unmuted.png` });
  // Крупный план ряда кнопок (скорости + звук): обводим ряд рамкой, чтобы он выделился на скриншоте.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((el) => /[🔊🔇]/.test(el.textContent));
    b.parentElement.style.outline = '2px solid yellow';
  });
  await page.screenshot({ path: `${OUT}/snd-4-row.png`, clip: { x: 0, y: 545, width: 420, height: 63 } });

  // Перезагрузка: состояние «выключено» должно сохраняться... (сейчас включено, проверим наоборот)
  await page.evaluate(() => localStorage.setItem('project-animal:muted', '1'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await patchCounters(page);
  const afterReload = await page.evaluate(() => ({
    icon: document.querySelector('button[title*="звук" i]')?.textContent,
    stored: localStorage.getItem('project-animal:muted'),
  }));
  console.log('after reload with muted=1:', JSON.stringify(afterReload));

  await page.mouse.click(450, 400);
  await page.waitForFunction(() => window.__hits >= 3, null, { timeout: 30000 });
  const mutedRun = await stats(page);
  console.log('muted after reload (нужно plays = 0, hits > 0):', JSON.stringify(mutedRun));

  // Оставляем браузер со включённым звуком и дефолтным конфигом.
  await page.evaluate(() => {
    localStorage.removeItem('project-animal:muted');
    localStorage.removeItem('project-animal:config-changes');
  });

  console.log('console errors:', JSON.stringify(errors));
  await page.close();
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
