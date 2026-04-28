# IT-SP · Планировщик задач + SeaTable — Codebase Overview

## Summary
Это одностраничный веб‑планировщик задач на чистом HTML/CSS/JavaScript с серверной прослойкой на Vercel Functions. Интерфейс даёт пользователям логин, список задач, фильтры, карточки на мобильных, отчёты, управление направлениями и пользователями; сервер прячет SeaTable API‑token и выступает прокси между браузером и SeaTable.

Ключевая идея проекта — хранить «операционные» данные задач и пользователей в SeaTable, но оставить UI отзывчивым и частично автономным за счёт `localStorage`. В итоге браузер хранит сессию, настройки, часть справочников и аватарки, а SeaTable становится источником истины для CRUD по задачам и пользователям.

## Architecture
### Архитектурный стиль
Архитектура гибридная:
- **SPA без фреймворка**: вся логика UI живёт в `js/app.js`.
- **Serverless backend**: обработчики в `api/` предназначены для Vercel.
- **SeaTable adapter layer**: `api/_seatable.js` изолирует различия SeaTable v1/v2 и формат данных.
- **Локальное состояние + удалённая синхронизация**: UI работает из локальных массивов и `localStorage`, а затем синхронизируется с SeaTable.

### Major subsystems
1. **Browser UI**
   - `index.html` содержит полный каркас приложения: экран логина, шапка, боковое меню, список задач, отчёты, справочники, модалки.
   - `css/style.css` реализует темы, адаптивность, мобильные карточки, компактный режим, тёмную тему и визуальные состояния синхронизации.
   - `js/app.js` — монолитный контроллер состояния и событий.

2. **Backend API**
   - `api/tasks/index.js` обслуживает `/api/tasks`:
     - `GET` — список задач,
     - `POST` — создание,
     - `PUT` — обновление,
     - `DELETE` — удаление.
   - `api/tasks/[id].js` обслуживает `/api/tasks/:id` и умеет находить `row_id`, если фронтенд его не передал.
   - `api/users/index.js` обслуживает `/api/users` для синхронизации пользователей.

3. **SeaTable integration**
   - `api/_seatable.js` отвечает за получение app access token, построение URL, ретраи, таймауты и маппинг строк SeaTable ↔ доменные объекты.

4. **Deployment/runtime**
   - `vercel.json` задаёт rewrites на `index.html`, CORS‑заголовки для `/api/*` и cache headers.
   - `package.json` показывает, что сборка не нужна, а запуск идёт через Node/Vercel.

### Technology stack
- **Language/runtime**: JavaScript, Node.js 22+ на сервере, браузерный JS на клиенте.
- **Backend**: Vercel serverless functions (`api/*.js`).
- **HTTP**: `fetch` / `node-fetch` dependency для совместимости в окружении Node.
- **Storage**:
  - SeaTable — удалённое хранилище задач и пользователей,
  - `localStorage` — сессия, настройки, локальный кэш пользователей, задачи, справочники, аватарки.
- **UI**: plain HTML/CSS, Font Awesome CDN.

### Execution flow
Старт приложения идёт не через сборку, а прямо из `index.html`:
1. `js/app.js` загружается с `defer`.
2. `bootstrapSession()` пытается восстановить активного пользователя из `localStorage`.
3. `initUsers()` создаёт локальных пользователей при первом запуске и затем подтягивает пользователей из SeaTable.
4. После входа `initApp()`:
   - загружает сохранённые данные,
   - синхронизирует задачи с `/api/tasks`,
   - настраивает обработчики событий,
   - переключает стартовый раздел,
   - обновляет аватар и баннер синхронизации.

## Directory Structure
```text
project-root/
├── README.md               — Инструкция по SeaTable, Vercel и безопасности токена
├── index.html              — Полный UI приложения и все модалки
├── css/
│   └── style.css           — Весь визуальный слой, темы, адаптивность, мобильные карточки
├── js/
│   └── app.js              — Основная бизнес-логика фронтенда
├── api/
│   ├── _seatable.js        — SeaTable SDK-обёртка: auth, URL, маппинг, ретраи
│   ├── tasks/
│   │   ├── index.js        — CRUD /api/tasks
│   │   └── [id].js         — CRUD /api/tasks/:id
│   └── users/
│       └── index.js        — CRUD /api/users
├── netlify/
│   └── functions/
│       └── seatable-api.js  — Альтернативный/устаревший Netlify proxy
├── test/
│   └── seatable.test.js    — Unit/integration tests для адаптера и API-роутов
├── package.json             — Скрипты, зависимости, Node engine
├── package-lock.json
├── vercel.json              — Rewrite/CORS/cache rules для Vercel
└── .env.example             — Переменные окружения SeaTable
```

