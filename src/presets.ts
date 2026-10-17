// Пресеты настроек: именованные наборы значений панели (раздел «Пресеты», см. settings-panel.ts).
//
// Пресет хранит не весь конфиг, а только ОТЛИЧИЯ от значений из кода (DEFAULT_CONFIG) — как и рабочее
// сохранение в config-storage.ts. Параметр, который в пресете не трогали, следует за config.ts:
// поправил число в коде — оно применится и в пресете.
//
// Пресет «По умолчанию» — это сам код: в хранилище его нет, сохранить в него, переименовать или удалить
// его нельзя. Так всегда есть точка отсчёта.
//
// Рабочие значения (config) — это загруженный пресет плюс несохранённые правки; их по-прежнему хранит
// config-storage.ts, поэтому правки переживают перезагрузку страницы. Несохранённое — отличия рабочих
// значений от значений текущего пресета.
//
// Выбор сцены (SCENE_MODE) в пресет не входит: пресет — «как настроено», а сцена — «что смотрим».
// Загрузка пресета сцену не меняет — пресеты можно сравнивать прямо на полигоне.
import { config, DEFAULT_CONFIG } from './config';
import { applyChanges, countChanges, getChanges, isRecord, saveChanges, type Values } from './config-storage';

export const DEFAULT_PRESET_NAME = 'По умолчанию';

// Ключи localStorage: все пресеты (имя → отличия от кода) и имя текущего.
const PRESETS_KEY = 'project-cube:presets';
const CURRENT_KEY = 'project-cube:current-preset';

// Параметры конфига, которые в пресет не входят.
const NOT_IN_PRESET = new Set(['SCENE_MODE']);

// Сохранённые пресеты: имя → отличия от кода. «По умолчанию» здесь не бывает.
type Presets = Record<string, Values>;

export type PresetStore = {
  // Имена для селекта: «По умолчанию» первым, дальше сохранённые — в порядке создания.
  getNames: () => string[];
  getCurrentName: () => string;

  // Проверка «текущий пресет — «По умолчанию»?» (на нём сохранять, переименовывать и удалять нельзя).
  isDefault: () => boolean;

  // Проверка «имя занято?» — сохранённым пресетом или «По умолчанию».
  hasPreset: (name: string) => boolean;

  // Сколько параметров рабочего конфига отличается от текущего пресета (без сцены).
  countUnsaved: () => number;

  // Записать рабочие значения в текущий пресет. На «По умолчанию» ничего не делает.
  saveToCurrent: () => void;

  // Записать рабочие значения в пресет name (новый или поверх существующего) и сделать его текущим.
  saveAsNew: (name: string) => void;

  // Переименовать текущий пресет; место в списке сохраняется. Имя занято — ничего не делает.
  rename: (name: string) => void;

  // Удалить текущий пресет и загрузить «По умолчанию».
  remove: () => void;

  // Загрузить пресет name: рабочие значения — код плюс отличия пресета, сцена остаётся прежней,
  // несохранённые правки пропадают. Неизвестное имя — «По умолчанию».
  load: (name: string) => void;
};

// Объект без параметров, которые в пресет не входят.
const withoutExcluded = (values: Values): Values =>
  Object.fromEntries(Object.entries(values).filter(([key]) => !NOT_IN_PRESET.has(key)));

// Проверка записи хранилища «имя — пресет?»: значение — объект отличий, имя — не «По умолчанию»
// (такого пресета в хранилище быть не может: его значения — код).
const isPresetEntry = (entry: [string, unknown]): entry is [string, Values] =>
  entry[0] !== DEFAULT_PRESET_NAME && isRecord(entry[1]);

// Читает пресеты из хранилища. Повреждённые записи пропускаются, недоступное хранилище — пресетов нет.
const readPresets = (): Presets => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}');

    return isRecord(saved) ? Object.fromEntries(Object.entries(saved).filter(isPresetEntry)) : {};
  } catch {
    return {};
  }
};

