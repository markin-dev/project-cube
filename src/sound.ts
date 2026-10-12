// Звук игры. Всё синтезируется Web Audio прямо в браузере: ассетов нет, бандл не растёт.
//
// Звуков три типа (см. SoundType): попадание снаряда в живого врага, выстрел куба и гибель врага.
// У каждого типа 5 наборов (см. SETS_BY_TYPE): у набора свой характер звука и свои 6 похожих,
// но не одинаковых вариантов. Набор выбирается в панели настроек (раздел «Звук»), выбор
// сохраняется в браузере. Внутри набора при каждом событии берётся случайный вариант, который
// никогда не повторяет предыдущий подряд, и играет с немного другой скоростью — серия звуков
// не «залипает» в один сэмпл.
//
// Выстрелы и смерти бывают частыми и массовыми, поэтому синтезируются тише попаданий (уровни
// в таблицах наборов + громкости SHOT_VOLUME/DEATH_VOLUME). У каждого типа есть минимальная пауза
// между звуками (MIN_GAP_MS) — поток не сливается в кашу.
//
// Громкость у каждого типа своя (HIT_VOLUME/SHOT_VOLUME/DEATH_VOLUME) плюс общая (SOUND_VOLUME)
// и общий мут (кнопка 🔇 рядом со скоростью); у каждого типа есть и свой мут (HIT_MUTED и т.д.).
// Всё это — параметры конфига, их меняет панель настроек.
//
// Варианты рисуются офлайн-рендером один раз при старте: OfflineAudioContext считает звук быстрее
// реального времени и не привязан к воспроизведению.
//
// Контекст Web Audio создаётся при загрузке, но браузер держит его на паузе до первого жеста
// (правило autoplay): разблокируем по первому клику или нажатию. До этого звуки просто
// не звучат — молча, без ошибок.
import { config } from './config';
import { isRecord } from './config-storage';

// Частота, на которой рисуем варианты. 44100 — стандартная частота CD, браузер сам приведёт
// к частоте своего контекста при воспроизведении.
const SAMPLE_RATE = 44100;

// Сколько похожих вариантов в каждом наборе. Каждый — со своими случайными параметрами.
const VARIANTS = 6;

// Состояние «звук выключен» и «выбранные наборы» переживают перезагрузку страницы.
const MUTED_STORAGE_KEY = 'project-cube:muted';

// Выбранные наборы — одним объектом { hit: 'brick', shot: 'click', death: 'pop' }.
const SETS_STORAGE_KEY = 'project-cube:sound-sets';

// Случайное число в диапазоне — универсальный источник «непохожести» вариантов.
const rnd = (min: number, max: number): number => min + Math.random() * (max - min);

// ─── СИНТЕЗ ИЗ ЭЛЕМЕНТОВ ─────────────────────────────────────────────────────
// Каждый набор собирается из одних и тех же деталей: «тон» (осциллятор) и «шум» (белый шум
// через фильтр). Разные параметры — разный характер звука.

type ToneParams = {
  // Форма волны: sine — гладкий тон, triangle — плотнее, sawtooth/square — «заряженные», резкие.
  type: OscillatorType;

  // Начальная частота, Гц.
  frequency: number;

  // Во сколько раз частота падает к концу. 1 — частота постоянна (звук «звонит»).
  drop?: number;

  // За какое время частота успевает упасть, с. По умолчанию — быстрый скат в начале звука.
  dropTime?: number;

  // Сколько звук длится, с.
  length: number;

  // Пиковая громкость (0–1). Сумма пиков всех деталей не должна превышать 1 — иначе обрежется.
  level: number;

  // Смещение по времени, с: 0 — звук начинается сразу.
  delay?: number;
};

const addTone = (
  offline: OfflineAudioContext,
  { type, frequency, drop = 1, dropTime, length, level, delay = 0 }: ToneParams,
): void => {
  const oscillator = offline.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, delay);

  if (drop !== 1) {
    oscillator.frequency.exponentialRampToValueAtTime(frequency * drop, delay + (dropTime ?? Math.min(length, 0.08)));
  }

  // Громкость по «экспоненте»: быстрый разгон с 0.0001 (у нуля экспонента не определена,
  // поэтому начинаем с крошечного значения) и плавное затухание.
  const gain = offline.createGain();
  gain.gain.setValueAtTime(0.0001, delay);
  gain.gain.exponentialRampToValueAtTime(level, delay + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, delay + length);

  oscillator.connect(gain).connect(offline.destination);
  oscillator.start(delay);
  oscillator.stop(delay + length + 0.01);
};

