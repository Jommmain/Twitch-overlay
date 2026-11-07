# Standalone overlay 1.2.1

Основная документация: `../README-ru.md`. Запуск: `node server.mjs`, затем http://127.0.0.1:8766/ (или PORT). Для теста `?demo=1&preview=1`, N — ники, Q — сообщение, C — убрать.

Twitch включается в config.json. Секреты — только в переменных окружения, не в config: TWITCH_CLIENT_ID / TWITCH_ACCESS_TOKEN. Для IRC можно задать TWITCH_IRC_NICK и TWITCH_IRC_TOKEN (user token chat:read); без IRC_NICK username определяется через oauth2/validate. Включите twitch.ircEnabled. Доступ к чат-сообщениям read-only. Фильтр ссылок и !команд, временные очереди, без логирования текста.

В Electron используется отдельный in-process сервер с русскими настройками и безопасным локальным хранением токена. Тесты: `node --test tests/*.test.mjs`.
