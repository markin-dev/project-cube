// Панель настроек: все параметры из config.ts можно менять прямо во время игры.
// Панель строит библиотека lil-gui: по полю объекта она сама создаёт ползунок, поле ввода или выбор цвета
// и при изменении записывает новое значение прямо в это поле — то есть в config.
//
// Изменения действуют не все одинаково — это видно по подписи параметра:
//   без пометки     — сразу (значение читается каждый кадр или в момент выстрела, цвета перекрашиваются на ходу);
//   «· новые»       — для врагов, которые появятся после изменения (уже живые остаются как были);
//   «· волна»       — со следующей волны (расписание волны строится при её старте);
//   «· перезагрузка» — после перезагрузки страницы (пол, камера и игрок создаются один раз).
// Изменения сохраняются в браузере (см. config-storage.ts) и переживают перезагрузку.
// Кроме параметров конфига есть раздел «Волны (отладка)» — ручной запуск волны: это действие,
// а не настройка, поэтому оно не сохраняется и в «изменено: N» не считается (см. addWavePicker).
import GUI from 'lil-gui';
import { config, DEFAULT_CONFIG, type Config, type EnemyKindName } from './config';
import {
  applyChanges,
  clearSavedChanges,
  countChanges,
  formatChangesForCode,
  getChanges,
  saveChanges,
} from './config-storage';
import { ENEMY_KIND_NAMES } from './enemies';
import { SOUND_SETS, type Sound, type SoundType } from './sound';
import { WAVES } from './waves';

type ApplyMode = 'now' | 'newEnemies' | 'nextWave' | 'reload';

const APPLY_SUFFIXES: Record<ApplyMode, string> = {
  now: '',
  newEnemies: ' · новые',
  nextWave: ' · волна',
  reload: ' · перезагрузка',
};

// Имена числовых полей конфига, имена строковых (у нас это все цвета) и имена булевых
// (у нас это муты типов звука). Тип «отфильтрованных ключей»: для каждого поля оставляем его имя,
// если значение — число (строка, boolean), иначе never, и собираем объединение.
type NumberKey = { [Key in keyof Config]: Config[Key] extends number ? Key : never }[keyof Config];
type ColorKey = { [Key in keyof Config]: Config[Key] extends string ? Key : never }[keyof Config];
type BooleanKey = { [Key in keyof Config]: Config[Key] extends boolean ? Key : never }[keyof Config];

// Описание числового параметра для панели: подпись, допустимый диапазон, шаг ползунка и когда применяется.
type NumberSetting = {
  key: NumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  apply?: ApplyMode;
};

type Section = {
  title: string;
  settings: NumberSetting[];

  // Добавить в раздел вложенные папки с типами врагов.
  isWithEnemyKinds?: boolean;
};