type NoiseParams = {
  // Тип фильтра: lowpass — глухо, highpass — звонко, bandpass — узкая полоса («сыпь»).
  filter: BiquadFilterType;

  // Частота среза/центра полосы, Гц.
  frequency: number;

  // Резкость полосового фильтра (только для bandpass и похожих).
  q?: number;

  length: number;
  level: number;
  delay?: number;
};

const addNoise = (offline: OfflineAudioContext, { filter, frequency, q = 1, length, level, delay = 0 }: NoiseParams): void => {
  const source = offline.createBufferSource();
  const buffer = offline.createBuffer(1, Math.ceil(offline.sampleRate * (delay + length + 0.01)), offline.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < data.length; index++) {
    data[index] = Math.random() * 2 - 1;
  }

  source.buffer = buffer;

  const biquad = offline.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.value = frequency;
  biquad.Q.value = q;

  const gain = offline.createGain();
  gain.gain.setValueAtTime(0.0001, delay);
  gain.gain.exponentialRampToValueAtTime(level, delay + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, delay + length);

  source.connect(biquad).connect(gain).connect(offline.destination);
  source.start(delay);
};

// ─── ТИПЫ ЗВУКОВ ──────────────────────────────────────────────────────────────

export type SoundType = 'hit' | 'shot' | 'death';

const TYPES: SoundType[] = ['hit', 'shot', 'death'];

// Ключи конфига: громкость и мут каждого типа. Ключи — литеральные: если поле в config.ts
// переименуют, TypeScript укажет на эту строку.
const VOLUME_KEYS: Record<SoundType, 'HIT_VOLUME' | 'SHOT_VOLUME' | 'DEATH_VOLUME'> = {
  hit: 'HIT_VOLUME',
  shot: 'SHOT_VOLUME',
  death: 'DEATH_VOLUME',
};

const MUTED_KEYS: Record<SoundType, 'HIT_MUTED' | 'SHOT_MUTED' | 'DEATH_MUTED'> = {
  hit: 'HIT_MUTED',
  shot: 'SHOT_MUTED',
  death: 'DEATH_MUTED',
};

// Минимальная пауза между звуками одного типа, мс: частый поток не сливается в кашу и не клиппует.
// Попадания приходят пачками при залпе из нескольких снарядов и на ускорении; при обычном темпе
// (раз в FIRE_INTERVAL = 100 мс) пауза в 30 мс их не трогает. Смерти бывают массовыми, выстрелы — частыми.
const MIN_GAP_MS: Record<SoundType, number> = { hit: 30, shot: 50, death: 70 };

// ─── НАБОРЫ ЗВУКОВ ───────────────────────────────────────────────────────────

type SoundSet = {
  // Ключ для сохранения выбора в браузере.
  id: string;

  // Подпись в селекте панели настроек.
  title: string;

  // Длина варианта, с. Должна быть не меньше, чем звучат все детали.
  duration: number;

  // Собирает один вариант звука в офлайн-контексте. Вызывается несколько раз подряд,
  // параметры вида rnd(...) берутся заново — отсюда «похожие, но не одинаковые».
  render: (offline: OfflineAudioContext) => void;
};

