// E2E пресетов настроек (src/presets.ts) через панель: «Сохранить в новый…», переключение селектом,
// подтверждение потери несохранённого, кнопки на «По умолчанию», удаление, переименование
// и перезапуск игры при смене пресета. Диалоги браузера (prompt, confirm) подменены шпионами.
// Пресеты живут в памяти панели всю страницу, поэтому у каждого теста свои имена.
import { afterEach, expect, it, vi } from 'vitest';
import '@/main';
import { config, DEFAULT_CONFIG } from '@/config';
import { DEFAULT_PRESET_NAME } from '@/presets';
import { getButton, getEnemiesCount, waitUntil } from './helpers';

const mockedPrompt = vi.spyOn(window, 'prompt');
const mockedConfirm = vi.spyOn(window, 'confirm');

// Селект «Пресет» — тот, у которого есть вариант «По умолчанию».
const getPresetSelect = (): HTMLSelectElement => {
  const select = [...document.querySelectorAll('.lil-gui select')].find((element): boolean =>
    [...element.querySelectorAll('option')].some((option) => option.textContent === DEFAULT_PRESET_NAME),
  );

  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('селект «Пресет» не найден');
  }

  return select;
};

const getPresetNames = (): string[] =>
  [...getPresetSelect().querySelectorAll('option')].map((option) => option.textContent ?? '');

const getSelectedPreset = (): string => getPresetSelect().selectedOptions[0]?.textContent ?? '';

// Выбирает пресет name в селекте — как пользователь.
const choosePreset = (name: string): void => {
  const select = getPresetSelect();

  select.selectedIndex = getPresetNames().indexOf(name);
  select.dispatchEvent(new Event('change'));
};

const clickButton = (text: string): void => {
  const button = getButton(text);

  if (!button) {
    throw new Error(`кнопка «${text}» не найдена`);
  }

  button.click();
};

// Сохраняет текущие значения в новый пресет name (имя «вводится» в подменённый prompt).
const saveAsNewPreset = (name: string): void => {
  mockedPrompt.mockReturnValue(name);
  clickButton('Сохранить в новый…');
};

afterEach(() => vi.clearAllMocks());

it('Должен добавить новый пресет в селект и сделать его текущим', () => {
  saveAsNewPreset('Быстрый');

  expect(getSelectedPreset()).toBe('Быстрый');
});

it('Должен вернуть значения кода при переключении на «По умолчанию»', () => {
  config.FIRE_INTERVAL = 0.3;
  saveAsNewPreset('Частый');
  choosePreset(DEFAULT_PRESET_NAME);

  expect(config.FIRE_INTERVAL).toBe(DEFAULT_CONFIG.FIRE_INTERVAL);
});

it('Должен остаться на пресете, если отказаться терять несохранённые правки', () => {
  saveAsNewPreset('Медленный');
  config.FIRE_INTERVAL = 0.9;
  mockedConfirm.mockReturnValue(false);
  choosePreset(DEFAULT_PRESET_NAME);

  expect(getSelectedPreset()).toBe('Медленный');
});

it('Должен выключить «Сохранить в текущий» на «По умолчанию»', () => {
  mockedConfirm.mockReturnValue(true);
  choosePreset(DEFAULT_PRESET_NAME);

  expect(getButton('Сохранить в текущий')?.disabled).toBe(true);
});

it('Должен переименовать текущий пресет', () => {
  saveAsNewPreset('Черновик');
  mockedPrompt.mockReturnValue('Чистовик');
  clickButton('Переименовать…');

  expect(getSelectedPreset()).toBe('Чистовик');
});

it('Должен удалить текущий пресет из селекта', () => {
  saveAsNewPreset('Лишний');
  mockedConfirm.mockReturnValue(true);
  clickButton('Удалить');

  expect(getPresetNames()).not.toContain('Лишний');
});

it('Должен начать игру заново при смене пресета', async () => {
  saveAsNewPreset('Перезапуск');

  await waitUntil({ isDone: () => getEnemiesCount() > 0, timeoutMs: 15000, what: 'появление врагов' });

  // Пресет только что сохранён — несохранённого нет, переключение без вопросов. Новая игра
  // начинается с пустой арены: враги первой волны появятся только на следующем шаге.
  choosePreset(DEFAULT_PRESET_NAME);

  expect(getEnemiesCount()).toBe(0);
});
