# Планировщик задач + SeaTable + Vercel

Проект уже включает удобный интерфейс планировщика (фильтры, быстрые фильтры, карточки на мобильных, отчеты, комментарии, вложения).  
В этой версии добавлена серверная интеграция с SeaTable через Vercel Functions, чтобы API-токен не попадал в браузер.

## 1) Подготовка SeaTable

Создайте таблицу `Tasks` в базе SeaTable на `https://seatable.spyanao.ru/` и добавьте поля:

- `id` (Number)
- `created_at`, `updated_at`, `deadline`, `assigned_at`, `in_progress_at`, `review_at`, `closed_at`, `rejected_at` (Date/Text)
- `database_id`, `type`, `title`, `department`, `description`, `author`, `assignee`, `office`, `phone`, `priority`, `status`, `rejected_reason`, `report` (Text/Long text/Single select)
- `sla_days` (Number)
- `comments`, `history`, `attachments` (Long text, хранится JSON)

Получите:

- `API token`
- `Base UUID`

## 2) Настройка локально

1. Создайте `.env` по примеру:

```bash
copy .env.example .env
```

2. Заполните значения в `.env`.

3. Для локального запуска с серверными функциями используйте:

```bash
npx vercel dev
```

Сайт откроется на локальном URL, а `/api/tasks` будет работать как backend-прокси к SeaTable.

## 3) Деплой на Vercel

1. Залейте проект в GitHub.
2. Импортируйте репозиторий в Vercel.
3. В `Project Settings -> Environment Variables` добавьте:
   - `SEATABLE_SERVER=https://seatable.spyanao.ru`
   - `SEATABLE_API_TOKEN=...`
   - `SEATABLE_BASE_UUID=...`
   - `SEATABLE_TABLE_NAME=Tasks`
   - `SEATABLE_VIEW_NAME=Default`
4. Нажмите `Deploy`.

## 4) Что уже добавлено

- безопасная работа с SeaTable через backend:
  - `GET /api/tasks`
  - `POST /api/tasks`
  - `PUT /api/tasks/:id`
  - `DELETE /api/tasks/:id`
- в интерфейсе:
  - баннер статуса синхронизации (онлайн/ошибка)
  - сортировка задач (дата, срок, приоритет)
  - optimistic UI для CRUD (показывает изменения сразу, при ошибке откатывает)
  - обработка ошибок API с уведомлением пользователя

## 5) Важно по безопасности

- Никогда не храните `SEATABLE_API_TOKEN` в `js/app.js`.
- Токен должен быть только в `.env` и в переменных окружения Vercel.
- `.env` уже добавлен в `.gitignore`.
