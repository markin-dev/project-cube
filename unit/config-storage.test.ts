// Юнит-тесты хранения изменений конфига (src/config-storage.ts).
//
// Модуль чистый: не импортирует config.ts, а получает объекты параметрами, поэтому тесты не зависят
// от игрового состояния. localStorage подаёт окружение happy-dom (см. vitest.config.ts) — нужен только
// для проверки сохранения/чтения; чистые функции (applyChanges, getChanges и т.д.) его не трогают.
import { describe, expect, it, beforeEach } from 'vitest';
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

describe('isRecord', () => {
  it('обычный объект — да, null/массив/примитив — нет', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord('строка')).toBe(false);
  });
});

describe('applyChanges', () => {
  it('переносит поля того же типа и игнорирует неизвестные/другого типа', () => {
    const target = { speed: 2, name: 'куб', on: true };

    applyChanges(target, {
      speed: 5, // число на место числа — применяется
      name: 99, // число на место строки — отброшено (другой тип)
      on: 'нет', // строка на место boolean — отброшено
      unknown: 1, // такого поля в target нет — отброшено
    });

    expect(target).toEqual({ speed: 5, name: 'куб', on: true });
  });

  it('рекурсивно применяет вложенные объекты (ENEMY_KINDS)', () => {
    const target = { kinds: { tiny: { hp: 10, size: 0.4 }, big: { hp: 80 } } };

    applyChanges(target, { kinds: { tiny: { hp: 999 }, ghost: { hp: 1 } } });

    // tiny.hp изменён, tiny.size не тронут (нет в changes), ghost добавлен быть не должен.
    expect(target).toEqual({ kinds: { tiny: { hp: 999, size: 0.4 }, big: { hp: 80 } } });
  });
});

describe('getChanges', () => {
  it('возвращает только отличия, включая вложенные', () => {
    const current = { a: 1, b: 'строка', nested: { x: 1, y: 2 } };
    const defaults = { a: 1, b: 'другая', nested: { x: 1, y: 5 } };

    // Изменились b и nested.y — a и nested.x совпадают с дефолтом и не попадают в отличия.
    expect(getChanges(current, defaults)).toEqual({ b: 'строка', nested: { y: 2 } });
  });

  it('пусто, когда всё как в дефолте (с допуском по числам)', () => {
    // 0.1 + 0.2 даёт 0.30000000000000004 — с допуском 1e-9 это «то же, что 0.3».
    expect(getChanges({ x: 0.1 + 0.2 }, { x: 0.3 })).toEqual({});
  });
});

describe('countChanges', () => {
  it('считает «листья», а не вложенные объекты', () => {
    // Два scalar + два вложенных листа = 4.
    expect(countChanges({ a: 1, b: 'x', nested: { y: 2, z: 3 } })).toBe(4);
    expect(countChanges({})).toBe(0);
  });
});

describe('formatChangesForCode', () => {
  it('числа без хвостов, строки в кавычках, вложенные — построчно', () => {
    const text = formatChangesForCode(
      { speed: 5, color: 'красный', kinds: { tiny: { hp: 999 } } },
      { speed: 5, color: 'красный', kinds: { tiny: { hp: 999, size: 0.4 } } },
    );

    expect(text).toContain('kinds:');
    // Вложенный элемент выводится целиком, со всеми текущими полями (hp и size).
    expect(text).toContain('tiny: { hp: 999, size: 0.4 }');
  });

  it('без изменений — поясняющая строка', () => {
    expect(formatChangesForCode({}, {})).toBe('// Изменений нет: все значения как в config.ts');
  });
});

describe('хранилище (localStorage)', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('сохраняет и читает обратно', () => {
    saveChanges({ a: 1, nested: { b: 'x' } });
    expect(readSavedChanges()).toEqual({ a: 1, nested: { b: 'x' } });
  });

  it('пустой объект изменений удаляет ключ', () => {
    saveChanges({ a: 1 });
    saveChanges({});
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readSavedChanges()).toEqual({});
  });

  it('повреждённый JSON читается как пусто, а не падает', () => {
    localStorage.setItem(STORAGE_KEY, '{не json');
    expect(readSavedChanges()).toEqual({});
  });

  it('clearSavedChanges убирает ключ', () => {
    saveChanges({ a: 1 });
    clearSavedChanges();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