const HIT_SETS: SoundSet[] = [
  {
    id: 'metal',
    title: 'Металл',
    duration: 0.3,
    render: (offline): void => {
      // Два затухающих звона разной высоты и короткая металлическая атака шумом.
      addTone(offline, { type: 'sine', frequency: rnd(1300, 2400), length: rnd(0.18, 0.3), level: 0.3 });
      addTone(offline, { type: 'sine', frequency: rnd(2800, 4500), length: rnd(0.08, 0.16), level: 0.18 });
      addNoise(offline, { filter: 'highpass', frequency: rnd(4000, 8000), length: rnd(0.015, 0.03), level: 0.35 });
    },
  },
  {
    id: 'wood',
    title: 'Дерево',
    duration: 0.18,
    render: (offline): void => {
      // Глухой деревянный удар: низкий тон со скатом частоты, короткий «щелчок» и шум в серединних частотах.
      addTone(offline, { type: 'sine', frequency: rnd(220, 420), drop: 0.5, length: rnd(0.06, 0.12), level: 0.5 });
      addTone(offline, { type: 'sine', frequency: rnd(600, 950), drop: 0.6, length: rnd(0.03, 0.05), level: 0.15 });
      addNoise(offline, {
        filter: 'bandpass',
        frequency: rnd(900, 2200),
        q: rnd(2, 5),
        length: rnd(0.02, 0.05),
        level: 0.25,
      });
    },
  },
  {
    id: 'brick',
    title: 'Кирпич',
    duration: 0.2,
    render: (offline): void => {
      // Тяжёлый глухой удар: почти низкие частоты и приглушённый шум. Ближе всего к тому звуку,
      // что был до наборов — поэтому набор по умолчанию.
      addTone(offline, { type: 'sine', frequency: rnd(110, 200), drop: 0.45, length: rnd(0.07, 0.13), level: 0.6 });
      addNoise(offline, { filter: 'lowpass', frequency: rnd(700, 1600), q: 0.7, length: rnd(0.03, 0.06), level: 0.35 });
    },
  },
  {
    id: 'glass',
    title: 'Стекло',
    duration: 0.25,
    render: (offline): void => {
      // Звонкое «цык»: два высоких тона без ската и звонкая атака шумом.
      addTone(offline, { type: 'sine', frequency: rnd(2200, 3600), length: rnd(0.12, 0.25), level: 0.3 });
      addTone(offline, { type: 'sine', frequency: rnd(3300, 5200), length: rnd(0.06, 0.12), level: 0.15 });
      addNoise(offline, { filter: 'highpass', frequency: rnd(5000, 9000), length: rnd(0.01, 0.02), level: 0.4 });
    },
  },
  {
    id: 'electric',
    title: 'Электро',
    duration: 0.16,
    render: (offline): void => {
      // «Бзик»: пила с быстрым скатом частоты вниз, квадратная гармоника и шум.
      addTone(offline, { type: 'sawtooth', frequency: rnd(900, 1800), drop: 0.25, length: rnd(0.08, 0.14), level: 0.35 });
      addTone(offline, {
        type: 'square',
        frequency: rnd(2000, 3500),
        drop: 0.3,
        dropTime: 0.03,
        length: rnd(0.04, 0.08),
        level: 0.18,
      });
      addNoise(offline, { filter: 'highpass', frequency: rnd(2500, 6000), length: rnd(0.02, 0.04), level: 0.3 });
    },
  },
];

// Выстрелы: короткие (≤ 0.1 с) и тихие — сумма пиков набора ≤ 0.3 против ~0.95 у попаданий.
// Звучат каждый FIRE_INTERVAL секунд, поэтому даже при общей громкости 0.5 они заметно тише «тук».
const SHOT_SETS: SoundSet[] = [
  {
    id: 'click',
    title: 'Щелчок',
    duration: 0.1,
    render: (offline): void => {
      // Сухой щелчок механизма: узкая полоса шума и почти неслышный низкий «подхлоп».
      addNoise(offline, {
        filter: 'bandpass',
        frequency: rnd(2500, 4500),
        q: rnd(1, 2.5),
        length: rnd(0.012, 0.025),
        level: 0.16,
      });
      addTone(offline, { type: 'sine', frequency: rnd(200, 320), drop: 0.45, length: rnd(0.03, 0.05), level: 0.1 });
    },
  },
  {
    id: 'air',
    title: 'Пневма',
    duration: 0.12,
    render: (offline): void => {
      // Выдох сжатого воздуха: тон, оседающий вниз, и приглушённый шум.
      addTone(offline, { type: 'sine', frequency: rnd(450, 650), drop: 0.3, length: rnd(0.05, 0.08), level: 0.14 });
      addNoise(offline, { filter: 'lowpass', frequency: rnd(1200, 2200), q: 0.7, length: rnd(0.03, 0.05), level: 0.12 });
    },
  },
  {
    id: 'saw',
    title: 'Пила',
    duration: 0.12,
    render: (offline): void => {
      // «Заряженный» короткий разряд: пила со скатом частоты и звонкая атака.
      addTone(offline, { type: 'sawtooth', frequency: rnd(300, 420), drop: 0.35, length: rnd(0.05, 0.08), level: 0.12 });
      addNoise(offline, { filter: 'highpass', frequency: rnd(3000, 6000), length: rnd(0.01, 0.02), level: 0.12 });
    },
  },
  {
    id: 'whistle',
    title: 'Свист',
    duration: 0.12,
    render: (offline): void => {
      // Свистящая пуля: треугольник, скатывающийся вдвое, и узкая полоса шума.
      addTone(offline, { type: 'triangle', frequency: rnd(1000, 1400), drop: 0.5, length: rnd(0.05, 0.09), level: 0.12 });
      addNoise(offline, {
        filter: 'bandpass',
        frequency: rnd(2500, 4000),
        q: rnd(2, 4),
        length: rnd(0.015, 0.03),
        level: 0.12,
      });
    },
  },
  {
    id: 'laser',
    title: 'Лазер',
    duration: 0.12,
    render: (offline): void => {
      // «Пиу»: квадрат с быстрым скатом вниз и лёгкое шипение.
      addTone(offline, {
        type: 'square',
        frequency: rnd(700, 1000),
        drop: 0.25,
        dropTime: 0.04,
        length: rnd(0.06, 0.09),
        level: 0.1,
      });
      addNoise(offline, { filter: 'highpass', frequency: rnd(4000, 7000), length: rnd(0.01, 0.02), level: 0.12 });
    },
  },
];

