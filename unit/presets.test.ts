// Юнит-тесты пресетов настроек (src/presets.ts): создание, сохранение, загрузка, переименование
// и удаление пресетов поверх рабочего config. localStorage даёт happy-dom; unit/setup.ts перед каждым
// тестом очищает его и возвращает config к значениям кода. «Перезагрузка страницы» — новый store:
// он заново читает хранилище.
import { describe, expect, it } from 'vitest';
import { config, DEFAULT_CONFIG } from '@/config';
import { readSavedChanges } from '@/config-storage';
import { createPresetStore, DEFAULT_PRESET_NAME, type PresetStore } from '@/presets';

const PRESETS_KEY = 'project-cube:presets';
const CURRENT_KEY = 'project-cube:current-preset';

// Store с пресетом «Быстрый» (пауза между выстрелами 0.3); он — текущий.
const createStoreWithPreset = (): PresetStore => {
  const store = createPresetStore();

  config.FIRE_INTERVAL = 0.3;
  store.saveAsNew('Быстрый');

  return store;
};

describe('createPresetStore', () => {
  it('Должен начать с пресета «По умолчанию»', () => {
    expect(createPresetStore().getCurrentName()).toBe(DEFAULT_PRESET_NAME);
  });

  it('Должен показать в списке только «По умолчанию», пока пресетов нет', () => {
    expect(createPresetStore().getNames()).toEqual([DEFAULT_PRESET_NAME]);
  });

  it.each([
    [DEFAULT_PRESET_NAME, true],
    ['Быстрый', true],
    ['Нет такого', false],
  ])('Должен для имени «%s» ответить «занято»: %s', (name, expected) => {
    expect(createStoreWithPreset().hasPreset(name)).toBe(expected);
  });
});

describe('saveAsNew', () => {
  it('Должен сделать новый пресет текущим', () => {
    expect(createStoreWithPreset().getCurrentName()).toBe('Быстрый');
  });

  it('Должен добавлять пресеты в конец списка', () => {
    const store = createStoreWithPreset();

    store.saveAsNew('Медленный');

    expect(store.getNames()).toEqual([DEFAULT_PRESET_NAME, 'Быстрый', 'Медленный']);
  });

  it('Должен сохранить пресеты и текущий пресет между перезагрузками страницы', () => {
    createStoreWithPreset();

    const reloaded = createPresetStore();

    expect([reloaded.getNames(), reloaded.getCurrentName()]).toEqual([[DEFAULT_PRESET_NAME, 'Быстрый'], 'Быстрый']);
  });

  it('Должен хранить в пресете только отличия от кода, без сцены', () => {
    config.SCENE_MODE = 'polygon';
    createStoreWithPreset();

    expect(JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}')).toEqual({ 'Быстрый': { FIRE_INTERVAL: 0.3 } });
  });
});

describe('countUnsaved', () => {
  it('Должен считать правки относительно текущего пресета', () => {
    const store = createStoreWithPreset();

    config.CRIT_CHANCE = 0.9;

    expect(store.countUnsaved()).toBe(1);
  });

  it('Должен пропускать смену сцены', () => {
    const store = createStoreWithPreset();

    config.SCENE_MODE = 'polygon';

    expect(store.countUnsaved()).toBe(0);
  });
});

describe('saveToCurrent', () => {
  it('Должен записать правки в текущий пресет', () => {
    const store = createStoreWithPreset();

    config.FIRE_INTERVAL = 0.7;
    store.saveToCurrent();
    store.load(DEFAULT_PRESET_NAME);
    store.load('Быстрый');

    expect(config.FIRE_INTERVAL).toBe(0.7);
  });

  it('Должен оставить «По умолчанию» значениями кода', () => {
    const store = createPresetStore();

    config.FIRE_INTERVAL = 0.7;
    store.saveToCurrent();
    store.load(DEFAULT_PRESET_NAME);

    expect(config.FIRE_INTERVAL).toBe(DEFAULT_CONFIG.FIRE_INTERVAL);
  });
});

