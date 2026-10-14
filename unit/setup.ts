// Общая подготовка юнит-тестов: перед каждым тестом рабочий конфиг возвращается к значениям из кода,
// а localStorage очищается. Тесты настраивают игру правкой глобального config, и без сброса правка
// одного теста незаметно влияла бы на следующие — результат зависел бы от порядка тестов.
import { beforeEach } from 'vitest';
import { config, DEFAULT_CONFIG } from '@/config';
import { applyChanges } from '@/config-storage';

beforeEach(() => {
  applyChanges(config, DEFAULT_CONFIG);
  localStorage.clear();
});
