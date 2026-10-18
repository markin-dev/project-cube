// Юнит-тесты решения об отладочном режиме (src/debug.ts): в сборке — никогда, даже с параметром;
// на dev-сервере — только с ?debug; в тестах vitest — всегда.
import { expect, it } from 'vitest';
import { isDebugRequested } from '@/debug';

it.each([
  ['сборка без параметра', false, { isDev: false, mode: 'production', search: '' }],
  ['сборка с ?debug', false, { isDev: false, mode: 'production', search: '?debug' }],
  ['dev-сервер без параметра', false, { isDev: true, mode: 'development', search: '' }],
  ['dev-сервер с другими параметрами', false, { isDev: true, mode: 'development', search: '?foo=1' }],
  ['dev-сервер с ?debug', true, { isDev: true, mode: 'development', search: '?debug' }],
  ['dev-сервер с ?debug=1 среди других', true, { isDev: true, mode: 'development', search: '?foo=1&debug=1' }],
  ['тесты vitest', true, { isDev: true, mode: 'test', search: '' }],
])('Должен для случая «%s» решить: %s', (_, expected, source) => {
  expect(isDebugRequested(source)).toBe(expected);
});
