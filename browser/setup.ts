// Общая подготовка браузерных E2E: перед каждым тестом localStorage очищается — сохранённые наборы
// звука, мут и правки панели одного теста не влияют на другие.
import { beforeEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
});
