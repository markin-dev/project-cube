#!/usr/bin/env bash
# Запуск browser-mode E2E-тестов (vitest browser + Playwright), см. vitest.browser.config.ts.
#
# Зачем этот скрипт: Playwright-нужен Chromium, а ему для звука нужна системная библиотека
# libasound.so.2. В лёгких headless-окружениях (контейнеры, серверы) её часто нет, а ставить её
# через apt требует sudo с паролем. Поэтому:
#   • если библиотека уже есть в системе — скрипт просто запускает тесты;
#   • если нет — разово скачивает пакет libasound2t64 через `apt-get download` (sudo не нужен),
#     распаковывает библиотеку в .local-libs/ (в .gitignore) и подставляет через LD_LIBRARY_PATH.
#
# Запуск: npm run test:browser  (или bash scripts/run-browser-tests.sh -- ...доп. аргументы vitest)
set -euo pipefail

LIB_DIR="$PWD/.local-libs/asound/usr/lib/x86_64-linux-gnu"

if ldconfig -p 2>/dev/null | grep -q 'libasound\.so\.2'; then
  : # системная библиотека есть — ничего не делаем
elif [ ! -e "$LIB_DIR/libasound.so.2" ]; then
  echo "libasound.so.2 нет ни в системе, ни локально — скачиваю пакет libasound2t64..."
  TMP="$(mktemp -d)"
  (cd "$TMP" && apt-get download libasound2t64 >/dev/null 2>&1) || {
    echo "не удалось скачать libasound2t64 (нужен доступ к apt-репозиторию)." >&2
    echo "Поставьте её вручную: sudo apt-get install -y libasound2t64" >&2
    rm -rf "$TMP"
    exit 1
  }
  mkdir -p "$LIB_DIR"
  dpkg-deb -x "$TMP"/libasound2t64_*.deb "$PWD/.local-libs/asound"
  rm -rf "$TMP"
fi

if [ -e "$LIB_DIR/libasound.so.2" ]; then
  export LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec npx vitest run --config vitest.browser.config.ts "$@"
