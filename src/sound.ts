// Звук игры. Всё синтезируется Web Audio прямо в браузере: ассетов нет, бандл не растёт.
//
// Звук попадания — это 5 наборов (см. HIT_SETS): у каждого свой характер (металл, дерево, кирпич,
// стекло, электричество) и свои 6 похожих, но не одинаковых вариантов. Набор выбирается кнопками
// рядом с мутом (sound-switch.ts), выбор сохраняется в браузере. Внутри набора при каждом попадании
// берётся случайный вариант, который никогда не повторяет предыдущий подряд, и играет с немного
// другой скоростью — серия попаданий не «залипает» в один сэмпл.
//
// Варианты рисуются офлайн-рендером один раз при старте: OfflineAudioContext считает звук быстрее
// реального времени и не привязан к воспроизведению.
//
// Контекст Web Audio создаётся при загрузке, но браузер держит его на паузе до первого жеста
// (правило autoplay): разблокируем по первому клику или нажатию. До этого попадания просто
// не звучат — молча, без ошибок.
import { config } from './config';

// Частота, на которой рисуем варианты. 44100 — стандартная частота CD, браузер сам приведёт
// к частоте своего контекста при воспроизведении.
const SAMPLE_RATE = 44100;

// Сколько похожих вариантов в каждом наборе. Каждый — со своими случайными параметрами.
const HIT_VARIANTS = 6;

// Состояние «звук выключен» и «выбранный набор» переживают перезагрузку страницы.
const MUTED_STORAGE_KEY = 'project-animal:muted';
const SET_STORAGE_KEY = 'project-animal:sound-set';

// Набор, который звучит, пока пользователь не выбрал другой.
const DEFAULT_SET_ID = 'brick';

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

// ─── НАБОРЫ ЗВУКОВ ───────────────────────────────────────────────────────────

type SoundSet = {
  // Ключ для сохранения выбора в браузере.
  id: string;

  // Подпись на кнопке переключения.
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

// Список наборов для кнопок переключения (sound-switch.ts): только подписи, рендер — внутреннее дело.
export const SOUND_SETS: Array<Pick<SoundSet, 'id' | 'title'>> = HIT_SETS.map(({ id, title }) => ({ id, title }));

// Рисует один вариант набора: офлайн-контекст нужной длины + синтез самого набора.
const renderHitVariant = (set: SoundSet): Promise<AudioBuffer> => {
  const offline = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * set.duration), SAMPLE_RATE);

  set.render(offline);

  return offline.startRendering();
};

const renderHitSet = (set: SoundSet): Promise<AudioBuffer[]> =>
  Promise.all(Array.from({ length: HIT_VARIANTS }, () => renderHitVariant(set)));

export type Sound = {
  // Проиграть звук попадания снаряда в живого врага.
  playHit: () => void;

  isMuted: () => boolean;

  // Включает/выключает звук и запоминает выбор в браузере.
  setMuted: (isMuted: boolean) => void;

  // Текущий набор звуков (его id) — по нему кнопки подсвечивают выбранный.
  getSetId: () => string;

  // Переключает набор и запоминает выбор. Неизвестный id молча игнорируется.
  setSetId: (setId: string) => void;

  // Перечитывает громкость из config — вызывается из applyLiveConfig, когда ползунок в панели изменился.
  applyVolume: () => void;
};

export const createSound = (): Sound => {
  const context = new AudioContext();

  // master — общий регулятор громкости: мут и ползунок SOUND_VOLUME работают на уже играющие звуки тоже.
  const master = context.createGain();
  master.connect(context.destination);

  let isMuted = false;
  let setId = DEFAULT_SET_ID;

  try {
    isMuted = localStorage.getItem(MUTED_STORAGE_KEY) === '1';

    const savedSet = localStorage.getItem(SET_STORAGE_KEY);

    if (savedSet && HIT_SETS.some((set) => set.id === savedSet)) {
      setId = savedSet;
    }
  } catch {
    // Браузер запретил localStorage — просто начинаем со значений по умолчанию.
  }

  // Готовые варианты: набор → его звуки. Появляются асинхронно, пока их нет — попадания молчат.
  const variantsBySet = new Map<string, AudioBuffer[]>();

  // Индекс предыдущего варианта, чтобы два звука подряд не совпали.
  let lastVariantIndex = -1;

  const applyVolume = (): void => {
    master.gain.value = isMuted ? 0 : config.SOUND_VOLUME;
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

  for (const set of HIT_SETS) {
    renderHitSet(set)
      .then((buffers: AudioBuffer[]): void => {
        variantsBySet.set(set.id, buffers);
      })
      .catch((): void => {
        // Офлайн-рендер не удался (старый браузер) — этот набор звучать не будет, игра работает.
      });
  }

  applyVolume();

  return {
    playHit: (): void => {
      if (isMuted) {
        return;
      }

      const variants = variantsBySet.get(setId) ?? [];

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
      if (variantIndex === lastVariantIndex && variants.length > 1) {
        variantIndex = (variantIndex + 1) % variants.length;
      }

      lastVariantIndex = variantIndex;

      const source = context.createBufferSource();
      source.buffer = variants[variantIndex];

      // Небольшой разброс скорости — даже один и тот же вариант в серии попаданий
      // не звучит как строчка из одного сэмпла.
      source.playbackRate.value = rnd(0.94, 1.06);
      source.connect(master);
      source.start();
    },

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

    getSetId: (): string => setId,

    setSetId: (value: string): void => {
      if (!HIT_SETS.some((set) => set.id === value)) {
        return;
      }

      setId = value;

      // Счётчик вариантов обнуляем: в новом наборе свои — «не повторять предыдущий» начинается заново.
      lastVariantIndex = -1;

      try {
        localStorage.setItem(SET_STORAGE_KEY, value);
      } catch {
        // Выбор набора просто не переживёт перезагрузку.
      }
    },

    applyVolume,
  };
};
