// E2E звука (src/sound.ts) в настоящем Web Audio: выбор наборов и общий мут запоминаются в браузере,
// неизвестные и устаревшие наборы отбрасываются.
import { beforeEach, describe, expect, it } from 'vitest';
import { createSound } from '../src/sound';

const SETS_STORAGE_KEY = 'project-cube:sound-sets';
const MUTED_STORAGE_KEY = 'project-cube:muted';

beforeEach(() => {
  localStorage.removeItem(SETS_STORAGE_KEY);
  localStorage.removeItem(MUTED_STORAGE_KEY);
});

describe('наборы', () => {
  it('Должен запомнить выбранный набор в браузере', () => {
    createSound().setSetId('hit', 'metal');

    expect(JSON.parse(localStorage.getItem(SETS_STORAGE_KEY) ?? '{}')).toEqual(
      expect.objectContaining({ hit: 'metal' }),
    );
  });

  it('Должен оставить прежний набор, если выбран неизвестный', () => {
    const sound = createSound();

    sound.setSetId('hit', 'нет-такого');

    expect(sound.getSetId('hit')).toBe('brick');
  });

  it.each([
    ['сохранённый набор', 'laser', 'laser'],
    ['набор по умолчанию вместо устаревшего', 'старый', 'click'],
  ])('Должен после перезагрузки выбрать %s', (_, saved, expected) => {
    localStorage.setItem(SETS_STORAGE_KEY, JSON.stringify({ shot: saved }));

    expect(createSound().getSetId('shot')).toBe(expected);
  });
});

describe('общий мут', () => {
  it('Должен запомнить мут в браузере', () => {
    createSound().setMuted(true);

    expect(localStorage.getItem(MUTED_STORAGE_KEY)).toBe('1');
  });

  it('Должен восстановить мут после перезагрузки', () => {
    localStorage.setItem(MUTED_STORAGE_KEY, '1');

    expect(createSound().isMuted()).toBe(true);
  });
});