// Имя текущего пресета из хранилища; если такого пресета нет (удалён, хранилище испорчено) — «По умолчанию».
const readCurrentName = (presets: Presets): string => {
  try {
    const name = localStorage.getItem(CURRENT_KEY);

    return name !== null && Object.hasOwn(presets, name) ? name : DEFAULT_PRESET_NAME;
  } catch {
    return DEFAULT_PRESET_NAME;
  }
};

// Создаёт хранилище пресетов поверх рабочего config. Читает localStorage один раз при создании,
// дальше держит пресеты в памяти и записывает каждое изменение.
export const createPresetStore = (): PresetStore => {
  const presets = readPresets();
  const state = { presets, currentName: readCurrentName(presets) };

  // Записывает пресеты и имя текущего. Пусто — ключей в хранилище нет (как в config-storage.ts).
  const write = (): void => {
    try {
      if (Object.keys(state.presets).length === 0) {
        localStorage.removeItem(PRESETS_KEY);
      } else {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(state.presets));
      }

      if (state.currentName === DEFAULT_PRESET_NAME) {
        localStorage.removeItem(CURRENT_KEY);
      } else {
        localStorage.setItem(CURRENT_KEY, state.currentName);
      }
    } catch {
      // Хранилище недоступно — пресеты проживут до перезагрузки страницы.
    }
  };

  const isDefault = (): boolean => state.currentName === DEFAULT_PRESET_NAME;

  const hasPreset = (name: string): boolean => name === DEFAULT_PRESET_NAME || Object.hasOwn(state.presets, name);

  // Полные значения пресета name: код плюс его отличия. Для «По умолчанию» — просто код.
  const getPresetValues = (name: string): Values => {
    const values = structuredClone(DEFAULT_CONFIG);

    applyChanges(values, state.presets[name] ?? {});

    return values;
  };

  // Что записать в пресет: отличия рабочих значений от кода, без сцены.
  const getWorkingChanges = (): Values => withoutExcluded(getChanges(config, DEFAULT_CONFIG));

  const countUnsaved = (): number =>
    countChanges(getChanges(withoutExcluded(config), withoutExcluded(getPresetValues(state.currentName))));

  const saveToCurrent = (): void => {
    if (isDefault()) {
      return;
    }

    state.presets[state.currentName] = getWorkingChanges();
    write();
  };

  const saveAsNew = (name: string): void => {
    if (name === DEFAULT_PRESET_NAME) {
      return;
    }

    state.presets[name] = getWorkingChanges();
    state.currentName = name;
    write();
  };

  // Пересобираем объект с новым ключом на месте старого — порядок пресетов в селекте не меняется.
  const rename = (name: string): void => {
    if (isDefault() || hasPreset(name)) {
      return;
    }

    state.presets = Object.fromEntries(
      Object.entries(state.presets).map(([key, value]) => [key === state.currentName ? name : key, value]),
    );

    state.currentName = name;
    write();
  };

  // Рабочие значения заменяются целиком (applyChanges обходит и вложенные ENEMY_KINDS), сцена — прежняя.
  // Рабочая копия сразу записывается: перезагрузка страницы покажет загруженный пресет.
  const load = (name: string): void => {
    const sceneMode = config.SCENE_MODE;

    state.currentName = hasPreset(name) ? name : DEFAULT_PRESET_NAME;
    applyChanges(config, getPresetValues(state.currentName));
    config.SCENE_MODE = sceneMode;
    saveChanges(getChanges(config, DEFAULT_CONFIG));
    write();
  };

  const remove = (): void => {
    if (isDefault()) {
      return;
    }

    state.presets = Object.fromEntries(Object.entries(state.presets).filter(([key]) => key !== state.currentName));
    load(DEFAULT_PRESET_NAME);
  };

  return {
    getNames: (): string[] => [DEFAULT_PRESET_NAME, ...Object.keys(state.presets)],
    getCurrentName: (): string => state.currentName,
    isDefault,
    hasPreset,
    countUnsaved,
    saveToCurrent,
    saveAsNew,
    rename,
    remove,
    load,
  };
};