const SECTIONS: Section[] = [
  {
    title: 'Арена и волны',
    settings: [
      { key: 'ARENA_SIZE', label: 'Размер арены, м', min: 12, max: 600, step: 1, apply: 'reload' },
      { key: 'SPAWN_RADIUS', label: 'Радиус спавна, м', min: 3, max: 28, step: 0.5 },
      { key: 'DEATH_WALL_HEIGHT', label: 'Высота границы, м', min: 0, max: 10, step: 0.1 },
      { key: 'DEATH_WALL_OPACITY', label: 'Непрозрачность границы', min: 0, max: 1, step: 0.05 },
      { key: 'DEATH_CEILING_HEIGHT', label: 'Потолок смерти, м', min: 2, max: 40, step: 0.5 },
      { key: 'ENEMY_COUNT_MULTIPLIER', label: 'Множитель врагов', min: 1, max: 1000, step: 1, apply: 'nextWave' },
      { key: 'SPAWN_PER_FRAME', label: 'Появлений за кадр', min: 0, max: 500, step: 10 },
      { key: 'DEFAULT_LINE_WIDTH', label: 'Ширина шеренги, м', min: 1, max: 20, step: 0.5, apply: 'nextWave' },
      { key: 'DEFAULT_CLUSTER_RADIUS', label: 'Радиус кучки, м', min: 0.5, max: 6, step: 0.1, apply: 'nextWave' },
      { key: 'SPAWN_GAP', label: 'Зазор при появлении, м', min: 0, max: 2, step: 0.05 },
    ],
  },
  {
    title: 'Игрок и стрельба',
    settings: [
      { key: 'PLAYER_SIZE', label: 'Размер игрока, м', min: 0.3, max: 3, step: 0.1, apply: 'reload' },
      { key: 'FIRE_INTERVAL', label: 'Пауза между выстрелами, с', min: 0.0001, max: 1, step: 0.01 },
      { key: 'PROJECTILE_COUNT', label: 'Снарядов за выстрел', min: 1, max: 20, step: 1 },
      { key: 'PROJECTILE_DAMAGE_MIN', label: 'Урон, мин', min: 1, max: 200, step: 1 },
      { key: 'PROJECTILE_DAMAGE_MAX', label: 'Урон, макс', min: 1, max: 200, step: 1 },
      { key: 'PROJECTILE_SPEED', label: 'Скорость пули, м/с', min: 2, max: 60, step: 0.5 },
      { key: 'PROJECTILE_MASS', label: 'Масса пули, кг', min: 0.01, max: 2, step: 0.01 },
      { key: 'PROJECTILE_SIZE', label: 'Размер пули, м', min: 0.05, max: 1, step: 0.05 },
      { key: 'PROJECTILE_AIM_OFFSET_UP', label: 'Прицел выше центра (доля)', min: 0, max: 1, step: 0.05 },
      { key: 'PROJECTILE_AIM_SPREAD', label: 'Разброс прицела (доля)', min: 0, max: 1, step: 0.05 },
      { key: 'PROJECTILE_LEAD', label: 'Упреждение (0–1)', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Враги',
    isWithEnemyKinds: true,
    settings: [
      { key: 'ENEMY_SPEED', label: 'Скорость, м/с', min: -100, max: 8, step: 0.1 },
      { key: 'ENEMY_ACCELERATION', label: 'Ускорение, м/с²', min: 0, max: 40, step: 0.5 },
      { key: 'ENEMY_TANGENTIAL_DAMPING', label: 'Гашение боковой скорости, 1/с', min: 0, max: 5, step: 0.1 },
    ],
  },
  {
    title: 'Физика',
    settings: [
      { key: 'GRAVITY', label: 'Гравитация, м/с²', min: 0, max: 30, step: 0.1 },
      { key: 'ENEMY_FRICTION', label: 'Трение врагов', min: 0, max: 2, step: 0.05, apply: 'newEnemies' },
      { key: 'ENEMY_RESTITUTION', label: 'Упругость врагов', min: 0, max: 1, step: 0.05, apply: 'newEnemies' },
      { key: 'ENEMY_LINEAR_DAMPING', label: 'Затухание полёта', min: 0, max: 5, step: 0.05, apply: 'newEnemies' },
      { key: 'ENEMY_ANGULAR_DAMPING', label: 'Затухание вращения', min: 0, max: 5, step: 0.05, apply: 'newEnemies' },
      { key: 'FALL_REMOVE_HEIGHT', label: 'Удалять призраков ниже, м', min: -50, max: -1, step: 1 },
    ],
  },
  {
    title: 'Призраки',
    settings: [
      { key: 'CORPSE_LIFETIME', label: 'Лежит, с', min: 0, max: 10, step: 0.1 },
      { key: 'CORPSE_SHRINK_DURATION', label: 'Сжимается, с', min: 0, max: 3, step: 0.05 },
      { key: 'CORPSE_OPACITY', label: 'Непрозрачность', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Полоска здоровья',
    settings: [
      { key: 'HP_BAR_WIDTH', label: 'Длина, м', min: 0.2, max: 3, step: 0.05, apply: 'newEnemies' },
      { key: 'HP_BAR_HEIGHT', label: 'Толщина, м', min: 0.02, max: 0.5, step: 0.01, apply: 'newEnemies' },
      { key: 'HP_BAR_GAP', label: 'Зазор над врагом, м', min: 0, max: 2, step: 0.05, apply: 'newEnemies' },
      { key: 'HP_BAR_BORDER', label: 'Рамка, м', min: 0, max: 0.2, step: 0.01, apply: 'newEnemies' },
    ],
  },
  {
    title: 'Цифры урона',
    settings: [
      { key: 'DAMAGE_NUMBER_DURATION', label: 'Время жизни, с', min: 0.1, max: 3, step: 0.05 },
      { key: 'DAMAGE_NUMBER_HEIGHT', label: 'Высота над полоской, м', min: 0, max: 2, step: 0.05 },
      { key: 'DAMAGE_NUMBER_RISE', label: 'Подъём, px', min: 0, max: 150, step: 1 },
      { key: 'DAMAGE_NUMBER_JITTER', label: 'Разброс вбок, px', min: 0, max: 60, step: 1 },
      { key: 'DAMAGE_NUMBER_FONT_SIZE', label: 'Размер шрифта, px', min: 8, max: 48, step: 1 },
    ],
  },
  {
    title: 'Искры',
    settings: [
      { key: 'SPARKS_COUNT', label: 'Искр на попадание', min: 0, max: 30, step: 1 },
      { key: 'SPARKS_LIFETIME', label: 'Время жизни, с', min: 0.05, max: 3, step: 0.05 },
      { key: 'SPARKS_SPEED', label: 'Скорость разлёта, м/с', min: 0, max: 30, step: 0.5 },
      { key: 'SPARKS_SPEED_SPREAD', label: 'Разброс скорости', min: 0, max: 1, step: 0.05 },
      { key: 'SPARKS_SIZE', label: 'Размер, м', min: 0.01, max: 0.5, step: 0.01 },
      { key: 'SPARKS_SHRINK', label: 'Сжимается к концу', min: 0, max: 1, step: 0.05 },
      { key: 'SPARKS_GRAVITY_SCALE', label: 'Гравитация (доля)', min: 0, max: 2, step: 0.05 },
      { key: 'SPARKS_DAMPING', label: 'Затухание скорости', min: 0, max: 10, step: 0.1 },
    ],
  },
];

const COLOR_SETTINGS: Array<{ key: ColorKey; label: string }> = [
  { key: 'BACKGROUND_COLOR', label: 'Фон' },
  { key: 'FLOOR_COLOR', label: 'Пол' },
  { key: 'PLAYER_COLOR', label: 'Игрок' },
  { key: 'PROJECTILE_COLOR', label: 'Пули' },
  { key: 'HP_BAR_FILL_COLOR', label: 'Полоска здоровья' },
  { key: 'HP_BAR_BACKGROUND_COLOR', label: 'Подложка полоски' },
  { key: 'DAMAGE_NUMBER_COLOR', label: 'Цифры урона' },
  { key: 'SPARKS_COLOR', label: 'Искры' },
  { key: 'CORPSE_COLOR', label: 'Призраки' },
  { key: 'DEATH_WALL_COLOR', label: 'Граница арены' },
];

// Названия типов врагов для папок панели. Record с ключом EnemyKindName: TypeScript проверит,
// что названы все типы из ENEMY_KINDS.
const KIND_TITLES: Record<EnemyKindName, string> = {
  tiny: 'Крошка',
  small: 'Мелкий',
  normal: 'Обычный',
  big: 'Крупный',
  brute: 'Громила',
};

const PANEL_TITLE = 'Настройки';
const PANEL_WIDTH = 340;

// Уже этой ширины (px) экран считаем узким: панель переезжает вниз. Экспортируем — переключатель скорости
// (speed-switch.ts) на узком экране поднимается над панелью.
export const NARROW_SCREEN_WIDTH = 700;

const COPY_LABEL = 'Скопировать изменения';
const COPIED_LABEL = 'Скопировано ✓';
const COPIED_LABEL_DURATION = 1500;

const LEGEND = `
  Без пометки — сразу. «· новые» — для новых врагов, «· волна» — со следующей волны,
  «· перезагрузка» — после перезагрузки страницы. Изменения сохраняются в этом браузере;
  перенести их в код — «${COPY_LABEL}» и вставить строки в src/config.ts.
`;

export type SettingsPanel = {
  // Проверка «событие произошло внутри панели?» — чтобы клик по панели не перезапускал игру.
  isPanelTarget: (target: EventTarget | null) => boolean;

  // Синхронизирует селект выбора волны с реально идущей волной (вызывается при старте каждой волны).
  setCurrentWave: (waveIndex: number) => void;
};

// Пояснение про пометки — первым элементом внутри панели. $children — контейнер её содержимого.
const addLegend = (gui: GUI): void => {
  const legend = document.createElement('div');
  legend.textContent = LEGEND.replace(/\s+/g, ' ').trim();
  legend.style.cssText = 'padding: 6px 8px; font-size: 11px; line-height: 1.4; opacity: 0.75;';
  gui.$children.prepend(legend);
};

// Папки «Типы врагов»: у каждого типа размер, масса, HP (для новых врагов) и цвет (сразу).
const addEnemyKinds = (folder: GUI): void => {
  for (const name of ENEMY_KIND_NAMES) {
    const kind = config.ENEMY_KINDS[name];
    const kindFolder = folder.addFolder(KIND_TITLES[name]);

    kindFolder.add(kind, 'size', 0.2, 3, 0.05).name(`Размер, м${APPLY_SUFFIXES.newEnemies}`);
    kindFolder.add(kind, 'mass', 0.05, 20, 0.05).name(`Масса, кг${APPLY_SUFFIXES.newEnemies}`);
    kindFolder.add(kind, 'hp', 1, 1000, 1).name(`HP${APPLY_SUFFIXES.newEnemies}`);
    kindFolder.addColor(kind, 'color').name('Цвет');
  }
};

// Раздел «Волны (отладка)»: ручной выбор волны. Выбранная волна запускается сразу (startGame в main.ts):
// арена чистится от врагов, снарядов и призраков, счётчики обнуляются. После этого волны идут как обычно,
// до самой последней — то есть из выбранной волны игра продолжается дальше по списку.
// Это действие, а не настройка: объект picked в конфиг не входит, поэтому не сохраняется в localStorage
// и не считается в «изменено: N».
// Возвращает функцию синхронизации: селект показывает текущую волну (вызывается из startWave в main.ts),
// иначе после автоматического перехода на следующую волну в селекте осталась бы старая.
const addWavePicker = (gui: GUI, onStartWave: (waveIndex: number) => void): ((waveIndex: number) => void) => {
  const folder = gui.addFolder('Волны (отладка)');
  const picked = { waveIndex: 0 };

  // Варианты селекта: подпись «N · название», значение — индекс в WAVES.
  const options: Record<string, number> = {};

  WAVES.forEach((wave, index): void => {
    options[`${index + 1} · ${wave.name}`] = index;
  });

  // Выбор волны запускает её сразу — иначе пришлось бы жать ещё и кнопку.
  const waveController = folder.add(picked, 'waveIndex', options).name('Волна');
  waveController.onChange((): void => onStartWave(picked.waveIndex));

  // Кнопка — перезапуск уже выбранной волны: селект не подаёт события, если выбрали текущее значение.
  const actions = {
    restart: (): void => onStartWave(picked.waveIndex),
  };

  folder.add(actions, 'restart').name('Перезапустить волну');

  return (waveIndex: number): void => {
    picked.waveIndex = waveIndex;
    waveController.updateDisplay();
  };
};

// Описание типа звука для раздела «Звук»: подпись папки и куда писать его громкость и мут в конфиге.
const SOUND_TYPE_SETTINGS: Array<{ type: SoundType; title: string; volumeKey: NumberKey; mutedKey: BooleanKey }> = [
  { type: 'hit', title: 'Попадание', volumeKey: 'HIT_VOLUME', mutedKey: 'HIT_MUTED' },
  { type: 'shot', title: 'Выстрел', volumeKey: 'SHOT_VOLUME', mutedKey: 'SHOT_MUTED' },
  { type: 'death', title: 'Смерть', volumeKey: 'DEATH_VOLUME', mutedKey: 'DEATH_MUTED' },
];

// Раздел «Звук»: общая громкость и на каждый тип — своя папка с тремя настройками:
// громкостью, чекбоксом «Выключить звук» (свой мут) и выбором набора звучания.
// Наборы — не параметры конфига, а состояние sound.ts (своя запись в localStorage), поэтому селект
// собирается вручную — так же, как и выбор волны в addWavePicker: он не считается в «изменено: N».
const addSoundSection = (gui: GUI, sound: Sound): void => {
  const folder = gui.addFolder('Звук');

  folder.add(config, 'SOUND_VOLUME', 0, 1, 0.05).name('Громкость (общая)');

  for (const { type, title, volumeKey, mutedKey } of SOUND_TYPE_SETTINGS) {
    const typeFolder = folder.addFolder(title);

    typeFolder.add(config, volumeKey, 0, 1, 0.05).name('Громкость');

    // Варианты селекта: подпись — название набора, значение — его id (см. SOUND_SETS в sound.ts).
    const picked = { set: sound.getSetId(type) };
    const options: Record<string, string> = {};

    for (const { id, title: setTitle } of SOUND_SETS[type]) {
      options[setTitle] = id;
    }

    const setController = typeFolder.add(picked, 'set', options).name('Набор');
    setController.onChange((): void => sound.setSetId(type, picked.set));

    typeFolder.add(config, mutedKey).name('Выключить звук');
  }
};

// Создаёт панель в правом верхнем углу. Свёрнута: видна только шапка, по клику раскрывается.
// onChange вызывается при каждом изменении — там игра применяет то, что не читается само (цвета, гравитация).
// onStartWave(index) — запустить волну с индексом index вручную (отладка, см. addWavePicker).
// sound — звук игры: раздел «Звук» читает и меняет его наборы (см. addSoundSection).
export const createSettingsPanel = ({
  onChange,
  onStartWave,
  sound,
}: {
  onChange: () => void;
  onStartWave: (waveIndex: number) => void;
  sound: Sound;
}): SettingsPanel => {
  // closeFolders — все разделы изначально свёрнуты, чтобы панель не занимала пол-экрана.
  // На узком экране (телефон) панель уже — чтобы между ней и краем оставался зазор.
  const gui = new GUI({ title: PANEL_TITLE, width: Math.min(PANEL_WIDTH, window.innerWidth - 32), closeFolders: true });

  // Подписи у нас длинные — отдаём им больше половины ширины строки (переменная из стилей lil-gui).
  gui.domElement.style.setProperty('--name-width', '55%');

  // На узком экране (телефон вертикально) панель почти во всю ширину и у верхнего края наезжала бы
  // на номер волны — прижимаем её к нижнему краю. Раскрытая, она растёт вверх.
  if (window.innerWidth < NARROW_SCREEN_WIDTH) {
    gui.domElement.style.top = 'auto';
    gui.domElement.style.bottom = '0';
  }

  addLegend(gui);

  // Сначала раздел отладки — он нужен чаще всего, чтобы не листать длинный список параметров.
  const setCurrentWave = addWavePicker(gui, onStartWave);

  for (const { title, settings, isWithEnemyKinds } of SECTIONS) {
    const folder = gui.addFolder(title);

    for (const { key, label, min, max, step, apply = 'now' } of settings) {
      folder.add(config, key, min, max, step).name(`${label}${APPLY_SUFFIXES[apply]}`);
    }

    if (isWithEnemyKinds) {
      addEnemyKinds(folder.addFolder('Типы врагов'));
    }
  }

  // Раздел «Звук» — не из SECTIONS: к числам и чекбоксам добавлены селекты наборов (см. выше).
  addSoundSection(gui, sound);

  const colorsFolder = gui.addFolder('Цвета');

  for (const { key, label } of COLOR_SETTINGS) {
    colorsFolder.addColor(config, key).name(label);
  }

  // В шапке — сколько параметров отличается от значений в коде.
  const updateTitle = (): void => {
    const changesCount = countChanges(getChanges(config, DEFAULT_CONFIG));

    gui.title(changesCount > 0 ? `${PANEL_TITLE} · изменено: ${changesCount}` : PANEL_TITLE);
  };

  // Кнопки панели: в lil-gui кнопка — это поле-функция объекта, по клику она вызывается.
  const actions = {
    // Текст изменений в формате config.ts. Буфер обмена доступен только на https и localhost;
    // если не получилось — показываем текст в окне, откуда его можно скопировать руками.
    copy: (): void => {
      const text = formatChangesForCode(getChanges(config, DEFAULT_CONFIG), config);

      const showText = (): void => {
        window.prompt('Скопируй и вставь строки в src/config.ts:', text);
      };

      if (!window.isSecureContext) {
        showText();

        return;
      }

      navigator.clipboard
        .writeText(text)
        .then((): void => {
          copyButton.name(COPIED_LABEL);
          setTimeout((): void => {
            copyButton.name(COPY_LABEL);
          }, COPIED_LABEL_DURATION);
        })
        .catch(showText);
    },

    // Всё как в коде: стираем сохранённые изменения и переписываем рабочий конфиг значениями из DEFAULT_CONFIG.
    // updateDisplay — ползунки сами не знают, что значения поменяли не через них.
    reset: (): void => {
      clearSavedChanges();
      applyChanges(config, DEFAULT_CONFIG);

      for (const controller of gui.controllersRecursive()) {
        controller.updateDisplay();
      }

      updateTitle();
      onChange();
    },

    reload: (): void => {
      window.location.reload();
    },
  };

  const copyButton = gui.add(actions, 'copy').name(COPY_LABEL);
  gui.add(actions, 'reset').name('Сбросить всё');
  gui.add(actions, 'reload').name('Перезагрузить страницу');

  // onChange срабатывает на каждое изменение — в том числе на каждое движение ползунка.
  // Сразу применяем и сохраняем: изменений немного, запись в localStorage мгновенная.
  // (У lil-gui есть и onFinishChange, но для выбора цвета он срабатывает, только когда поле теряет фокус,
  // и цвет, выбранный прямо перед перезагрузкой страницы, не сохранился бы.)
  gui.onChange((): void => {
    onChange();
    saveChanges(getChanges(config, DEFAULT_CONFIG));
    updateTitle();
  });

  updateTitle();
  gui.close();

  return {
    isPanelTarget: (target: EventTarget | null): boolean => target instanceof Node && gui.domElement.contains(target),
    setCurrentWave,
  };
};