## Key Abstractions
### `api/_seatable.js`
- **Responsibility**: Единая точка работы с SeaTable API.
- **Interface**:
  - `getAppAccessToken()` — получает app access token и кэширует его в памяти.
  - `getRowsBaseUrl(accessMeta)` — строит base URL для v1/v2.
  - `seatableRequest(token, url, options)` — запрос с таймаутом, ретраями и fallback `Token`/`Bearer`.
  - `mapRowToTask(row)` / `mapTaskToRow(task)` — конвертация форматов.
  - `buildUpdateRequestBody()` / `buildDeleteRequestBody()` — форматирование payload для SeaTable v1/v2.
- **Why it matters**: это слой, который скрывает различия между cloud/self-hosted и между API‑версиями.

### `api/tasks/index.js`
- **Responsibility**: Коллекция задач и CRUD на уровне всей таблицы.
- **Interface**:
  - `GET` — вытаскивает все задачи, в v1 постранично, в v2 через SQL.
  - `POST` — создаёт задачу, в v2 сам назначает `id = max(id)+1`.
  - `PUT` — обновляет задачу и затем проверяет, что SeaTable реально применил изменения.
  - `DELETE` — удаляет по `row_id`.
- **Why it matters**: это главный серверный контракт для фронтенда.

### `api/tasks/[id].js`
- **Responsibility**: Операции над одной задачей по числовому `id`.
- **Interface**:
  - `GET /api/tasks/:id`
  - `PUT /api/tasks/:id`
  - `DELETE /api/tasks/:id`
- **Why it matters**: умеет самостоятельно найти `row_id`, если клиент его не передал; это защищает от неполных payload’ов и разъезда локального кэша.

### `api/users/index.js`
- **Responsibility**: CRUD пользователей в SeaTable.
- **Interface**:
  - `GET` — список пользователей без обязательного пароля для UI.
  - `POST` — создание пользователя.
  - `PUT` — обновление пользователя по `username`.
  - `DELETE` — удаление пользователя по `username`.
- **Why it matters**: фронтенд хранит пароль локально, а SeaTable — профильные данные и роль.

### `js/app.js`
- **Responsibility**: Вся клиентская логика — авторизация, состояние, фильтрация, рендер, модалки, синхронизация.
- **Interface**: формально не модульный; ключевые функции:
  - `bootstrapSession()`, `initApp()`, `initUsers()`
  - `syncTasksFromApi()`, `createTask()`, `updateTaskFromModal()`
  - `renderTasks()`, `renderUsers()`, `renderDepartments()`, `renderBasesList()`
  - `switchView()`, `applyRole()`, `loadSettings()`
- **Why it matters**: это одновременно controller, store и view-model, поэтому при изменениях легко задеть несколько подсистем.

### `index.html`
- **Responsibility**: Структура всех экранов и модальных окон.
- **Interface**: DOM‑контейнеры для списка задач, отчётов, пользователей, направлений, профиля, уведомлений и подтверждений.
- **Why it matters**: многие функции JS завязаны на `id`/`data-role`; отсутствие или переименование элемента ломает поведение без ошибок сборки.

### `css/style.css`
- **Responsibility**: Все стили приложения.
- **Interface**: темы (`body.theme-dark`), compact mode (`body.compact-mode`), mobile cards, sync banner, modal/notification/toast styles.
- **Why it matters**: CSS здесь — не просто оформление, а часть UX‑логики (например, мобильный рендер и скрытие столбцов/панелей по ролям).

### `netlify/functions/seatable-api.js`
- **Responsibility**: Альтернативная proxy‑реализация для Netlify.
- **Interface**: `exports.handler`.
- **Why it matters**: файл выглядит как параллельный путь деплоя, но основной инфраструктурный контракт в этом репозитории всё же описан через Vercel.

### `test/seatable.test.js`
- **Responsibility**: Проверяет маппинг и основные API‑контракты.
- **Interface**:
  - тесты `mapRowToTask`, `mapTaskToRow`
  - тесты формата `buildUpdateRequestBody` / `buildDeleteRequestBody`
  - контрактные тесты для задач и пользователей на v2
- **Why it matters**: тесты закрепляют самые хрупкие места — соответствие payload’ов SeaTable v1/v2.

### `package.json`
- **Responsibility**: Скрипты и runtime constraints.
- **Interface**:
  - `start` / `dev` → `node api/tasks/index.js`
  - `test` → `node test/seatable.test.js`
  - dependency: `node-fetch`
  - engines: `node >=22 <25`
- **Why it matters**: проект почти без toolchain, поэтому поведение зависит в основном от Node и runtime платформы.

## Data Flow
### 1) Login and session restore
1. `bootstrapSession()` запускается сразу после загрузки `js/app.js`.
2. `initUsers()` загружает локальных пользователей из `localStorage`; при первом запуске создаёт `admin`, `director`, `employee` с SHA‑256 хешами паролей.
3. Затем `initUsers()` пытается синхронизировать пользователей из `/api/users`.
4. Если в `localStorage` есть последний пользователь, приложение восстанавливает сессию без повторного логина.