describe('load', () => {
  it('Должен загрузить значения пресета', () => {
    const store = createStoreWithPreset();

    store.load(DEFAULT_PRESET_NAME);
    store.load('Быстрый');

    expect(config.FIRE_INTERVAL).toBe(0.3);
  });

  it('Должен вернуть значения кода параметрам, которых нет в пресете', () => {
    const store = createStoreWithPreset();

    config.CRIT_CHANCE = 0.9;
    store.load('Быстрый');

    expect(config.CRIT_CHANCE).toBe(DEFAULT_CONFIG.CRIT_CHANCE);
  });

  it('Должен загрузить вложенные параметры типов врагов', () => {
    const store = createPresetStore();

    config.ENEMY_KINDS.tiny.hp = 99;
    store.saveAsNew('Крепкие крошки');
    store.load(DEFAULT_PRESET_NAME);
    store.load('Крепкие крошки');

    expect(config.ENEMY_KINDS.tiny.hp).toBe(99);
  });

  it('Должен оставить сцену прежней', () => {
    const store = createStoreWithPreset();

    config.SCENE_MODE = 'polygon';
    store.load(DEFAULT_PRESET_NAME);

    expect(config.SCENE_MODE).toBe('polygon');
  });

  it('Должен записать загруженные значения как рабочие — для перезагрузки страницы', () => {
    const store = createStoreWithPreset();

    store.load(DEFAULT_PRESET_NAME);
    store.load('Быстрый');

    expect(readSavedChanges()).toEqual({ FIRE_INTERVAL: 0.3 });
  });

  it('Должен загрузить «По умолчанию» вместо неизвестного пресета', () => {
    const store = createStoreWithPreset();

    store.load('Нет такого');

    expect(store.getCurrentName()).toBe(DEFAULT_PRESET_NAME);
  });
});

describe('rename', () => {
  it('Должен переименовать текущий пресет на его месте в списке', () => {
    const store = createStoreWithPreset();

    store.saveAsNew('Медленный');
    store.load('Быстрый');
    store.rename('Очень быстрый');

    expect(store.getNames()).toEqual([DEFAULT_PRESET_NAME, 'Очень быстрый', 'Медленный']);
  });

  it('Должен оставить пресеты как были, если имя занято', () => {
    const store = createStoreWithPreset();

    store.saveAsNew('Медленный');
    store.rename('Быстрый');

    expect(store.getNames()).toEqual([DEFAULT_PRESET_NAME, 'Быстрый', 'Медленный']);
  });
});

describe('remove', () => {
  it('Должен удалить текущий пресет', () => {
    const store = createStoreWithPreset();

    store.remove();

    expect(store.getNames()).toEqual([DEFAULT_PRESET_NAME]);
  });

  it('Должен после удаления загрузить «По умолчанию» со значениями кода', () => {
    const store = createStoreWithPreset();

    store.remove();

    expect([store.getCurrentName(), config.FIRE_INTERVAL]).toEqual([DEFAULT_PRESET_NAME, DEFAULT_CONFIG.FIRE_INTERVAL]);
  });
});

describe('испорченное хранилище', () => {
  it('Должен пропустить записи, которые не пресеты, и пресет с именем «По умолчанию»', () => {
    const saved = { 'Быстрый': { FIRE_INTERVAL: 0.3 }, 'Число': 5, [DEFAULT_PRESET_NAME]: {} };

    localStorage.setItem(PRESETS_KEY, JSON.stringify(saved));

    expect(createPresetStore().getNames()).toEqual([DEFAULT_PRESET_NAME, 'Быстрый']);
  });

  it('Должен начать с «По умолчанию», если текущего пресета нет среди сохранённых', () => {
    localStorage.setItem(CURRENT_KEY, 'Удалённый');

    expect(createPresetStore().getCurrentName()).toBe(DEFAULT_PRESET_NAME);
  });

  it('Должен начать без пресетов, если в хранилище не JSON', () => {
    localStorage.setItem(PRESETS_KEY, '{не json');

    expect(createPresetStore().getNames()).toEqual([DEFAULT_PRESET_NAME]);
  });
});
