// E2E раскладки под ширину экрана (src/layout.ts): на узком экране панель настроек прижата к низу,
// а переключатель скорости поднят над её шапкой. Поворот телефона или ресайз окна перестраивают
// раскладку на ходу, без перезагрузки страницы.
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../src/main';
import { waitUntil } from './helpers';

const NARROW_WIDTH = 320;
const WIDE_WIDTH = 1024;
const HEIGHT = 768;

// Ряд переключателя скорости — родитель кнопки «×1».
const getSpeedSwitch = (): HTMLElement | null =>
  [...document.querySelectorAll('button')].find((button) => button.textContent === '×1')?.parentElement ?? null;

const getPanel = (): HTMLElement | null => document.querySelector('.lil-gui.lil-auto-place');

describe('раскладка под ширину экрана', () => {
  it('Должен поднять переключатель скорости над панелью после сужения экрана', async () => {
    await page.viewport(WIDE_WIDTH, HEIGHT);
    await page.viewport(NARROW_WIDTH, HEIGHT);
    await waitUntil(() => getSpeedSwitch()?.style.bottom === '48px', 2000, 'подъём переключателя');

    expect(getSpeedSwitch()?.style.bottom).toBe('48px');
  });

  it('Должен прижать панель настроек к низу после сужения экрана', async () => {
    await page.viewport(WIDE_WIDTH, HEIGHT);
    await page.viewport(NARROW_WIDTH, HEIGHT);
    await waitUntil(() => getPanel()?.style.bottom === '0px', 2000, 'панель внизу');

    expect(getPanel()?.style.bottom).toBe('0px');
  });

  it('Должен сузить панель настроек до ширины экрана с зазором 16 px по краям', async () => {
    await page.viewport(WIDE_WIDTH, HEIGHT);
    await page.viewport(NARROW_WIDTH, HEIGHT);
    await waitUntil(() => getPanel()?.style.bottom === '0px', 2000, 'панель внизу');

    expect(getComputedStyle(getPanel()!).width).toBe(`${NARROW_WIDTH - 32}px`);
  });

  it('Должен вернуть переключатель скорости вниз после расширения экрана', async () => {
    await page.viewport(NARROW_WIDTH, HEIGHT);
    await page.viewport(WIDE_WIDTH, HEIGHT);
    await waitUntil(() => getSpeedSwitch()?.style.bottom === '16px', 2000, 'возврат переключателя');

    expect(getSpeedSwitch()?.style.bottom).toBe('16px');
  });
});