### 2) Task synchronization on app start
1. После успешного входа `initApp()` вызывает `loadPersistedData()`.
2. Фронтенд загружает локальные `databases`, `departmentsData`, `employeesData`.
3. `syncTasksFromApi()` делает `GET /api/tasks`.
4. Ответ SeaTable нормализуется через `normalizeTask()` и раскладывается по локальным логическим базам.
5. `nextTaskId` пересчитывается как `max(id)+1`, то есть локальный счётчик подчинён удалённым данным.

### 3) Create task
1. Пользователь открывает `quickTaskModal`.
2. `createTask()` собирает `FormData`, валидирует направление, описание, приоритет и вложение.
3. Формируется локальный объект задачи с `history`, `comments`, `attachments`, SLA и датами.
4. Задача сразу добавляется в локальное состояние и рендерится.
5. Затем отправляется `POST /api/tasks`.
6. В ответе сервер возвращает каноническую задачу и `row_id`; фронтенд сохраняет их и обновляет `taskRowMap`.

### 4) Update task
1. `openTaskDetail()` подставляет значения задачи в форму.
2. `updateTaskFromModal()` проверяет права, допустимость перехода статуса и обязательные поля.
3. Локальный объект задачи обновляется optimistic‑style.
4. `PUT /api/tasks/:id` отправляется с `row_id` и полным payload.
5. При успехе UI остаётся в новом состоянии; при ошибке откатывается из snapshot.

### 5) Delete task
1. `handleDeleteTaskBtn()` / `handleDeleteTaskCard()` / `deleteSelectedTasks()` определяют список разрешённых задач.
2. UI удаляет их локально и перерисовывает списки.
3. Затем вызывается `DELETE /api/tasks/:id` или `DELETE /api/tasks`.
4. Если SeaTable отвечает ошибкой, локальный snapshot восстанавливается.

### 6) User and department mutations
1. Пользователей добавляет/редактирует только admin.
2. `editUser()` при смене ФИО триггерит `syncTasksForUserRename()`, чтобы переписать автора/исполнителя в связанных задачах.
3. Направления редактируются локально, но затем `syncTasksForDirectionRename()` массово обновляет связанные задачи в SeaTable.
4. В этом проекте справочник направлений — преимущественно UI‑сущность, а не отдельная серверная таблица.

## Non-Obvious Behaviors & Design Decisions
### Hidden invariants
- **SeaTable is the source of truth for tasks and users**. Фронтенд хранит состояние, но при старте всегда перезатирает локальные задачи данными из `/api/tasks`.
- **`row_id` критичен для update/delete**. Без него сервер либо пытается вычислить строку по `id`, либо падает с 404.
- **Числовой `task.id` должен быть уникальным и монотонным**. В v2 сервер сам присваивает `max(id)+1`, а фронтенд подстраивает свой `nextTaskId` после синка.
- **JSON‑поля (`comments`, `history`, `attachments`) должны быть массивами на фронте и строками в SeaTable**.

### Why the code is structured this way
- **Frontend does optimistic UI**: интерфейс обновляется до ответа сервера, чтобы пользователю казалось, что приложение работает как локальное. Это важно для задач, комментариев и вложений.
- **Backend validates with read-back**: особенно в `api/tasks/index.js` и `api/tasks/[id].js` после update происходит повторное чтение и сравнение полей. Это защита от неочевидной eventual consistency SeaTable.
- **Users are split into local auth + remote profile**: пароли не отправляются в SeaTable, потому что приложение авторизует пользователя локально через `localStorage`.
- **Role gating is mostly client-side**: сервер не знает о ролях приложения; ограничения admin/director/employee выполняются в UI и в логике кнопок/фильтров.

### State management
Основное состояние живёт в памяти `js/app.js`:
- `databases` — массив логических баз;
- `currentDatabaseId` — активная база для админов/директоров;
- `currentUser` — активная сессия;
- `users` — локальный кэш пользователей;
- `departmentsData`, `employeesData` — справочники;
- `notifications` — локальные уведомления;
- `taskRowMap` — соответствие `task.id -> row_id` для SeaTable;
- `appSettings` и аватары — в `localStorage`.

Это значит, что перезагрузка страницы не равна перезагрузке сервера: часть данных восстановится из браузера, часть придёт из SeaTable.

### Error propagation
- Клиентский `apiRequest()` даёт 12‑секундный таймаут через `AbortController`.
- При сетевой ошибке UI уходит в offline‑режим, но не ломает экран.
- На create/update/delete происходит локальный optimistic change и откат из snapshot при ошибке.
- На сервере ошибки упаковываются в JSON `{ error, debug }`, что помогает диагностировать проблемы с SeaTable.
- `api/users/index.js` после update намеренно не валит запрос на несовпадении верификации — там выбран best‑effort подход из-за eventual consistency.