// Смерти: мягкие, умеренно длинные (≤ 0.35 с), сумма пиков ≤ ~0.5 — против ~0.95 у попаданий.
// Гибель врага должна ощущаться, но не перекрывать выстрелы, когда волну добивают пачками.
const DEATH_SETS: SoundSet[] = [
  {
    id: 'pop',
    title: 'Хлопок',
    duration: 0.25,
    render: (offline): void => {
      // Мягкий глухой хлопок: шумовой всплеск и низкий тон, скатывающийся вниз.
      addNoise(offline, { filter: 'lowpass', frequency: rnd(900, 1600), q: 0.7, length: rnd(0.04, 0.07), level: 0.25 });
      addTone(offline, { type: 'sine', frequency: rnd(150, 220), drop: 0.35, length: rnd(0.08, 0.14), level: 0.2 });
    },
  },
  {
    id: 'debris',
    title: 'Осколки',
    duration: 0.3,
    render: (offline): void => {
      // Куб рассыпался: 2–4 коротких осколка с случайными задержками + тихий низ.
      const fragments = 2 + Math.floor(rnd(0, 3));

      for (let index = 0; index < fragments; index++) {
        addNoise(offline, {
          filter: 'bandpass',
          frequency: rnd(1500, 4500),
          q: rnd(2, 6),
          length: rnd(0.01, 0.03),
          level: 0.14,
          delay: rnd(0, 0.12),
        });
      }

      addTone(offline, { type: 'sine', frequency: rnd(120, 180), drop: 0.4, length: rnd(0.08, 0.13), level: 0.18 });
    },
  },
  {
    id: 'drone',
    title: 'Гул',
    duration: 0.35,
    render: (offline): void => {
      // Затихающий гул: длинный низкий тон и почти неслышный шумовой хвост.
      addTone(offline, {
        type: 'sine',
        frequency: rnd(90, 130),
        drop: 0.5,
        dropTime: 0.15,
        length: rnd(0.2, 0.3),
        level: 0.28,
      });
      addNoise(offline, { filter: 'lowpass', frequency: rnd(500, 900), q: 0.7, length: rnd(0.05, 0.1), level: 0.12 });
    },
  },
  {
    id: 'ring',
    title: 'Звон',
    duration: 0.3,
    render: (offline): void => {
      // Тихий звон умеренной высоты (звонкого «Металла» у смерти нет — он был бы резким)
      // и мягкая атака шумом.
      addTone(offline, { type: 'sine', frequency: rnd(1400, 2100), length: rnd(0.15, 0.25), level: 0.16 });
      addTone(offline, { type: 'sine', frequency: rnd(2400, 3400), length: rnd(0.08, 0.14), level: 0.09 });
      addNoise(offline, { filter: 'highpass', frequency: rnd(3500, 6500), length: rnd(0.01, 0.02), level: 0.2 });
    },
  },
  {
    id: 'blob',
    title: 'Пузырь',
    duration: 0.25,
    render: (offline): void => {
      // Мягкое «блип»: тон, быстро оседающий вниз, и широкий шумовой бульк.
      addTone(offline, { type: 'sine', frequency: rnd(600, 850), drop: 0.3, length: rnd(0.1, 0.16), level: 0.2 });
      addNoise(offline, {
        filter: 'bandpass',
        frequency: rnd(600, 1000),
        q: rnd(3, 6),
        length: rnd(0.03, 0.06),
        level: 0.15,
      });
    },
  },
];

