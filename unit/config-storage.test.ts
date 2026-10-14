// Юнит-тесты хранения изменений конфига (src/config-storage.ts). Модуль не импортирует config.ts,
// а получает объекты параметрами; localStorage даёт окружение happy-dom (см. vitest.config.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyChanges,
  clearSavedChanges,
  countChanges,
  formatChangesForCode,
  getChanges,
  isRecord,
  readSavedChanges,
  saveChanges,
} from '../src/config-storage';

const STORAGE_KEY = 'project-cube:config-changes';

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe('isRecord', () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [null, false],
    [[], false],
    [42, false],
    ['строка', false],
  ])('Должен для %j вернуть %s', (value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });
});

describe('readSavedChanges', () => {
  it('Должен прочитать сохранённые изменения', () => {
    saveChanges({ a: 1, nested: { b: 'x' } });

    expect(readSavedChanges()).toEqual({ a: 1, nested: { b: 'x' } });
  });

  it.each([
    ['повреждённый JSON', '{не json'],
    ['массив вместо объекта', '[1, 2]'],
  ])('Должен вернуть пустой объект, если в хранилище %s', (_, saved) => {
    localStorage.setItem(STORAGE_KEY, saved);

    expect(readSavedChanges()).toEqual({});
  });
});

it('saveChanges: Должен удалить ключ, если изменений нет', () => {
  saveChanges({ a: 1 });
  saveChanges({});

  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it('clearSavedChanges: Должен удалить ключ', () => {
  saveChanges({ a: 1 });
  clearSavedChanges();

  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

describe('applyChanges', () => {
  it('Должен перенести поля того же типа и пропустить неизвестные и другого типа', () => {
    const target = { speed: 2, name: 'куб', isOn: true };

    applyChanges(target, { speed: 5, name: 99, isOn: 'нет', unknown: 1 });

    expect(target).toEqual({ speed: 5, name: 'куб', isOn: true });
  });

  it('Должен применить вложенные объекты рекурсивно, не добавляя новых элементов', () => {
    const target = { kinds: { tiny: { hp: 10, size: 0.4 }, big: { hp: 80 } } };

    applyChanges(target, { kinds: { tiny: { hp: 999 }, ghost: { hp: 1 } } });

    expect(target).toEqual({ kinds: { tiny: { hp: 999, size: 0.4 }, big: { hp: 80 } } });
  });
});

describe('getChanges', () => {
  it('Должен вернуть только отличия, включая вложенные', () => {
    const current = { a: 1, b: 'строка', nested: { x: 1, y: 2 } };
    const defaults = { a: 1, b: 'другая', nested: { x: 1, y: 5 } };

    expect(getChanges(current, defaults)).toEqual({ b: 'строка', nested: { y: 2 } });
  });

  it('Должен считать числа равными с допуском', () => {
    expect(getChanges({ x: 0.1 + 0.2 }, { x: 0.3 })).toEqual({});
  });
});

describe('countChanges', () => {
  it.each([
    [{ a: 1, b: 'x', nested: { y: 2, z: 3 } }, 4],
    [{}, 0],
  ])('Должен для %j насчитать %s изменённых параметров', (changes, expected) => {
    expect(countChanges(changes)).toBe(expected);
  });
});

describe('formatChangesForCode', () => {
  it('Должен вывести изменённый вложенный элемент целиком, со всеми текущими полями', () => {
    const text = formatChangesForCode({ kinds: { tiny: { hp: 999 } } }, { kinds: { tiny: { hp: 999, size: 0.4 } } });

    expect(text).toBe('// внутри kinds:\ntiny: { hp: 999, size: 0.4 },');
  });

  it('Должен записать числа без хвостов, а строки — в кавычках', () => {
    const text = formatChangesForCode({ speed: 1, color: 1 }, { speed: 0.1 + 0.2, color: '#fff' });

    expect(text).toBe("speed: 0.3,\ncolor: '#fff',");
  });

  it('Должен пояснить, что изменений нет', () => {
    expect(formatChangesForCode({}, {})).toBe('// Изменений нет: все значения как в config.ts');
  });
});
