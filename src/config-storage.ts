// Хранение изменений конфига, сделанных в панели настроек.
//
// В localStorage браузера лежат только ОТЛИЧИЯ от значений из кода (DEFAULT_CONFIG), а не весь конфиг:
// если поправить число в config.ts, оно применится — если только этот же параметр не меняли в панели.
// localStorage у каждого браузера свой, поэтому удачные значения стоит перенести в config.ts
// (кнопка «Скопировать изменения» в панели).
//
// Модуль не знает, какие именно поля есть в конфиге: работает с любым объектом из чисел, строк
// и вложенных объектов (как ENEMY_KINDS). Поэтому он не импортирует config.ts, а получает объекты параметрами.

const STORAGE_KEY = 'project-animal:config-changes';

// Числа сравниваем с допуском: ползунок может вернуть 0.30000000000000004 вместо 0.3.
const NUMBER_TOLERANCE = 1e-9;

type Values = Record<string, unknown>;

// Проверка «это обычный объект с полями?» (не null и не массив).
// Запись `value is Values` сообщает TypeScript: если проверка прошла, value — объект с полями.
export const isRecord = (value: unknown): value is Values =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSameValue = (first: unknown, second: unknown): boolean =>
  typeof first === 'number' && typeof second === 'number'
    ? Math.abs(first - second) < NUMBER_TOLERANCE
    : first === second;

// Читает сохранённые изменения. Если их нет, они повреждены или браузер запретил доступ
// к localStorage (например, в приватном режиме), — возвращает пустой объект: игра пойдёт с конфигом из кода.
export const readSavedChanges = (): Values => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');

    return isRecord(saved) ? saved : {};
  } catch {
    return {};
  }
};

export const saveChanges = (changes: Values): void => {
  try {
    // Отличий нет — ключа в хранилище тоже не должно быть (иначе он появился бы, например, после
    // запуска волны из панели: это действие, а не изменение конфига).
    if (Object.keys(changes).length === 0) {
      localStorage.removeItem(STORAGE_KEY);

      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
  } catch {
    // Сохранить не получилось (приватный режим, запрет) — изменения просто не переживут перезагрузку.
  }
};

export const clearSavedChanges = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Нечего очищать.
  }
};

// Переносит значения из changes в target. Берёт только поля, которые в target уже есть и того же типа
// (число на место числа, строка на место строки). Неизвестные поля — например, от старой версии игры,
// где параметр назывался иначе, — молча пропускаются. Вложенные объекты обходятся так же, рекурсивно.
export const applyChanges = (target: Values, changes: Values): void => {
  for (const [key, value] of Object.entries(changes)) {
    const current = target[key];

    if (isRecord(current) && isRecord(value)) {
      applyChanges(current, value);

      continue;
    }

    if (!isRecord(current) && typeof current === typeof value) {
      target[key] = value;
    }
  }
};

// Отличия current от defaults: объект только с изменёнными полями (вложенные — тоже только изменённые).
export const getChanges = (current: Values, defaults: Values): Values =>
  Object.fromEntries(
    Object.entries(current).flatMap(([key, value]): Array<[string, unknown]> => {
      const defaultValue = defaults[key];

      if (isRecord(value) && isRecord(defaultValue)) {
        const nestedChanges = getChanges(value, defaultValue);

        return Object.keys(nestedChanges).length > 0 ? [[key, nestedChanges]] : [];
      }

      return isSameValue(value, defaultValue) ? [] : [[key, value]];
    }),
  );

// Сколько параметров изменено: считаем «листья» — числа и строки, а не вложенные объекты.
export const countChanges = (changes: Values): number =>
  Object.values(changes).reduce<number>((count, value) => count + (isRecord(value) ? countChanges(value) : 1), 0);

// Число или строка так, как их пишут в config.ts: числа без хвостов вроде 0.30000000000000004, строки в кавычках.
const formatValue = (value: unknown): string => {
  if (typeof value === 'number') {
    return String(Number(value.toFixed(6)));
  }

  if (typeof value === 'string') {
    return `'${value}'`;
  }

  if (isRecord(value)) {
    return `{ ${Object.entries(value)
      .map(([key, nested]) => `${key}: ${formatValue(nested)}`)
      .join(', ')} }`;
  }

  return String(value);
};

// Текст для переноса изменений в config.ts: по строке на каждый изменённый параметр, в том же виде,
// что и в DEFAULT_CONFIG, — строку можно вставить вместо прежней. Для вложенного объекта (ENEMY_KINDS)
// выводится строка каждого изменённого элемента целиком — с текущими значениями всех его полей.
export const formatChangesForCode = (changes: Values, current: Values): string => {
  const lines = Object.entries(changes).flatMap(([key, value]) => {
    const currentValue = current[key];

    if (isRecord(value) && isRecord(currentValue)) {
      return [
        `// внутри ${key}:`,
        ...Object.keys(value).map((nestedKey) => `${nestedKey}: ${formatValue(currentValue[nestedKey])},`),
      ];
    }

    return [`${key}: ${formatValue(currentValue)},`];
  });

  return lines.length > 0 ? lines.join('\n') : '// Изменений нет: все значения как в config.ts';
};