const SETS_BY_TYPE: Record<SoundType, SoundSet[]> = {
  hit: HIT_SETS,
  shot: SHOT_SETS,
  death: DEATH_SETS,
};

// Наборы по умолчанию: «Кирпич» — ближе к тому звуку, что был до наборов.
const DEFAULT_SET_IDS: Record<SoundType, string> = { hit: 'brick', shot: 'click', death: 'pop' };

// Список наборов для селектов панели настроек: только подписи, рендер — внутреннее дело.
export const SOUND_SETS: Record<SoundType, Array<Pick<SoundSet, 'id' | 'title'>>> = {
  hit: HIT_SETS.map(({ id, title }) => ({ id, title })),
  shot: SHOT_SETS.map(({ id, title }) => ({ id, title })),
  death: DEATH_SETS.map(({ id, title }) => ({ id, title })),
};

// Ключ готового набора в кэше: «тип/набор».
const setKey = (type: SoundType, setId: string): string => `${type}:${setId}`;

// Рисует один вариант набора: офлайн-контекст нужной длины + синтез самого набора.
const renderVariant = (set: SoundSet): Promise<AudioBuffer> => {
  const offline = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * set.duration), SAMPLE_RATE);

  set.render(offline);

  return offline.startRendering();
};

const renderSet = (set: SoundSet): Promise<AudioBuffer[]> =>
  Promise.all(Array.from({ length: VARIANTS }, () => renderVariant(set)));

export type Sound = {
  // Проиграть звук попадания снаряда в живого врага.
  playHit: () => void;

  // Проиграть звук выстрела куба.
  playShot: () => void;

  // Проиграть звук гибели врага (пуля добила или он покинул арену).
  playDeath: () => void;

  // Общий мут (кнопка 🔇 рядом со скоростью).
  isMuted: () => boolean;
  setMuted: (isMuted: boolean) => void;

  // Текущий набор типа — по нему селект в панели показывает выбранный.
  getSetId: (type: SoundType) => string;

  // Переключает набор и запоминает выбор. Неизвестный id молча игнорируется.
  setSetId: (type: SoundType, setId: string) => void;

  // Перечитывает громкости из config — вызывается из applyLiveConfig, когда ползунок в панели изменился.
  // (Муты типов не нужны: они читаются в момент воспроизведения.)
  applyVolume: () => void;
};