### Performance-sensitive paths
- `getAppAccessToken()` кэширует app token в памяти и обновляет его с запасом 60 секунд.
- `seatableRequest()` умеет ретраить 5xx и сетевые ошибки с backoff.
- `syncTasksFromApi()` использует один большой синк при старте, а не множество точечных запросов.
- `renderTasks()` полностью перерисовывает таблицу и мобильные карточки, что просто, но может быть дорогим на больших наборах данных.
- На мобильных таблица скрывается и вместо неё показываются карточки — это не косметика, а отдельная ветка рендера.

### External dependency quirks
- SeaTable cloud и self-hosted могут различаться по:
  - способу получения app access token,
  - базовому URL (`api/v1` vs `api/v2`/`api-gateway`),
  - формату ответов на rows/sql,
  - времени применения update.
- Именно поэтому `_seatable.js` содержит fallback между `Bearer` и `Token`, а также разные форматы payload для v1/v2.
- В `netlify/functions/seatable-api.js` есть отдельная реализация через Netlify, но она не совпадает по архитектуре с основным Vercel backend; это выглядит как исторический или запасной путь деплоя.

### Things the code does not explain well
- В `index.html` и `js/app.js` есть ссылки на элементы комментариев/истории (`taskCommentsList`, `taskHistoryList`, `taskCommentInput`, `taskHistoryFilter`, `addTaskCommentBtn`), но соответствующая разметка в текущем HTML отсутствует. Эти функции безопасно no-op’ятся из-за optional chaining, но для разработчика это выглядит как частично вырезанная функция.
- Есть следы refactor/encoding artefacts: например, в `scheduleSyncTasks()` встречается странная mojibake‑строка вместо нормального текста о восстановлении сети.
- Логика «баз данных» в UI локальная и не совпадает с физической моделью SeaTable: по сути это один табличный источник с `database_id`, а не отдельные базы SeaTable.
- Логин и смена пароля не защищены сервером. Это достаточно для внутреннего инструмента, но не для публичной системы.

## Module Reference
| File | Purpose |
|------|---------|
| `README.md` | Пошаговая настройка SeaTable, Vercel и переменных окружения |
| `index.html` | Полная разметка приложения: login, dashboard, modals, reports |
| `css/style.css` | Вся визуальная система: layout, темы, responsive, mobile cards |
| `js/app.js` | Основная клиентская логика, состояние, рендер, синхронизация, права |
| `api/_seatable.js` | SeaTable auth, retries, URL building, data mapping |
| `api/tasks/index.js` | CRUD коллекции задач через SeaTable |
| `api/tasks/[id].js` | CRUD одной задачи по `id`, с resolve `row_id` |
| `api/users/index.js` | CRUD пользователей через SeaTable |
| `netlify/functions/seatable-api.js` | Альтернативный Netlify proxy для SeaTable |
| `test/seatable.test.js` | Контрактные тесты маппинга и API payloads |
| `package.json` | Скрипты, зависимости, Node engines |
| `vercel.json` | Rewrite rules, cache headers, CORS for `/api/*` |
| `.env.example` | Переменные окружения для SeaTable |

## Suggested Reading Order
1. `README.md` — быстро объясняет домен, окружение и развёртывание.
2. `api/_seatable.js` — понять, как проект разговаривает с SeaTable и почему есть v1/v2 ветки.
3. `api/tasks/index.js` — увидеть основной API задач и валидацию синка.
4. `api/tasks/[id].js` — понять работу `row_id` и точечных операций.
5. `api/users/index.js` — увидеть модель пользователей и отличие remote profile от local auth.
6. `js/app.js` — изучить весь жизненный цикл UI, права, optimistic updates и локальное состояние.
7. `index.html` — сопоставить JS‑идеи с реальными DOM‑элементами.
8. `test/seatable.test.js` — закрепить формат данных и критичные контрактные места.

## Developer Notes
- Для запуска не нужен build step; приложение открывается через Vercel/dev server напрямую.
- Самый важный контракт — соответствие полей между фронтендом и SeaTable. Любое изменение имени колонки надо синхронизировать в:
  - `js/app.js`,
  - `api/_seatable.js`,
  - `api/tasks/*`,
  - `api/users/index.js`,
  - тестах.
- Если меняете модель задачи, сначала обновляйте `mapTaskToRow` / `mapRowToTask`, затем API, затем UI.
- Если добавляете новые формы или кнопки, убедитесь, что DOM `id` и `data-role` совпадают с тем, что ожидает `js/app.js`.
- Реальные ограничения безопасности здесь определяются не сервером, а соглашением: токен SeaTable хранится только в env, а авторизация пользователей — только локально.
