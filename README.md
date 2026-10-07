# Project Animal

Игра на TypeScript + Vite + Three.js + Rapier: куб в центре арены сам отстреливается от волн врагов.
Вид сверху в изометрии. Если враг добрался до куба — игра окончена, клик/касание/пробел начинают заново.

```bash
npm install
npm run dev
```

## Код

- `src/main.ts` — точка входа: состояние игры, волны, столкновения, игровой цикл, рестарт
- `src/config.ts` — все числа и цвета: размеры, скорости, интервалы, размер волны
- `src/scene.ts` — сцена, изометрическая камера, свет, пол
- `src/physics.ts` — физический мир Rapier и очередь событий столкновений
- `src/entity.ts` — общий тип «тело + меш» и функции удаления/синхронизации
- `src/player.ts`, `src/enemies.ts`, `src/projectiles.ts` — игрок, враги, снаряды
- `src/hud.ts` — надписи поверх игры: номер волны и экран конца игры

## Деплой

Сайт: https://farmclick.duckdns.org/cube/

Собранные файлы лежат на сервере `bodryanka_vpn_3` в `~/cube`. Их отдаёт Caddy из `/opt/farm`
(в `docker-compose.yml` монтирование `/home/serega/cube:/srv/cube:ro`, в `Caddyfile` блок `handle_path /cube/*`).

```bash
npm run build
rsync -avz --delete dist/ bodryanka_vpn_3:cube/
```