export const createSound = (): Sound => {
  const context = new AudioContext();

  // Цепочка: источник → гейн своего типа → master → динамики.
  // master — общий регулятор: общая громкость и общий мут действуют и на уже играющие звуки.
  // Гейн типа — своя громкость каждого звука (плюс при желании обнулить её ползунком).
  const master = context.createGain();
  master.connect(context.destination);

  const typeGains: Record<SoundType, GainNode> = {
    hit: context.createGain(),
    shot: context.createGain(),
    death: context.createGain(),
  };

  typeGains.hit.connect(master);
  typeGains.shot.connect(master);
  typeGains.death.connect(master);

  let isMuted = false;
  const setIds: Record<SoundType, string> = { ...DEFAULT_SET_IDS };

  try {
    isMuted = localStorage.getItem(MUTED_STORAGE_KEY) === '1';

    const saved: unknown = JSON.parse(localStorage.getItem(SETS_STORAGE_KEY) ?? '{}');

    if (isRecord(saved)) {
      for (const type of TYPES) {
        const value = saved[type];

        // Набор из старой версии (id больше не существует) молча отбрасываем — останется умолчание.
        if (typeof value === 'string' && SETS_BY_TYPE[type].some((set) => set.id === value)) {
          setIds[type] = value;
        }
      }
    }
  } catch {
    // Браузер запретил localStorage — просто начинаем со значений по умолчанию.
  }

  // Готовые варианты: «тип/набор» → его звуки. Появляются асинхронно, пока их нет — тип молчит.
  const variantsByKey = new Map<string, AudioBuffer[]>();

  // Индексы предыдущих вариантов — чтобы два звука одного типа подряд не совпали.
  const lastVariantIndexes: Record<SoundType, number> = { hit: -1, shot: -1, death: -1 };

  // Когда последний раз звучал каждый тип — для пауз из MIN_GAP_MS.
  const lastPlayedAt: Record<SoundType, number> = { hit: 0, shot: 0, death: 0 };

  const applyVolume = (): void => {
    master.gain.value = isMuted ? 0 : config.SOUND_VOLUME;

    for (const type of TYPES) {
      typeGains[type].gain.value = config[VOLUME_KEYS[type]];
    }
  };

  // Разблокировка контекста: браузер запускает звук только после жеста пользователя.
  const unlock = (): void => {
    if (context.state !== 'running') {
      context.resume().catch((): void => {
        // Не получилось — звук запустится после следующего жеста, игра это не трогает.
      });
    }
  };

  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // Офлайн-рендер всех наборов: 3 типа × 5 наборов × 6 вариантов = 90 буферов (~4 МБ RAM).
  // Рендер асинхронный и быстрее реального времени — при старте он не задерживает.
  for (const type of TYPES) {
    for (const set of SETS_BY_TYPE[type]) {
      renderSet(set)
        .then((buffers: AudioBuffer[]): void => {
          variantsByKey.set(setKey(type, set.id), buffers);
        })
        .catch((): void => {
          // Офлайн-рендер не удался (старый браузер) — этот набор звучать не будет, игра работает.
        });
    }
  }

  applyVolume();

  const play = (type: SoundType): void => {
    // Мут типа читается в момент события: чекбокс в панели действует сразу, без перерисовки.
    if (isMuted || config[MUTED_KEYS[type]]) {
      return;
    }

    // Пауза между звуками одного типа — см. MIN_GAP_MS.
    if (performance.now() - lastPlayedAt[type] < MIN_GAP_MS[type]) {
      return;
    }

    const variants = variantsByKey.get(setKey(type, setIds[type])) ?? [];

    if (variants.length === 0) {
      return;
    }

    // Контекст ещё не разблокирован — не запускаем, иначе накопленные звуки сыграют разом
    // после первого клика. Вызов unlock тут же: после жеста звук заработает.
    if (context.state !== 'running') {
      unlock();

      return;
    }

    let variantIndex = Math.floor(Math.random() * variants.length);

    // Не повторяем предыдущий вариант подряд: подряд идущие одинаковые звуки слышно.
    if (variantIndex === lastVariantIndexes[type] && variants.length > 1) {
      variantIndex = (variantIndex + 1) % variants.length;
    }

    lastVariantIndexes[type] = variantIndex;
    lastPlayedAt[type] = performance.now();

    const source = context.createBufferSource();
    source.buffer = variants[variantIndex];

    // Небольшой разброс скорости — даже один и тот же вариант в серии звуков
    // не звучит как строчка из одного сэмпла.
    source.playbackRate.value = rnd(0.94, 1.06);
    source.connect(typeGains[type]);
    source.start();
  };

  return {
    playHit: (): void => play('hit'),
    playShot: (): void => play('shot'),
    playDeath: (): void => play('death'),

    isMuted: (): boolean => isMuted,

    setMuted: (value: boolean): void => {
      isMuted = value;
      applyVolume();

      try {
        localStorage.setItem(MUTED_STORAGE_KEY, value ? '1' : '0');
      } catch {
        // Нечего сохранять: выбор просто не переживёт перезагрузку.
      }
    },

    getSetId: (type: SoundType): string => setIds[type],

    setSetId: (type: SoundType, value: string): void => {
      if (!SETS_BY_TYPE[type].some((set) => set.id === value)) {
        return;
      }

      setIds[type] = value;

      // Счётчик вариантов обнуляем: в новом наборе свои — «не повторять предыдущий» начинается заново.
      lastVariantIndexes[type] = -1;

      try {
        localStorage.setItem(SETS_STORAGE_KEY, JSON.stringify(setIds));
      } catch {
        // Выбор наборов просто не переживёт перезагрузку.
      }
    },

    applyVolume,
  };
};
