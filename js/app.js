(function(){
    
    "use strict";

    // ==================== УТИЛИТЫ ====================
    async function hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('ru-RU');
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleString('ru-RU');
    }

    function toLocalDateYmd(value) {
        if (!value) return '';
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return '';
            const isoLike = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
            if (isoLike) return isoLike[1];
            const ruLike = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
            if (ruLike) return `${ruLike[3]}-${ruLike[2]}-${ruLike[1]}`;
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getTodayYmd() {
        return toLocalDateYmd(new Date());
    }

    function sanitizeHTML(str) {
        if (!str) return '';
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttr(str) {
        if (!str) return '';
        return String(str).replace(/["'&<>`]/g, '');
    }

    // ==================== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ====================
    const USERS_STORAGE_KEY = 'taskPlannerUsersV1';
    const ACTIVE_SESSION_KEY = 'taskPlannerActiveUser';
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 минут
    let sessionTimer = null;
    let lastSyncAttemptAt = 0;

    async function initUsers() {
        try {
            // 1) загрузить пользователей из SeaTable (включая passwordHash)
            let payload = await apiRequest(API_USERS);
            let remoteUsers = Array.isArray(payload?.users) ? payload.users : [];

            // 2) Автосоздаём только главного admin, чтобы не "оживлять" admin/employee.
            const existing = new Set(remoteUsers.map(u => u.username));
            for (const def of DEFAULT_USERS.filter(u => u.username === 'admin')) {
                if (existing.has(def.username)) continue;
                if (currentUser?.role !== 'admin') break;
                const passwordHash = await hashPassword(def.password);
                await apiRequest(API_USERS, {
                    method: 'POST',
                    body: JSON.stringify({
                        user: {
                            username: def.username,
                            passwordHash,
                            role: def.role,
                            department: def.department,
                            fullName: def.fullName,
                            position: def.position,
                            email: def.email,
                            phone: def.phone,
                            office: def.office || '',
                        }
                    })
                });
            }

            // 3) Повторно загрузить, чтобы взялись актуальные passwordHash из SeaTable.
            payload = await apiRequest(API_USERS);
            remoteUsers = Array.isArray(payload?.users) ? payload.users : [];
            users = remoteUsers;
            
            // Переносим аватарки из SeaTable в localStorage если их там нет
            users.forEach(u => {
                if (u.avatar) {
                    localStorage.setItem(`avatar_${u.username}`, u.avatar);
                }
            });
            
            console.log('[initUsers] loaded from SeaTable:', users.length, 'users');
        } catch (error) {
            // fallback на старый кэш — если пользователь уже логинился ранее
            console.log('[initUsers] SeaTable недоступен, fallback на localStorage', error?.message || String(error));
            const stored = localStorage.getItem(USERS_STORAGE_KEY);
            if (!stored) throw error;
            users = JSON.parse(stored);
        }

        // Нормализация главного админа (чтобы не терялись поля из старых сохранений/пустого SeaTable)
        const adminUser = findUserByUsername('admin');
        if (adminUser) {
            if (!adminUser.office) adminUser.office = '222';
            const localAvatar = localStorage.getItem('avatar_admin');
            if (!adminUser.avatar && localAvatar) {
                adminUser.avatar = localAvatar;
            }
        }
        if (currentUser?.username === 'admin' && !currentUser.office) currentUser.office = '222';
        
        // Загружаем аватарки всех пользователей из localStorage
        users.forEach(u => {
            if (!u.avatar) {
                const localAvatar = localStorage.getItem(`avatar_${u.username}`);
                if (localAvatar) u.avatar = localAvatar;
            }
        });
    }

    function saveUsers() {
        // deprecated: users/password hashes теперь должны жить в SeaTable
        try {
            localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
        } catch {}
    }

    // Синхронизация пользователя с SeaTable
    async function syncUserToSeaTable(user, action, lookupUsername) {
        const targetUsername = lookupUsername || user.username;
        try {
            console.log('[syncUserToSeaTable] action:', action, 'user:', targetUsername, 'hasAvatar:', !!user.avatar);
            if (action === 'create') {
                await apiRequest(API_USERS, {
                    method: 'POST',
                    body: JSON.stringify({ user })
                });
            } else if (action === 'update') {
                await apiRequest(`${API_USERS}?username=${encodeURIComponent(targetUsername)}`, {
                    method: 'PUT',
                    body: JSON.stringify({ user, username: targetUsername })
                });
            } else if (action === 'delete') {
                await apiRequest(`${API_USERS}?username=${encodeURIComponent(targetUsername)}`, {
                    method: 'DELETE',
                    body: JSON.stringify({ username: targetUsername })
                });
            }
        } catch (error) {
            console.error('[syncUserToSeaTable] error:', error.message);
            showToast('Ошибка синхронизации: ' + error.message, 'error');
        }
    }

    function resetSessionTimer() {
        if (sessionTimer) clearTimeout(sessionTimer);
        if (!currentUser) return;
        sessionTimer = setTimeout(() => {
            showToast('Сессия истекла. Выполните вход повторно.', 'warning');
            logoutUser();
        }, SESSION_TIMEOUT);
    }

    function findUserByUsername(username) {
        return users.find(u => u.username === username);
    }

    function isCurrentUserIdentity(username) {
        return Boolean(currentUser && currentUser.username === username);
    }

    function migrateAvatarStorageKey(previousUsername, nextUsername) {
        if (!previousUsername || !nextUsername || previousUsername === nextUsername) return;
        const prevKey = `avatar_${previousUsername}`;
        const nextKey = `avatar_${nextUsername}`;
        const savedAvatar = localStorage.getItem(prevKey);
        if (!savedAvatar || localStorage.getItem(nextKey)) return;
        localStorage.setItem(nextKey, savedAvatar);
        localStorage.removeItem(prevKey);
    }

    async function syncTasksForUserRename(oldFullName, newFullName) {
        if (!oldFullName || !newFullName || oldFullName === newFullName) return;

        const toUpdate = [];
        databases.forEach(db => db.tasks.forEach(t => {
            let changed = false;
            if (t.author === oldFullName) {
                t.author = newFullName;
                changed = true;
            }
            if (t.assignee === oldFullName) {
                t.assignee = newFullName;
                changed = true;
            }
            if (changed) {
                toUpdate.push(t);
            }
        }));

        if (!toUpdate.length) return;

        renderTasks();
        updateStats();
        savePersistedData();

        let syncFailed = false;
        for (const task of toUpdate) {
            const rowId = task.row_id || taskRowMap.get(task.id);
            if (!rowId) continue;
            try {
                await apiRequest(`${API_BASE}/${task.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ ...task, row_id: rowId, id: task.id }),
                    timeoutMs: 20000
                });
            } catch (err) {
                syncFailed = true;
                console.error('Не удалось синхронизировать обновлённые данные пользователя в задачах', err);
            }
        }

        if (syncFailed) {
            setSyncBanner('Часть задач не удалось синхронизировать после обновления пользователя.', true);
        } else {
            setSyncBanner('Данные пользователя и связанные задачи сохранены в SeaTable.');
        }
    }

    async function syncTasksForDirectionRename(oldName, newName) {
        if (!oldName || !newName || oldName === newName) return;

        const toUpdate = [];
        databases.forEach(db => db.tasks.forEach(t => {
            let changed = false;
            if (t.department === oldName) {
                t.department = newName;
                changed = true;
            }
            // В некоторых данных "type" дублирует направление (мы так создаём новые заявки).
            if (t.type === oldName) {
                t.type = newName;
                changed = true;
            }
            if (changed) toUpdate.push(t);
        }));

        if (!toUpdate.length) return;

        refreshTaskRelatedUi();

        let syncFailed = false;
        for (const task of toUpdate) {
            const rowId = task.row_id || taskRowMap.get(task.id);
            if (!rowId) continue;
            try {
                await apiRequest(`${API_BASE}/${task.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ ...task, row_id: rowId, id: task.id }),
                    timeoutMs: 20000
                });
            } catch (err) {
                syncFailed = true;
                console.error('Не удалось синхронизировать направление в задаче', err);
            }
        }

        if (syncFailed) {
            setSyncBanner('Часть задач не удалось синхронизировать после изменения направления.', true);
        } else {
            setSyncBanner('Направления в задачах обновлены и синхронизированы с SeaTable.');
        }
    }

async function addUser(userData) {
        const passwordHash = await hashPassword(userData.password);
        const role = userData.role || 'employee';
        
        // Если admin и несколько ФИО через запятую - создаём отдельных пользователей
        if (role === 'admin' && userData.fullName.includes(',')) {
            const names = userData.fullName.split(',').map(n => n.trim()).filter(Boolean);
            for (const name of names) {
                const newUser = {
                    username: sanitizeHTML(userData.username),
                    passwordHash,
                    role: 'admin',
                    department: sanitizeHTML(userData.department || ''),
                    fullName: name,
                    position: sanitizeHTML(userData.position || ''),
                    email: sanitizeHTML(userData.email || ''),
                    phone: sanitizeHTML(userData.phone || ''),
                    office: sanitizeHTML(userData.office || '')
                };
                users.push(newUser);
                void syncUserToSeaTable(newUser, 'create');
            }
            localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
            return { success: true };
        }
        
        // Обычный случай - один пользователь
        const newUser = {
            username: sanitizeHTML(userData.username),
            passwordHash,
            role: role,
            department: sanitizeHTML(userData.department || ''),
            fullName: sanitizeHTML(userData.fullName),
            position: sanitizeHTML(userData.position || ''),
            email: sanitizeHTML(userData.email || ''),
            phone: sanitizeHTML(userData.phone || ''),
            office: sanitizeHTML(userData.office || '')
        };
        users.push(newUser);
        void syncUserToSeaTable(newUser, 'create');
        localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
        return { success: true, user: newUser };
    }

    async function editUser(username, userData) {
        // Если это текущий пользователь - используем currentUser напрямую
        let user = null;
        if (currentUser && currentUser.username === username) {
            user = currentUser;
        } else {
            // Иначе ищем в массиве пользователей
            if (users.length === 0) {
                const stored = localStorage.getItem(USERS_STORAGE_KEY);
                if (stored) {
                    try { users = JSON.parse(stored); } catch {}
                }
            }
            user = users.find(u => u.username === username);
        }
        if (!user) return { success: false, error: 'Пользователь не найден' };

        const previousUsername = user.username;

        user.username = sanitizeHTML(userData.username);
        user.fullName = sanitizeHTML(userData.fullName);
        user.position = sanitizeHTML(userData.position || '');
        user.department = sanitizeHTML(userData.department || '');
        user.role = userData.role || user.role || 'employee';
        user.email = sanitizeHTML(userData.email || '');
        user.phone = sanitizeHTML(userData.phone || '');
        user.office = sanitizeHTML(userData.office || '');
        if (userData.avatar) user.avatar = userData.avatar;
        
        // Если пароль изменён
        if (userData.password && userData.password.trim()) {
            user.passwordHash = await hashPassword(userData.password);
        }
        
        localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
        
        migrateAvatarStorageKey(previousUsername, user.username);
        if (isCurrentUserIdentity(previousUsername)) {
            currentUser = { ...user };
            updateHeaderAvatar();
        }

        await syncTasksForUserRename(userData.originalFullName, user.fullName);
        void syncUserToSeaTable(user, 'update', previousUsername);
        return { success: true, user };
    }

    function deleteUser(username) {
        const idx = users.findIndex(u => u.username === username);
        if (idx < 0) return { success: false, error: 'Пользователь не найден' };
        const deletedUser = users[idx];
        users.splice(idx, 1);
        localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
        void syncUserToSeaTable(deletedUser, 'delete');
        return { success: true };
    }

    function showConfirmModal(title, message, onConfirm) {
        const modal = document.getElementById('confirmModal');
        if (!modal) { if (confirm(title + '\n' + message)) onConfirm(); return; }
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        const confirmBtn = document.getElementById('confirmConfirmBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        const handler = () => { modal.classList.remove('show'); confirmBtn.removeEventListener('click', handler); cancelBtn.removeEventListener('click', cancelHandler); if (onConfirm) onConfirm(); };
        const cancelHandler = () => { modal.classList.remove('show'); };
        confirmBtn.addEventListener('click', handler);
        cancelBtn.addEventListener('click', cancelHandler);
        modal.classList.add('show');
    }

    function showToast(message, type = 'success') {
        const settings = getAppSettings();
        const notificationsEnabled = Boolean(settings.desktopNotifications);
        if (!notificationsEnabled && type !== 'error' && type !== 'warning') {
            return;
        }
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.background = type === 'error' ? 'var(--danger)' : (type === 'warning' ? 'var(--warning)' : 'var(--primary)');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // ==================== ДАННЫЕ ====================
    const databases = [
        { id: 'db1', name: 'Основная', tasks: [] },
        { id: 'db2', name: 'Проекты', tasks: [] }
    ];

    const SUPPORT_DIRECTIONS = [
        'Информационные системы',
        'Программное обеспечение',
        'Принтеры и оргтехника',
        'Компьютеры, моноблоки, ноутбуки',
        'ВКС, сопровождение мероприятий',
        'Интернет и сеть',
        'Работа с сайтом',
        'Консультирование',
        'Пароли и доступ',
        'Документация и НПА',
        'Электронная подпись',
        'Презентации и дизайн',
        'Содействие в закупках',
        'Информационная безопасность',
        'Перенос техники, подготовка нового РМ',
        'Телефонная связь',
        'Перевести из PDF в Word',
        // Направления, полезные для аналитических задач
        'Аналитика и отчётность',
        'Анализ SLA и качество сервиса',
        'BI / Дашборды',
        'Сбор требований и ТЗ',
        // Организационные задачи
        'Забронировать зал Коллегии',
        'Идеи и предложения'
    ];
    const FALLBACK_DIRECTION_ON_DELETE = 'Идеи и предложения';
    let FULL_DEPARTMENTS = [];

    let currentDatabaseId = 'db1';
    let currentUser = null;
    let notifications = [];
    let nextTaskId = 2000;
    let eventsBound = false;
    let activeQuickFilter = '';
    let healthPingTimer = null;
    const taskRowMap = new Map();

    // Пагинация
    let currentPage = 1;
    let pageSize = 25;
    const PAGE_SIZES = [25, 50, 100];
    const API_BASE = '/api/tasks';

    // Rate limiting
    const LOGIN_ATTEMPTS_KEY = 'loginAttempts';
    const MAX_LOGIN_ATTEMPTS = 5;
    const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 минут
    const API_USERS = '/api/users';
    const API_DIRECTIONS = '/api/directions';
    const API_ACTIVITY = '/api/activity';
    const API_HEALTH = '/api/health';
    const API_AUTH_LOGIN = '/api/auth/login';
    const API_AUTH_ME = '/api/auth/me';
    const API_AUTH_LOGOUT = '/api/auth/logout';

    const DEFAULT_ACTIVITY_DIRECTIONS = [
        'Управление делами',
        'Правовое обеспечение',
        'Финансовый контроль',
        'Информационные технологии',
        'Кадры',
        'Документооборот',
        'Аналитическая работа',
        'Международные связи',
        'Пресс-служба'
    ];

    // Стандартные пользователи (для первой инициализации)
    const DEFAULT_USERS = [
        { username: 'admin', password: 'admin123', role: 'admin', department: 'IT', fullName: 'Администратор Системы', position: 'Главный администратор', email: 'admin@it-sp.ru', phone: '+7 (999) 111-11-11', office: '222' },
        { username: 'employee', password: 'employee123', role: 'employee', department: 'IT', fullName: 'Петров Алексей Иванович', position: 'Специалист', email: 'employee@it-sp.ru', phone: '+7 (999) 333-33-33', office: '229' }
    ];

    let users = [];

    let employeesData = [];
    // Локальный справочник направлений (можно редактировать на вкладке "Направления")
    // Направления грузятся из SeaTable, чтобы они были одинаковыми на всех устройствах.
    let departmentsData = [];
    let activityData = [];

    // ==================== Уведомления (per-user, localStorage) ====================
    const NOTIFICATIONS_STORAGE_PREFIX = 'taskPlannerNotifications_v2_';
    const MAX_STORED_NOTIFICATIONS = 20;

    function notificationsStorageKey(username) {
        return NOTIFICATIONS_STORAGE_PREFIX + (username || '');
    }

    function readNotificationsForUser(username) {
        if (!username) return [];
        try {
            const raw = localStorage.getItem(notificationsStorageKey(username));
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function writeNotificationsForUser(username, list) {
        if (!username) return;
        const trimmed = list.slice(0, MAX_STORED_NOTIFICATIONS);
        try {
            localStorage.setItem(notificationsStorageKey(username), JSON.stringify(trimmed));
        } catch (e) {
            console.warn('[notifications] save failed', e);
        }
    }

    function appendNotificationForUsername(username, message, taskId) {
        if (!username || !message) return;
        const list = readNotificationsForUser(username);
        list.unshift({ id: Date.now() + Math.random(), message, taskId, read: false });
        writeNotificationsForUser(username, list);
        if (currentUser && currentUser.username === username) {
            notifications = list;
            updateNotificationBadge();
        }
    }

    function notifyCurrentAdmin(message, taskId) {
        if (!currentUser) return;
        if (currentUser.role === 'admin') {
            appendNotificationForUsername(currentUser.username, message, taskId);
        } else {
            const admin = users.find(u => u.role === 'admin');
            if (admin) {
                appendNotificationForUsername(admin.username, message, taskId);
            }
        }
    }

    /** Сопоставление ФИО из задачи с учётной записью (в т.ч. формат «Фамилия, Имя»). */
    function resolveUsernameByFullName(fullName) {
        if (!fullName || !users.length) return null;
        const target = String(fullName).trim();
        for (const u of users) {
            if (!u.fullName) continue;
            if (u.fullName === target) return u.username;
            const parts = u.fullName.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.includes(target)) return u.username;
        }
        return null;
    }

    function notifyTaskCreated(newTask) {
        const taskId = newTask.id;
        const title = newTask.title || '';
        notifyCurrentAdmin(`Новая заявка #${taskId} от ${newTask.author}: ${title}`, taskId);
        const un = resolveUsernameByFullName(newTask.author);
        const authorUser = un ? findUserByUsername(un) : null;
        if (authorUser && authorUser.role === 'employee') {
            appendNotificationForUsername(un, `Ваша заявка #${taskId} создана: ${title}`, taskId);
        }
    }

    function notifyTaskTerminalStatus(task, prevStatus) {
        if (prevStatus === task.status) return;
        if (task.status !== 'Завершена' && task.status !== 'Отклонена') return;
        const title = task.title || '';
        const id = task.id;
        if (task.status === 'Завершена') {
            notifyCurrentAdmin(`Заявка #${id} завершена (${task.author}): ${title}`, id);
            const un = resolveUsernameByFullName(task.author);
            const authorUser = un ? findUserByUsername(un) : null;
            if (authorUser && authorUser.role === 'employee') {
                appendNotificationForUsername(un, `Ваша заявка #${id} выполнена: ${title}`, id);
            }
        } else {
            notifyCurrentAdmin(`Заявка #${id} отклонена (${task.author}): ${title}`, id);
            const un = resolveUsernameByFullName(task.author);
            const authorUser = un ? findUserByUsername(un) : null;
            if (authorUser && authorUser.role === 'employee') {
                appendNotificationForUsername(un, `Ваша заявка #${id} отклонена: ${title}`, id);
            }
        }
    }

    function loadUserNotifications() {
        if (!currentUser) {
            notifications = [];
            updateNotificationBadge();
            return;
        }
        notifications = readNotificationsForUser(currentUser.username);
        updateNotificationBadge();
    }

    function persistCurrentUserNotifications() {
        if (!currentUser) return;
        writeNotificationsForUser(currentUser.username, notifications);
    }

    // ==================== DOM ====================
    const loginScreen = document.getElementById('loginScreen');
    const app = document.getElementById('app');
    const loginForm = document.getElementById('loginForm');
    const sidebar = document.getElementById('sidebar');
    const burgerBtn = document.getElementById('burgerBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const views = document.querySelectorAll('.view');
    const menuItems = document.querySelectorAll('.menu-item[data-view]');
    const roleDisplay = document.getElementById('roleDisplay');
    const roleName = document.getElementById('roleName');
    const tasksTbody = document.getElementById('tasksTableBody');
    const quickTaskModal = document.getElementById('quickTaskModal');
    const taskDetailModal = document.getElementById('taskDetailModal');
    const quickTaskForm = document.getElementById('quickTaskForm');
    const taskDetailForm = document.getElementById('taskDetailForm');
    const profileModal = document.getElementById('profileModal');
    const notificationsModal = document.getElementById('notificationsModal');
    const notificationBadge = document.getElementById('notificationBadge');
    const notificationCount = document.getElementById('notificationCount');
    const notificationsList = document.getElementById('notificationsList');
    const filterDatabase = document.getElementById('filterDatabase');
    const filterDepartment = document.getElementById('filterDepartment');
    const filterPriority = document.getElementById('filterPriority');
    const filterStatus = document.getElementById('filterStatus');
    const filterDate = document.getElementById('filterDate');
    const setTodayFilterBtn = document.getElementById('setTodayFilterBtn');
    const searchTask = document.getElementById('searchTask');
    const resetFiltersBtn = document.getElementById('resetFiltersBtn');
    const sortTasks = document.getElementById('sortTasks');
    const exportTasksBtn = document.getElementById('exportTasksBtn');
    const openQuickTaskBtn = document.getElementById('openQuickTaskBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const profileBtn = document.getElementById('profileBtn');
    const headerAvatar = document.getElementById('headerAvatar');
    const headerAvatarIcon = document.getElementById('headerAvatarIcon');
    const setTodayDeadlineBtn = document.getElementById('setTodayDeadlineBtn');
    const quickTaskDeadline = document.getElementById('quickTaskDeadline');
    const quickTaskAttachmentInput = document.getElementById('quickTaskAttachmentInput');
    const supportDirectionsList = document.getElementById('supportDirectionsList');
    const themeSelect = document.getElementById('themeSelect');
    const compactModeInput = document.getElementById('compactMode');
    const desktopNotificationsInput = document.getElementById('desktopNotifications');
    const defaultViewSelect = document.getElementById('defaultView');
    const settingsForm = document.getElementById('settingsForm');
    const reportDatabase = document.getElementById('reportDatabase');
    const toggleDetailedStatsBtn = document.getElementById('toggleDetailedStatsBtn');
    const statNewTasks = document.getElementById('statNewTasks');
    const selectAllTasks = document.getElementById('selectAllTasks');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const toastContainer = document.getElementById('toastContainer');
    const basesListContainer = document.getElementById('basesList'); // элемент списка баз
    const quickFilterButtons = document.querySelectorAll('.quick-filter-btn');
    const quickFiltersRow = document.querySelector('.quick-filters-row');
    const syncStatusBanner = document.getElementById('syncStatusBanner');
    const seatableHealthBadge = document.getElementById('seatableHealthBadge');
    const seatableHealthText = document.getElementById('seatableHealthText');
    const addTaskCommentBtn = document.getElementById('addTaskCommentBtn');
    const taskCommentInput = document.getElementById('taskCommentInput');
    const taskCommentsList = document.getElementById('taskCommentsList');
    const taskHistoryList = document.getElementById('taskHistoryList');
    const taskHistoryFilter = document.getElementById('taskHistoryFilter');
    const taskAttachmentsList = document.getElementById('taskAttachmentsList');
    const taskAttachmentInput = document.getElementById('taskAttachmentInput');
    const addTaskAttachmentBtn = document.getElementById('addTaskAttachmentBtn');
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    const DEFAULT_SETTINGS = {
        theme: 'light',
        compactMode: false,
        desktopNotifications: true,
        defaultView: 'tasks'
    };
    const TASK_STATUSES = ['Новая', 'В работе', 'Завершена', 'Отклонена'];
    const PRIORITIES = ['Критический', 'Высокий', 'Средний', 'Низкий'];
    const STORAGE_KEY = 'taskPlannerDataV1';
    const SLA_DAYS_BY_PRIORITY = { 'Критический': 1, 'Высокий': 2, 'Средний': 3, 'Низкий': 5 };
    const STATUS_TRANSITIONS = {
        'Новая': ['В работе', 'Отклонена'],
        'В работе': ['Завершена', 'Отклонена'],
        'Завершена': [],
        'Отклонена': []
    };
    let dataLoaded = false;
    const SeaTableAdapter = {
        toRecord(task) {
            return {
                id: task.id,
                created_at: task.createdAt,
                updated_at: task.updatedAt,
                type: task.type,
                title: task.title,
                description: task.description,
                author: task.author,
                assignee: task.assignee,
                department: task.department,
                priority: task.priority,
                status: task.status,
                deadline: task.deadline,
                sla_days: task.slaDays,
                closed_at: task.closedAt || '',
                rejected_reason: task.rejectedReason || ''
            };
        },
        fromRecord(record) {
            return {
                id: Number(record.id),
                createdAt: record.created_at,
                updatedAt: record.updated_at,
                type: record.type || '',
                title: record.title || '',
                description: record.description || '',
                author: record.author || '',
                assignee: record.assignee || '',
                department: record.department || '',
                priority: PRIORITIES.includes(record.priority) ? record.priority : 'Средний',
                status: TASK_STATUSES.includes(record.status) ? record.status : 'Новая',
                deadline: record.deadline || '',
                slaDays: Number(record.sla_days) || SLA_DAYS_BY_PRIORITY['Средний'],
                closedAt: record.closed_at || '',
                rejectedReason: record.rejected_reason || '',
                comments: [],
                history: [],
                attachments: []
            };
        }
    };

    function purgeLocalPlannerData() {
        // Требование: данные по задачам/направлениям/базам не должны подтягиваться локально после F5.
        // Оставляем localStorage только для UI-настроек, аватаров и хэшей паролей пользователей.
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {}
    }

    function buildDefaultTaskTitle({ department, description }) {
        const dept = String(department || '').trim();
        const desc = String(description || '').replace(/\s+/g, ' ').trim();
        const snippet = desc ? desc.slice(0, 80) : '';
        if (dept && snippet) return `Заявка: ${dept} — ${snippet}${desc.length > 80 ? '…' : ''}`;
        if (dept) return `Заявка: ${dept}`;
        if (snippet) return `Заявка: ${snippet}${desc.length > 80 ? '…' : ''}`;
        return 'Заявка';
    }

    function canUseDatabaseScopes() {
        return currentUser && currentUser.role === 'admin';
    }

    function getCurrentDatabase() {
        return databases.find(d => d.id === currentDatabaseId) || null;
    }

    function loadPersistedData() {
        // Направления теперь берём из SeaTable, поэтому локальная загрузка не нужна.
        departmentsData = [];
    }

    function savePersistedData() {
        // no-op: intentionally do not persist planner data
    }

    function syncDepartmentsFromApi() {
        // больше не синхронизируем направления с SeaTable — это локальный справочник UI
    }

    async function fetchDirectionsFromApi() {
        const payload = await apiRequest(API_DIRECTIONS, { timeoutMs: 12000 });
        const directions = Array.isArray(payload?.directions) ? payload.directions : [];
        return directions.map(d => ({ name: String(d?.name || '').trim() })).filter(d => d.name);
    }

    async function seedDirectionsIfEmpty() {
        const current = await fetchDirectionsFromApi();
        if (current.length > 0) return current;
        const existing = new Set(current.map(d => d.name));

        // Добавляем все стандартные направления, которых ещё нет в SeaTable.
        const seedNames = Array.from(
            new Set(SUPPORT_DIRECTIONS.map(n => String(n).trim()).filter(Boolean))
        );

        for (const name of seedNames) {
            if (existing.has(name)) continue;
            try {
                await apiRequest(API_DIRECTIONS, {
                    method: "POST",
                    body: JSON.stringify({ name }),
                    timeoutMs: 12000,
                });
            } catch (e) {
                // Если кто-то параллельно добавил то же значение — игнорируем.
                const msg = e?.message || String(e);
                if (!msg.toLowerCase().includes("уже существует")) throw e;
            }
        }

        const refreshed = await fetchDirectionsFromApi();
        if (refreshed.length > 0) return refreshed;
        return seedNames.map(name => ({ name }));
    }

    async function initDirections() {
        try {
            // SeaTable - основной источник истины.
            const fromApi = await fetchDirectionsFromApi();
            const loaded = fromApi.length ? fromApi : await seedDirectionsIfEmpty();
            departmentsData = loaded;
            FULL_DEPARTMENTS = Array.from(new Set(departmentsData.map(d => d.name))).filter(Boolean);
        } catch (error) {
            console.error('[initDirections] failed', error);
            departmentsData = SUPPORT_DIRECTIONS.map(name => ({ name }));
            FULL_DEPARTMENTS = Array.from(new Set(departmentsData.map(d => d.name))).filter(Boolean);
            showToast(`Не удалось загрузить направления из SeaTable: ${error?.message || String(error)}`, 'error');
        }
    }

    async function fetchActivityFromApi() {
        const payload = await apiRequest(API_ACTIVITY, { timeoutMs: 12000 });
        const directions = Array.isArray(payload?.directions) ? payload.directions : [];
        return directions.map(d => ({ name: String(d?.name || '').trim(), row_id: d?._id || d?.row_id })).filter(d => d.name);
    }

    async function seedActivityIfEmpty() {
        const current = await fetchActivityFromApi();
        if (current.length > 0) return current;
        const existing = new Set(current.map(d => d.name));
        for (const name of DEFAULT_ACTIVITY_DIRECTIONS) {
            if (existing.has(name)) continue;
            try {
                await apiRequest(API_ACTIVITY, {
                    method: "POST",
                    body: JSON.stringify({ name }),
                    timeoutMs: 12000,
                });
            } catch (e) {}
        }
        const refreshed = await fetchActivityFromApi();
        return refreshed.length ? refreshed : DEFAULT_ACTIVITY_DIRECTIONS.map(name => ({ name }));
    }

    async function initActivity() {
        try {
            const fromApi = await fetchActivityFromApi();
            const loaded = fromApi.length ? fromApi : await seedActivityIfEmpty();
            activityData = loaded;
        } catch (error) {
            console.error('[initActivity] failed', error);
            activityData = DEFAULT_ACTIVITY_DIRECTIONS.map(name => ({ name }));
        }
    }

    function renderActivity() {
        const tbody = document.getElementById('activityTableBody');
        if (!tbody) return;
        tbody.innerHTML = activityData.map(d => `
            <tr>
                <td>${escapeHtml(d.name)}</td>
                <td>
                    <button class="icon-btn edit-activity-btn" data-row-id="${escapeAttr(d.row_id)}" title="Редактировать"><i class="fas fa-pen"></i></button>
                    <button class="icon-btn delete-activity-btn" data-row-id="${escapeAttr(d.row_id)}" data-name="${escapeHtml(d.name)}" title="Удалить" style="margin-left:4px;"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="2">Нет направлений</td></tr>';
        
        document.querySelectorAll('.edit-activity-btn').forEach(btn => btn.addEventListener('click', function() {
            openEditActivityModal(this.dataset.rowId);
        }));
        
        document.querySelectorAll('.delete-activity-btn').forEach(btn => btn.addEventListener('click', function() {
            const rowId = this.dataset.rowId;
            const name = this.dataset.name;
            showConfirmModal('Удалить направление?', `Направление "${name}" будет удалено.`, async () => {
                try {
                    await apiRequest(API_ACTIVITY, { method: 'DELETE', body: JSON.stringify({ row_id: rowId }), timeoutMs: 12000 });
                    await initActivity();
                    renderActivity();
                    showToast('Направление удалено', 'success');
                } catch (error) {
                    showToast('Ошибка удаления: ' + error.message, 'error');
                }
            });
        }));
    }

    function refreshTaskRelatedUi() {
        renderTasks();
        updateStats();
        const detailedStats = document.getElementById('detailedStats');
        if (detailedStats && detailedStats.style.display === 'block') {
            renderDetailedStats();
        }
        populateDepartmentSelects();
        renderBasesList();
        savePersistedData();
    }

    function logoutUser() {
        if (sessionTimer) clearTimeout(sessionTimer);
        if (healthPingTimer) {
            clearInterval(healthPingTimer);
            healthPingTimer = null;
        }
        notifications = [];
        if (notificationCount) notificationCount.textContent = '0';
        currentUser = null;
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        app.style.display = 'none';
        loginScreen.style.display = 'flex';
        sidebar.classList.remove('open');
        activeQuickFilter = '';
        void apiRequest(API_AUTH_LOGOUT, { method: 'POST' }).catch(() => {});
    }

    function getAppSettings() {
        const savedSettings = JSON.parse(localStorage.getItem('appSettings')) || {};
        return { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    function saveAppSettings(settings) {
        localStorage.setItem('appSettings', JSON.stringify(settings));
    }

    function updateAppSettings(patch) {
        const nextSettings = { ...getAppSettings(), ...patch };
        saveAppSettings(nextSettings);
        return nextSettings;
    }

    function getAllowedStartViews() {
        const baseViews = ['tasks', 'settings'];
        if (canUseDatabaseScopes()) return [...baseViews, 'reports', 'bases'];
        return baseViews;
    }

    function resolveStartView(requestedView) {
        const allowedViews = getAllowedStartViews();
        return allowedViews.includes(requestedView) ? requestedView : 'tasks';
    }

    function applyUiSettings(settings) {
        document.body.classList.toggle('theme-dark', settings.theme === 'dark');
        document.body.classList.toggle('compact-mode', Boolean(settings.compactMode));
        document.body.classList.toggle('notifications-muted', !Boolean(settings.desktopNotifications));
    }

    function updateDefaultViewOptions() {
        if (!defaultViewSelect || !currentUser) return;
        const allowedViews = getAllowedStartViews();
        Array.from(defaultViewSelect.options).forEach(option => {
            option.hidden = !allowedViews.includes(option.value);
        });
        defaultViewSelect.value = resolveStartView(defaultViewSelect.value);
    }

    function resetTaskFiltersForSession() {
        activeQuickFilter = '';
        currentPage = 1;
        quickFilterButtons.forEach(b => b.classList.remove('active'));
        if (filterDepartment) filterDepartment.value = '';
        if (filterPriority) filterPriority.value = '';
        if (filterStatus) filterStatus.value = '';
        if (filterDate) filterDate.value = '';
        if (searchTask) searchTask.value = '';
        if (sortTasks) sortTasks.value = 'createdAt_desc';
    }

    function normalizeTask(task) {
        // task.status = 'Завершена' убрано - теперь используется 'Завершена'
        if (!TASK_STATUSES.includes(task.status)) task.status = 'Новая';
        task.title = task.title || task.description || `Заявка #${task.id}`;
        task.assignee = task.assignee || '';
        if (!PRIORITIES.includes(task.priority)) task.priority = 'Средний';
        task.createdAt = toLocalDateYmd(task.createdAt) || getTodayYmd();
        task.updatedAt = task.updatedAt || task.createdAt || new Date().toISOString().split('T')[0];
        task.deadline = toLocalDateYmd(task.deadline);
        task.slaDays = Number(task.slaDays) || SLA_DAYS_BY_PRIORITY[task.priority] || 3;
        task.assignedAt = task.assignedAt || '';
        task.inProgressAt = task.inProgressAt || '';
        task.reviewAt = task.reviewAt || '';
        task.closedAt = task.closedAt || '';
        task.rejectedAt = task.rejectedAt || '';
        task.rejectedReason = task.rejectedReason || '';
        task.comments = Array.isArray(task.comments) ? task.comments : [];
        task.history = Array.isArray(task.history) ? task.history : [];
        task.attachments = Array.isArray(task.attachments) ? task.attachments : [];
    }

    function getDateWithOffset(days) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return toLocalDateYmd(date);
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Не удалось прочитать файл вложения'));
            reader.readAsDataURL(file);
        });
    }

    function resolveAttachmentUrl(attachment) {
        const raw = String(attachment?.url || attachment?.dataUrl || attachment?.download_link || attachment?.file_url || '').trim();
        if (!raw) return '';
        if (raw.startsWith('data:')) return raw;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (raw.startsWith('/')) return raw;
        return `https://cloud.seatable.io${raw.startsWith('/') ? '' : '/'}${raw}`;
    }

    function formatAttachmentSize(size) {
        const value = Number(size || 0);
        if (!Number.isFinite(value) || value <= 0) return '';
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    function validateTaskShape(task) {
        if (!task.title || !task.title.trim()) return 'Тема заявки обязательна';
        if (!task.description || !task.description.trim()) return 'Описание заявки обязательно';
        if (!PRIORITIES.includes(task.priority)) return 'Некорректный приоритет';
        if (!TASK_STATUSES.includes(task.status)) return 'Некорректный статус';
        if (!task.department) return 'Направление техподдержки обязательно';
        if (task.status === 'Отклонена' && !task.rejectedReason?.trim()) return 'Укажите причину отклонения';
return '';  // OK
    }

    function getAssignableEmployees() {
        const allNames = [];
        users.filter(u => u.role === 'admin').forEach(u => {
            if (!u.fullName) return;
            const names = u.fullName.split(',').map(n => n.trim()).filter(Boolean);
            names.forEach(name => {
                if (!allNames.includes(name)) allNames.push(name);
            });
        });
        return allNames.sort();
    }

    function addHistoryEntry(task, action) {
        task.history.push({
            at: new Date().toISOString(),
            by: currentUser ? currentUser.fullName : 'Система',
            action
        });
    }

    function canViewTask(task) {
        if (!currentUser) return false;
        if (currentUser.role === 'admin') return true;
        return task.author === currentUser.fullName;
    }

    function canAssignTask(task) {
        if (!currentUser) return false;
        return currentUser.role === 'admin' && canViewTask(task);
    }

    function canEditTask(task) {
        if (!currentUser) return false;
        if (!canViewTask(task)) return false;
        if (currentUser.role === 'admin') return task.status !== 'Завершена';
        return task.author === currentUser.fullName && task.status === 'Новая';
    }

    function canDeleteTask(task) {
        if (!currentUser) return false;
        if (!canViewTask(task)) return false;
        if (currentUser.role === 'admin') return true;
        return false;  // Сотрудник не может удалять задачи
    }

    function getEditDeniedReason(task) {
        if (!currentUser) return 'Нужно войти в систему';
        if (!canViewTask(task)) return 'Нет доступа к заявке';
        if (task.status === 'Завершена') return 'Закрытые заявки нельзя редактировать';
        if (currentUser.role === 'employee' && task.author !== currentUser.fullName) return 'Сотрудник редактирует только свои заявки';
        if (currentUser.role === 'employee' && task.status !== 'Новая') return 'Сотрудник редактирует только новые заявки';
        return 'Недостаточно прав';
    }

    function getDeleteDeniedReason(task) {
        if (!currentUser) return 'Нужно войти в систему';
        if (!canViewTask(task)) return 'Нет доступа к заявке';
        if (currentUser.role === 'admin' && task.status === 'Завершена') return 'Руководитель не удаляет закрытые заявки';
        if (currentUser.role === 'employee' && task.author !== currentUser.fullName) return 'Можно удалять только свои заявки';
        if (currentUser.role === 'employee' && task.status !== 'Новая') return 'Можно удалять только новые заявки';
        return 'Недостаточно прав';
    }

    function canTransitionStatus(task, nextStatus) {
        if (task.status === nextStatus) return true;
        const allowed = STATUS_TRANSITIONS[task.status];
        if (!allowed) return false;
        if (currentUser.role === 'employee') {
            return nextStatus === 'В работе' || nextStatus === 'Завершена';
        }
        return allowed.includes(nextStatus);
    }

    function getAssignableEmployees() {
        // Исполнитель может быть только администратор
        return users.filter(u => u.role === 'admin').map(u => u.fullName).filter(Boolean).sort();
    }

    function findTaskContext(taskId) {
        for (const db of databases) {
            const task = db.tasks.find(t => t.id === taskId);
            if (task) return { db, task };
        }
        return null;
    }

    function setSyncBanner(message, isError = false) {
        if (!syncStatusBanner) return;
        if (!message) {
            syncStatusBanner.style.display = 'none';
            syncStatusBanner.textContent = '';
            syncStatusBanner.classList.remove('error');
            return;
        }
        syncStatusBanner.style.display = 'block';
        syncStatusBanner.textContent = message;
        syncStatusBanner.classList.toggle('error', Boolean(isError));
    }

    function setHealthBadge(state, text) {
        if (!seatableHealthBadge || !seatableHealthText) return;
        seatableHealthBadge.classList.remove('ok', 'error');
        if (state === 'ok') seatableHealthBadge.classList.add('ok');
        if (state === 'error') seatableHealthBadge.classList.add('error');
        seatableHealthText.textContent = text;
    }

    async function pingSeatableHealth() {
        setHealthBadge('', 'SeaTable: проверка...');
        try {
            const payload = await apiRequest(API_HEALTH, { timeoutMs: 9000 });
            const latency = Number(payload?.latencyMs || 0);
            setHealthBadge('ok', `SeaTable: онлайн (${latency} мс)`);
        } catch (error) {
            setHealthBadge('error', `SeaTable: недоступен`);
        }
    }

    async function apiRequest(url, options = {}) {
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const method = String(options.method || 'GET').toUpperCase();
        let response;
        try {
            response = await fetch(url, {
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                credentials: 'include',
                signal: controller.signal,
                ...(method === 'GET' ? { cache: 'no-store' } : {}),
                ...options
            });
        } catch (e) {
            if (e?.name === 'AbortError') {
                throw new Error(`Таймаут запроса (${Math.round(timeoutMs / 1000)}с)`);
            }
            throw e;
        } finally {
            clearTimeout(timeout);
        }
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `Ошибка API (${response.status})`);
        }
        return response.status === 204 ? null : response.json();
    }

    async function syncTasksFromApi() {
        lastSyncAttemptAt = Date.now();
        setSyncBanner('Синхронизация задач с SeaTable...');
        try {
            const payload = await apiRequest(API_BASE, { timeoutMs: 12000 });
            const remoteTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
            taskRowMap.clear();
            databases.forEach(db => { db.tasks = []; });
            remoteTasks.forEach((task) => {
                const normalizedTask = { ...task };
                normalizeTask(normalizedTask);
                if (task.row_id) {
                    normalizedTask.row_id = task.row_id;
                    taskRowMap.set(normalizedTask.id, task.row_id);
                }
                const db = databases.find(d => d.id === normalizedTask.databaseId) || databases[0];
                normalizedTask.databaseId = db.id;
                db.tasks.push(normalizedTask);
            });
            let maxId = 0;
            databases.forEach(db => db.tasks.forEach(t => { if (t.id > maxId) maxId = t.id; }));
            // SeaTable is the source of truth: reset local counter from remote max id.
            nextTaskId = maxId + 1;
            refreshTaskRelatedUi();
            setSyncBanner('SeaTable подключен. Данные актуальны.');
        } catch (error) {
            setSyncBanner(`Работа офлайн: ${error.message}`, true);
        }
    }

    // ==================== АВТОРИЗАЦИЯ ====================
    function scheduleSyncTasks(reason = '') {
        if (!currentUser || app.style.display === 'none') return;
        if (document.visibilityState === 'hidden') return;
        if (document.querySelector('.modal.show')) return;
        if (reason && reason !== 'online' && reason !== 'СЃРµС‚СЊ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅР°') return;
        const now = Date.now();
        if (now - lastSyncAttemptAt < 60000) return;
        if (reason) {
            setSyncBanner(`Синхронизация: ${reason}...`, false, true);
        }
        void syncTasksFromApi();
    }

    function checkLoginRateLimit() {
        const attempts = JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || '{"count":0,"lockedUntil":0}');
        const now = Date.now();
        if (attempts.lockedUntil && now < attempts.lockedUntil) {
            const remaining = Math.ceil((attempts.lockedUntil - now) / 1000 / 60);
            showToast(`Слишком много попыток. Подождите ${remaining} мин.`, 'error');
            return false;
        }
        return true;
    }

    function recordFailedLogin() {
        const attempts = JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || '{"count":0,"lockedUntil":0}');
        const now = Date.now();
        if (attempts.lockedUntil && now > attempts.lockedUntil) {
            attempts.count = 0;
            attempts.lockedUntil = 0;
        }
        attempts.count++;
        if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
            attempts.lockedUntil = now + LOCKOUT_DURATION;
            showToast(`Аккаунт заблокирован на ${LOCKOUT_DURATION/1000/60} минут`, 'error');
        }
        localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(attempts));
    }

    function clearLoginAttempts() {
        localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify({ count: 0, lockedUntil: 0 }));
    }

    loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        
        if (!checkLoginRateLimit()) return;
        
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        let user = null;
        try {
            const payload = await apiRequest(API_AUTH_LOGIN, {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            user = payload?.user || null;
        } catch (error) {}
        if (!user) {
            recordFailedLogin();
            showToast('Неверный логин или пароль', 'error');
            return;
        }
        
        clearLoginAttempts();
        currentUser = { ...user };
        // Для admin переопределяем ФИО и должность
        if (currentUser.role === 'admin') {
            currentUser.fullName = 'Администратор системы';
            currentUser.position = 'Администратор';
        }
        localStorage.setItem(ACTIVE_SESSION_KEY, currentUser.username);
        applyRole(currentUser.role);
        loginScreen.style.display = 'none';
        app.style.display = 'flex';
        try {
            await initUsers();
            await initApp();
        } catch (error) {
            console.error('[login] initApp failed', error);
            showToast(`Ошибка инициализации: ${error?.message || String(error)}`, 'error');
        }
        if (currentUser.role === 'employee') {
            switchView('tasks');
            openQuickTaskBtn.click();
        }
        resetSessionTimer();
    });

    function applyRole(role) {
        const roleNames = { admin: 'Администратор', employee: 'Сотрудник СП' };
        roleName.textContent = roleNames[role];
        document.querySelectorAll('[data-role]').forEach(el => {
            el.style.display = el.dataset.role.split(',').includes(role) ? '' : 'none';
        });
        openQuickTaskBtn.style.display = (role === 'employee' || role === 'admin' || role === 'admin') ? 'flex' : 'none';
        openQuickTaskBtn.textContent = 'Новая задача';
        const isEmployee = role === 'employee';
        exportTasksBtn.style.display = isEmployee ? 'none' : 'inline-flex';
        filterDepartment.style.display = isEmployee ? 'none' : '';
        filterDate.style.display = '';
        setTodayFilterBtn.style.display = isEmployee ? 'none' : 'inline-flex';
        sortTasks.style.display = isEmployee ? 'none' : '';
        resetFiltersBtn.style.display = isEmployee ? 'none' : 'inline-flex';
        if (quickFiltersRow) quickFiltersRow.style.display = isEmployee ? 'none' : 'flex';
        if (filterDatabase) filterDatabase.style.display = role === 'admin' ? 'block' : 'none';
        if (reportDatabase) reportDatabase.style.display = 'block';
        const canBulkDelete = role === 'admin';
        deleteSelectedBtn.style.display = canBulkDelete ? 'inline-flex' : 'none';
        selectAllTasks.style.display = canBulkDelete ? 'inline-block' : 'none';
        // Показываем раздел "Пользователи" только для admin
        const usersMenuItem = document.querySelector('.menu-item[data-view="users"]');
        if (usersMenuItem) usersMenuItem.style.display = role === 'admin' ? 'flex' : 'none';
        updateDefaultViewOptions();
    }

    async function initApp() {
        purgeLocalPlannerData();
        loadUserNotifications();
        resetTaskFiltersForSession();
        await initDirections();
        await initActivity();
        let maxId = 0;
        databases.forEach(db => db.tasks.forEach(t => {
            normalizeTask(t);
            if (t.id > maxId) maxId = t.id;
        }));
        dataLoaded = true;
        nextTaskId = maxId + 1;
        // FULL_DEPARTMENTS уже задан в initDirections().
        populateDatabaseSelects();
        populateDepartmentSelects();
        renderTasks();
        renderDepartments();
        renderActivity();
        renderBasesList();
        renderUsers();
        updateStats();
        updateNotificationBadge();
        const settings = loadSettings();
        if (!eventsBound) {
            setupEventListeners();
            eventsBound = true;
        }
        switchView(resolveStartView(settings.defaultView));
        updateHeaderAvatar();
        await syncTasksFromApi();
        void pingSeatableHealth();
        if (healthPingTimer) clearInterval(healthPingTimer);
        healthPingTimer = setInterval(() => {
            if (!currentUser || document.visibilityState === 'hidden') return;
            void pingSeatableHealth();
        }, 60000);
        resetSessionTimer();
    }

    function updateHeaderAvatar() {
        if (!currentUser) return;
        const user = findUserByUsername(currentUser.username);
        const avatarFromSeaTable = user?.avatar;
        const saved = localStorage.getItem(`avatar_${currentUser?.username}`);
        const avatar = avatarFromSeaTable || saved;
        if (avatar) {
            headerAvatar.src = avatar;
            headerAvatar.style.display = 'block';
            headerAvatarIcon.style.display = 'none';
        } else {
            headerAvatar.style.display = 'none';
            headerAvatarIcon.style.display = 'block';
        }
    }

    // ==================== SELECT'Ы ====================
    function populateDatabaseSelects() {
        const filterDbAdmin = document.getElementById('filterDatabase');
        const filterDbEmployee = document.getElementById('filterDatabaseEmployee');
        const reportDb = document.getElementById('reportDatabase');
        
        if (filterDbAdmin) {
            filterDbAdmin.style.display = currentUser?.role === 'admin' ? 'block' : 'none';
            filterDbAdmin.innerHTML = '<option value="">Все базы</option>';
            databases.forEach(db => {
                const opt = document.createElement('option');
                opt.value = db.id;
                opt.textContent = db.name;
                filterDbAdmin.appendChild(opt);
            });
            filterDbAdmin.value = currentDatabaseId;
        }
        
        if (filterDbEmployee) {
            filterDbEmployee.style.display = currentUser?.role !== 'admin' ? 'block' : 'none';
            filterDbEmployee.innerHTML = '<option value="">Все базы</option>';
            databases.forEach(db => {
                const opt = document.createElement('option');
                opt.value = db.id;
                opt.textContent = db.name;
                filterDbEmployee.appendChild(opt);
            });
            filterDbEmployee.value = currentDatabaseId;
        }
        
        if (reportDb) {
            reportDb.innerHTML = '';
            databases.forEach(db => {
                const opt = document.createElement('option');
                opt.value = db.id;
                opt.textContent = db.name;
                reportDb.appendChild(opt);
            });
            reportDb.value = currentDatabaseId;
        }
    }

    function populateDepartmentSelects() {
        if (filterDepartment) {
            const deptsInTasks = new Set();
            databases.forEach(db => db.tasks.forEach(t => deptsInTasks.add(t.department)));
            filterDepartment.innerHTML = '<option value="">Все направления</option>';
            [...deptsInTasks].filter(d => d).sort().forEach(dept => {
                const opt = document.createElement('option');
                opt.value = dept; opt.textContent = dept;
                filterDepartment.appendChild(opt);
            });
        }
        if (supportDirectionsList) {
            supportDirectionsList.innerHTML = '';
            FULL_DEPARTMENTS.forEach(dept => {
                const opt = document.createElement('option');
                opt.value = dept;
                supportDirectionsList.appendChild(opt);
            });
        }
    }

    // ==================== ЗАДАЧИ ====================
    function getCurrentDatabaseTasks() {
        const db = getCurrentDatabase();
        return db ? db.tasks : [];
    }

    function filterTasks() {
        let tasks;
        if (canUseDatabaseScopes()) {
            tasks = getCurrentDatabaseTasks();
        } else {
            tasks = [];
            databases.forEach(db => tasks.push(...db.tasks));
        }
        tasks = tasks.filter(canViewTask);
        if (filterDepartment.value) tasks = tasks.filter(t => t.department === filterDepartment.value);
        if (filterPriority.value) tasks = tasks.filter(t => t.priority === filterPriority.value);
        if (filterStatus.value) tasks = tasks.filter(t => t.status === filterStatus.value);
        if (filterDate.value) {
            const selectedDate = toLocalDateYmd(filterDate.value);
            tasks = tasks.filter(t => {
                const deadline = toLocalDateYmd(t.deadline);
                const createdAt = toLocalDateYmd(t.createdAt);
                return deadline === selectedDate || createdAt === selectedDate;
            });
        }
        if (searchTask.value) {
            const q = searchTask.value.toLowerCase();
            tasks = tasks.filter(t => t.description.toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q));
        }
        if (activeQuickFilter === 'my') {
            tasks = tasks.filter(t => t.author === currentUser.fullName || t.assignee === currentUser.fullName);
        } else if (activeQuickFilter === 'new') {
            tasks = tasks.filter(t => t.status === 'Новая');
        } else if (activeQuickFilter === 'inwork') {
            tasks = tasks.filter(t => t.status === 'В работе');
        } else if (activeQuickFilter === 'overdue') {
            const today = getTodayYmd();
            tasks = tasks.filter(t => {
                const deadline = toLocalDateYmd(t.deadline);
                return deadline && deadline < today && t.status !== 'Завершена';
            });
        }
        const priorityWeight = { 'Критический': 4, 'Высокий': 3, 'Средний': 2, 'Низкий': 1 };
        const sortMode = sortTasks?.value || 'createdAt_desc';
        tasks = tasks.slice().sort((a, b) => {
            if (sortMode === 'createdAt_asc') {
                const byDate = (a.createdAt || '').localeCompare(b.createdAt || '');
                if (byDate !== 0) return byDate;
                return Number(a.id || 0) - Number(b.id || 0);
            }
            if (sortMode === 'createdAt_desc') {
                const byDate = (b.createdAt || '').localeCompare(a.createdAt || '');
                if (byDate !== 0) return byDate;
                return Number(b.id || 0) - Number(a.id || 0);
            }
            if (sortMode === 'deadline_asc') return (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31');
            if (sortMode === 'deadline_desc') return (b.deadline || '').localeCompare(a.deadline || '');
            if (sortMode === 'priority_desc') return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
            if (sortMode === 'priority_asc') return (priorityWeight[a.priority] || 0) - (priorityWeight[b.priority] || 0);
            return 0;
        });
        return tasks;
    }

    function getDaysUntil(deadline) {
        if (!deadline) return null;
        const normalizedDeadline = toLocalDateYmd(deadline);
        if (!normalizedDeadline) return null;
        const today = new Date(); today.setHours(0,0,0,0);
        const dl = new Date(normalizedDeadline); dl.setHours(0,0,0,0);
        return Math.ceil((dl - today) / (1000*60*60*24));
    }

function getFilteredTasks() {
        return filterTasks();
    }

    function getPaginatedTasks() {
        const filtered = getFilteredTasks();
        const totalPages = Math.ceil(filtered.length / pageSize);
        if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        return filtered.slice(start, end);
    }

    function getTotalPages() {
        return Math.ceil(getFilteredTasks().length / pageSize);
    }

    function renderTasks() {
        const filtered = getFilteredTasks();
        const totalPages = getTotalPages();
        const paginatedTasks = getPaginatedTasks();
        const isMobile = window.innerWidth <= 768;
        
        // Рендер таблицы
        let html = '';
        paginatedTasks.forEach(task => {
            const statusClass = getStatusClass(task.status);
            const dbName = databases.find(d => d.id === task.databaseId)?.name || '';
            const canDelete = canDeleteTask(task);
            const canEdit = canEditTask(task);
            const editHint = canEdit ? 'Редактировать' : getEditDeniedReason(task);
            const deleteHint = canDelete ? 'Удалить' : getDeleteDeniedReason(task);
            const daysLeft = getDaysUntil(task.deadline);
            let daysDisplay = '', daysStyle = '';
            if (daysLeft !== null) {
                if (daysLeft < 0) { daysDisplay = 'Просрочено'; daysStyle = 'color:var(--danger); font-weight:bold;'; }
                else { daysDisplay = daysLeft + ' дн.'; }
            } else { daysDisplay = '—'; }
            const safeTitle = escapeHtml(task.title || '—');
            const safeDepartment = escapeHtml(task.department || '');
            const safeAuthor = escapeHtml(task.author || '');
            const safeAssignee = escapeHtml(task.assignee || '—');
            const safeOffice = escapeHtml(task.office || '');
            const safePhone = escapeHtml(task.phone || '');
            const safePriority = escapeHtml(task.priority || '');
            const safeStatus = escapeHtml(task.status || '');
            const safeDaysDisplay = escapeHtml(daysDisplay);
            const safeDbName = escapeHtml(dbName);
            const safeCreatedAt = escapeHtml(formatDate(task.createdAt));
            const safeDeadline = escapeHtml(formatDate(task.deadline));

            html += `<tr data-index="${task.id}" draggable="true" class="task-row" data-taskid="${task.id}">
                <td><input type="checkbox" class="task-checkbox" data-id="${task.id}" ${canDelete ? '' : 'disabled'}></td>
                <td>${task.id}</td><td>${safeCreatedAt}</td><td>${safeDbName}</td><td>${safeTitle}</td><td>${safeDepartment}</td>
                <td>${safeAuthor}</td><td>${safeAssignee}</td><td>${safeOffice}</td><td>${safePhone}</td>
                <td class="priority-${task.priority.toLowerCase()}">${safePriority}</td>
                <td><span class="status-badge ${statusClass}">${safeStatus}</span></td>
                <td>${safeDeadline}</td>
                <td style="${daysStyle}">${safeDaysDisplay}</td>
                <td>${task.report ? '✓' : ''}</td>
                <td class="action-buttons">
                    <button class="icon-btn view-task" title="Просмотр"><i class="fas fa-eye"></i></button>
                    <button class="icon-btn delete-task-btn ${canDelete ? '' : 'icon-btn-disabled'}" title="${deleteHint}" data-id="${task.id}" ${canDelete ? '' : 'disabled'}><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        });
        tasksTbody.innerHTML = html || `<tr><td colspan="16" style="text-align:center; padding:40px;">Нет задач</td></tr>`;
        
        // Рендер карточек для мобильных
        const cardsContainer = document.getElementById('tasksCardsContainer');
        
        if (cardsContainer) {
            let cardsHtml = '';
            paginatedTasks.forEach(task => {
                const statusClass = getStatusClass(task.status);
                const daysLeft = getDaysUntil(task.deadline);
                let daysDisplay = '';
                if (daysLeft !== null) {
                    if (daysLeft < 0) daysDisplay = '<span style="color:var(--danger); font-weight:bold;">Просрочено</span>';
                    else if (daysLeft <= 3) daysDisplay = `<span style="color:var(--warning);">${daysLeft} дн.</span>`;
                    else daysDisplay = `${daysLeft} дн.`;
                }
                
                const canDelete = canDeleteTask(task);
                
                cardsHtml += `
                    <div class="task-card" data-taskid="${task.id}">
                        <div class="task-card-header">
                            <span class="task-card-id">#${task.id}</span>
                            <span class="status-badge ${statusClass}">${escapeHtml(task.status)}</span>
                        </div>
                        <div class="task-card-title">${escapeHtml(task.title || '—')}</div>
                        <div class="task-card-meta">
                            <span class="task-card-meta-item">${escapeHtml(task.department)}</span>
                            <span class="task-card-meta-item">${escapeHtml(task.author)}</span>
                            ${task.assignee ? `<span class="task-card-meta-item">${escapeHtml(task.assignee)}</span>` : ''}
                            <span class="task-card-meta-item">${escapeHtml(formatDate(task.deadline))}</span>
                            ${daysDisplay ? `<span class="task-card-meta-item">${daysDisplay}</span>` : ''}
                        </div>
                        <div class="task-card-status">
                            <span class="priority-${task.priority.toLowerCase()}" style="font-weight:600;">${escapeHtml(task.priority)}</span>
                        </div>
                        <div class="task-card-actions">
                            <button class="btn btn-outline view-task-card" data-id="${task.id}">
                                Просмотр
                            </button>
                            ${canDelete ? `<button class="btn btn-danger delete-task-card" data-id="${task.id}">
                                Удалить
                            </button>` : ''}
                        </div>
                    </div>
                `;
            });
            cardsContainer.innerHTML = cardsHtml || '<div style="text-align:center; padding:40px; color:var(--text-muted);">Нет задач</div>';
        }
            
        // Показываем/скрываем таблицу и карточки через классы
        const tableWrapper = document.getElementById('tasksTable')?.closest('.table-wrapper');
        if (isMobile && cardsContainer) {
            if (tableWrapper) tableWrapper.style.display = 'none';
            cardsContainer.classList.add('show-mobile');
        } else {
            if (tableWrapper) tableWrapper.style.display = '';
            if (cardsContainer) cardsContainer.classList.remove('show-mobile');
        }
        
        // Рендер пагинации
        renderPagination(filtered.length, totalPages);
        
        // Перевешиваем все обработчики
        attachRowButtons();
        attachCardButtons();
        setupDragAndDrop();
        attachTaskRowClicks();
    }

    function renderPagination(totalItems, totalPages) {
        const pagination = document.getElementById('pagination');
        const paginationInfo = document.getElementById('paginationInfo');
        const paginationPages = document.getElementById('paginationPages');
        
        if (!pagination || !paginationInfo || !paginationPages) return;
        
        if (totalItems === 0) {
            pagination.style.display = 'none';
            return;
        }
        
        pagination.style.display = 'flex';
        
        const start = (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, totalItems);
        paginationInfo.textContent = `Показано ${start}-${end} из ${totalItems}`;
        
        let pagesHtml = '';
        
        pagesHtml += `<button class="pagination-btn" id="paginationPrev" ${currentPage <= 1 ? 'disabled' : ''} title="Предыдущая">
            <i class="fas fa-chevron-left"></i>
        </button>`;
        
        const maxVisiblePages = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        
        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        
        if (startPage > 1) {
            pagesHtml += `<button class="pagination-btn page-num" data-page="1">1</button>`;
            if (startPage > 2) pagesHtml += `<span class="pagination-btn" style="border:none; cursor:default;">...</span>`;
        }
        
        for (let i = startPage; i <= endPage; i++) {
            pagesHtml += `<button class="pagination-btn page-num ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) pagesHtml += `<span class="pagination-btn" style="border:none; cursor:default;">...</span>`;
            pagesHtml += `<button class="pagination-btn page-num" data-page="${totalPages}">${totalPages}</button>`;
        }
        
        pagesHtml += `<button class="pagination-btn" id="paginationNext" ${currentPage >= totalPages ? 'disabled' : ''} title="Следующая">
            <i class="fas fa-chevron-right"></i>
        </button>`;
        
        paginationPages.innerHTML = pagesHtml;
        
        document.getElementById('paginationPrev')?.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderTasks();
            }
        });
        
        document.getElementById('paginationNext')?.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderTasks();
            }
        });
        
        paginationPages.querySelectorAll('.page-num').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                if (page && page !== currentPage) {
                    currentPage = page;
                    renderTasks();
                }
            });
        });
    }

    function goToPage(page) {
        const totalPages = getTotalPages();
        if (page >= 1 && page <= totalPages) {
            currentPage = page;
            renderTasks();
        }
    }

    function attachCardButtons() {
        const cardsContainer = document.getElementById('tasksCardsContainer');
        if (!cardsContainer) return;
        
        // View buttons
        cardsContainer.querySelectorAll('.view-task-card').forEach(btn => {
            btn.removeEventListener('click', handleViewTaskCard);
            btn.addEventListener('click', handleViewTaskCard);
        });
        
        // Delete buttons
        cardsContainer.querySelectorAll('.delete-task-card').forEach(btn => {
            btn.removeEventListener('click', handleDeleteTaskCard);
            btn.addEventListener('click', handleDeleteTaskCard);
        });
        
        // Card clicks
        cardsContainer.querySelectorAll('.task-card').forEach(card => {
            card.removeEventListener('click', handleTaskCardClick);
            card.addEventListener('click', handleTaskCardClick);
        });
    }

    function handleViewTaskCard(e) {
        e.stopPropagation();
        openTaskDetail(parseInt(e.target.closest('button').dataset.id), true);
    }

    async function handleDeleteTaskCard(e) {
        e.stopPropagation();
        const btn = e.target.closest('button');
        const taskId = parseInt(btn.dataset.id);
        const context = findTaskContext(taskId);
        if (!context || !canDeleteTask(context.task)) return;
        
        showConfirmModal('Удалить задачу?', 'Вы уверены?', async () => {
            const rowId = context?.task?.row_id || taskRowMap.get(taskId);
            const snapshot = [...context.db.tasks];
            context.db.tasks = context.db.tasks.filter(t => t.id !== taskId);
            refreshTaskRelatedUi();
            try {
                await apiRequest(`${API_BASE}/${taskId}`, { method: 'DELETE', body: JSON.stringify({ row_id: rowId, id: taskId }), timeoutMs: 20000 });
                taskRowMap.delete(taskId);
                setSyncBanner('Изменения сохранены в SeaTable.');
                showToast('Задача удалена', 'success');
            } catch (error) {
                context.db.tasks = snapshot;
                refreshTaskRelatedUi();
                setSyncBanner(`Не удалось удалить задачу: ${error.message}`, true);
            }
        });
    }

    function handleTaskCardClick(e) {
        const card = e.target.closest('.task-card');
        if (!card) return;
        openTaskDetail(parseInt(card.dataset.taskid), false);
    }

    function getStatusClass(s) {
        switch(s) {
            case 'Новая': return 'status-new';
            case 'В работе': return 'status-progress';
            case 'Завершена': return 'status-done';
            case 'Отклонена': return 'status-rejected';
            default: return '';
        }
    }

    function attachRowButtons() {
        // Удаляем старые обработчики
        document.querySelectorAll('.view-task').forEach(btn => {
            btn.removeEventListener('click', handleViewTask);
            btn.addEventListener('click', handleViewTask);
        });
        document.querySelectorAll('.delete-task-btn').forEach(btn => {
            btn.removeEventListener('click', handleDeleteTaskBtn);
            btn.addEventListener('click', handleDeleteTaskBtn);
        });
    }

    function handleViewTask(e) {
        e.stopPropagation();
        const row = e.target.closest('tr');
        if (!row) return;
        openTaskDetail(parseInt(row.dataset.taskid), true);
    }

    async function handleDeleteTaskBtn(e) {
        e.stopPropagation();
        const btn = e.target.closest('button');
        if (btn.disabled) return;
        const taskId = parseInt(btn.dataset.id);
        const context = findTaskContext(taskId);
        if (!context || !canDeleteTask(context.task)) return;
        showConfirmModal('Удалить задачу?', 'Вы уверены?', async () => {
            const rowId = context?.task?.row_id || taskRowMap.get(taskId);
            const snapshot = [...context.db.tasks];
            context.db.tasks = context.db.tasks.filter(t => t.id !== taskId);
            refreshTaskRelatedUi();
            try {
                await apiRequest(`${API_BASE}/${taskId}`, { method: 'DELETE', body: JSON.stringify({ row_id: rowId, id: taskId }), timeoutMs: 20000 });
                taskRowMap.delete(taskId);
                setSyncBanner('Изменения сохранены в SeaTable.');
                showToast('Задача удалена', 'success');
            } catch (error) {
                context.db.tasks = snapshot;
                refreshTaskRelatedUi();
                setSyncBanner(`Не удалось удалить задачу: ${error.message}`, true);
            }
        });
    }

    function attachTaskRowClicks() {
        document.querySelectorAll('.task-row').forEach(row => {
            row.removeEventListener('click', handleTaskRowClick);
            row.addEventListener('click', handleTaskRowClick);
        });
    }

    function handleTaskRowClick(e) {
        if (e.target.closest('button') || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
        const row = e.target.closest('tr');
        if (!row) return;
        openTaskDetail(parseInt(row.dataset.taskid), false);
    }

    function openTaskDetail(taskId, readOnly) {
        const context = findTaskContext(taskId);
        if (!context) return;
        const task = context.task;
        if (!canViewTask(task)) return;
        document.getElementById('detailTaskId').textContent = task.id;
        const f = taskDetailForm;
        f.status.value = task.status;
        f.priority.value = task.priority;
        f.deadline.value = task.deadline || '';
        f.title.value = task.title || '';
        f.description.value = task.description;
        f.database.value = databases.find(d => d.id === task.databaseId)?.name || '';
        f.department.value = task.department;
        f.author.value = task.author;
        const assigneeOptions = [''].concat(getAssignableEmployees());
        f.assignee.innerHTML = assigneeOptions
            .map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name || 'Не назначен')}</option>`)
            .join('');
        f.assignee.value = task.assignee || '';
        f.office.value = task.office;
        f.phone.value = task.phone;
        f.report.value = task.report;
        f.rejectedReason.value = task.rejectedReason || '';
        const canEdit = !readOnly && canEditTask(task);
        const inputs = f.querySelectorAll('input:not([readonly]), select, textarea');
        inputs.forEach(i => i.disabled = !canEdit);
        Array.from(f.status.options).forEach(option => {
            option.disabled = !canTransitionStatus(task, option.value);
        });
        f.status.options[f.status.selectedIndex].disabled = false;
        if (!canAssignTask(task)) f.assignee.disabled = true;
        if (currentUser.role === 'employee' && task.author !== currentUser.fullName) f.status.disabled = true;
        if (currentUser.role === 'employee') {
            // Сотрудник не заполняет отчёт и причину отклонения вручную.
            f.report.disabled = true;
            f.rejectedReason.disabled = true;
        }
        document.getElementById('deleteTaskBtn').style.display =
            canDeleteTask(task) ? 'block' : 'none';
        const saveBtn = taskDetailForm.querySelector('button[type="submit"]');
        if (saveBtn) saveBtn.style.display = canEdit ? 'inline-flex' : 'none';
        document.getElementById('detailTaskIndex').value = taskId;
        renderTaskComments(task);
        renderTaskAttachments(task);
        if (taskHistoryFilter) taskHistoryFilter.value = 'all';
        renderTaskHistory(task);
        if (taskCommentInput) taskCommentInput.value = '';
        if (taskAttachmentInput) taskAttachmentInput.value = '';
        taskDetailModal.classList.add('show');
    }

    function renderTaskComments(task) {
        if (!taskCommentsList) return;
        taskCommentsList.innerHTML = task.comments.map(c =>
            `<div class="comment-item">
                <div class="comment-meta">${c.author} · ${new Date(c.createdAt).toLocaleString('ru-RU')}</div>
                <div>${c.text}</div>
            </div>`
        ).join('') || '<div class="comment-item"><div class="comment-meta">Комментариев пока нет</div></div>';
    }

    function renderTaskHistory(task) {
        if (!taskHistoryList) return;
        const mode = taskHistoryFilter?.value || 'all';
        const history = [...task.history].reverse().filter(entry => {
            if (mode === 'status') return entry.action.includes('Статус:');
            if (mode === 'assignee') return entry.action.includes('Исполнитель:');
            if (mode === 'comment') return entry.action.includes('Комментарий');
            return true;
        });
        taskHistoryList.innerHTML = history.map(h =>
            `<div class="comment-item">
                <div class="comment-meta">${h.by} · ${new Date(h.at).toLocaleString('ru-RU')}</div>
                <div>${h.action}</div>
            </div>`
        ).join('') || '<div class="comment-item"><div class="comment-meta">История пока пуста</div></div>';
    }

    function renderTaskAttachments(task) {
        if (!taskAttachmentsList) return;
        taskAttachmentsList.innerHTML = task.attachments.map((a, idx) =>
            `<div class="comment-item">
                <div class="comment-meta">${a.author || 'Система'} · ${a.createdAt ? new Date(a.createdAt).toLocaleString('ru-RU') : 'без даты'}</div>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <i class="fas fa-paperclip" aria-hidden="true"></i>
                    <span>${a.name || 'Файл'}</span>
                    ${formatAttachmentSize(a.size) ? `<span class="comment-meta">(${formatAttachmentSize(a.size)})</span>` : ''}
                    ${resolveAttachmentUrl(a) ? `<a href="${resolveAttachmentUrl(a)}" download="${a.name || 'file'}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">Скачать</a>` : ''}
                </div>
                <button type="button" class="icon-btn remove-attachment-btn" data-index="${idx}" title="Удалить"><i class="fas fa-trash"></i></button>
            </div>`
        ).join('') || '<div class="comment-item"><div class="comment-meta">Вложений пока нет</div></div>';
    }

    async function updateTaskFromModal() {
        const taskId = parseInt(document.getElementById('detailTaskIndex').value);
        const context = findTaskContext(taskId);
        if (!context) return false;
        const task = context.task;
        if (!canEditTask(task)) { showToast('Недостаточно прав для редактирования', 'error'); return false; }
        const f = taskDetailForm;
        const nextStatus = f.status.value;
        if (!canTransitionStatus(task, nextStatus)) {
            showToast('Недопустимый переход статуса', 'error');
            return false;
        }
        // Статусы "Назначена" и "На проверке" больше не используются
        if (nextStatus === 'Отклонена' && !f.rejectedReason.value.trim()) {
            showToast('Укажите причину отклонения', 'warning');
            return false;
        }
        const prevStatus = task.status;
        const prevAssignee = task.assignee || '';
        const draft = { ...task };
        draft.title = f.title.value.trim() || task.title;
        draft.status = f.status.value;
        draft.priority = f.priority.value;
        draft.deadline = f.deadline.value;
        draft.description = f.description.value;
        if (canAssignTask(task)) draft.assignee = f.assignee.value;
        draft.office = f.office.value;
        draft.phone = f.phone.value;
        draft.report = f.report.value;
        if (currentUser.role === 'employee') {
            draft.report = task.report || '';
            draft.rejectedReason = task.rejectedReason || '';
        }
        if (currentUser.role !== 'employee') {
            draft.rejectedReason = f.rejectedReason.value.trim();
        }
        draft.slaDays = draft.slaDays || SLA_DAYS_BY_PRIORITY[draft.priority] || 3;
        if (!draft.deadline) draft.deadline = getDateWithOffset(draft.slaDays);
        if (prevStatus !== draft.status) {
            const now = new Date().toISOString();
            if (draft.status === 'В работе') draft.inProgressAt = now;
            if (draft.status === 'Завершена') draft.closedAt = now;
            if (draft.status === 'Отклонена') draft.rejectedAt = now;
        }
        const validationError = validateTaskShape(draft);
        if (validationError) {
            showToast(validationError, 'error');
            return false;
        }
        const snapshot = JSON.parse(JSON.stringify(task));
        Object.assign(task, draft);
        task.updatedAt = new Date().toISOString().split('T')[0];
        if (prevStatus !== task.status) {
            addHistoryEntry(task, `Статус: ${prevStatus} -> ${task.status}`);
            notifyTaskTerminalStatus(task, prevStatus);
        }
        if (prevAssignee !== task.assignee) addHistoryEntry(task, `Исполнитель: ${prevAssignee || 'Не назначен'} -> ${task.assignee || 'Не назначен'}`);
        refreshTaskRelatedUi();
        try {
            const rowId = task.row_id || taskRowMap.get(task.id);
            await apiRequest(`${API_BASE}/${task.id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...task, row_id: rowId, id: task.id }),
                timeoutMs: 20000
            });
            showToast(`Задача #${task.id} обновлена`, 'success');
            setSyncBanner('Изменения сохранены в SeaTable.');
            return true;
        } catch (error) {
            Object.assign(task, snapshot);
            refreshTaskRelatedUi();
            setSyncBanner(`Не удалось обновить задачу: ${error.message}`, true);
            showToast(`Ошибка обновления: ${error.message}`, 'error');
            return false;
        }
    }

    async function createTask(formData) {
        if (quickTaskForm.dataset.submitting === 'true') return;
        quickTaskForm.dataset.submitting = 'true';

        const dbId = formData.get('database') || currentDatabaseId;
        const db = databases.find(d => d.id === dbId);
        if (!db) { quickTaskForm.dataset.submitting = 'false'; return false; }

        const dept = (formData.get('department') || '').trim();
        if (!dept) { showToast('Выберите направление техподдержки', 'warning'); quickTaskForm.dataset.submitting = 'false'; return false; }

        const description = (formData.get('description') || '').trim();
        if (!description) {
            showToast('Введите описание заявки', 'warning');
            quickTaskForm.dataset.submitting = 'false';
            return false;
        }

        const userProfile = findUserByUsername(currentUser.username) || currentUser;
        const priority = formData.get('priority') || 'Низкий';
        const attachment = quickTaskAttachmentInput?.files?.[0] || null;
        let initialAttachments = [];
        if (attachment) {
            try {
                const dataUrl = await readFileAsDataUrl(attachment);
                initialAttachments = [{
                    name: attachment.name,
                    dataUrl,
                    size: Number(attachment.size || 0),
                    type: String(attachment.type || ''),
                    author: currentUser.fullName,
                    createdAt: new Date().toISOString()
                }];
            } catch (attachmentError) {
                showToast(attachmentError.message, 'error');
                quickTaskForm.dataset.submitting = 'false';
                return false;
            }
        }

        const isAdmin = currentUser?.role === 'admin';
        const selectedAuthor = isAdmin ? (formData.get('author') || '').trim() : currentUser.fullName;
        
        const newTask = {
            createdAt: new Date().toISOString().split('T')[0],
            updatedAt: new Date().toISOString().split('T')[0],
            databaseId: dbId,
            type: '',
            title: buildDefaultTaskTitle({ department: dept, description }),
            department: dept,
            description: description,
            author: selectedAuthor || currentUser.fullName,
            assignee: '',
            office: userProfile.office || '—',
            phone: userProfile.phone || '—',
            priority,
            status: 'Новая',
            deadline: formData.get('deadline') || '',
            slaDays: SLA_DAYS_BY_PRIORITY[priority] || 3,
            assignedAt: '',
            inProgressAt: '',
            reviewAt: '',
            closedAt: '',
            rejectedAt: '',
            rejectedReason: '',
            report: '',
            comments: [],
            history: [],
            attachments: initialAttachments
        };
        if (!newTask.deadline) newTask.deadline = getDateWithOffset(3);
        const validationError = validateTaskShape(newTask);
        if (validationError) {
            showToast(validationError, 'error');
            quickTaskForm.dataset.submitting = 'false';
            return false;
        }
        addHistoryEntry(newTask, 'Заявка создана');

        try {
            db.tasks.push(newTask);
            refreshTaskRelatedUi();
            const payload = await apiRequest(API_BASE, { method: 'POST', body: JSON.stringify(newTask) });
            const createdTask = payload?.task || null;
            if (!createdTask || !createdTask.row_id || !Number.isFinite(Number(createdTask.id))) {
                throw new Error('SeaTable не подтвердил создание задачи');
            }
            Object.assign(newTask, createdTask);
            taskRowMap.set(newTask.id, createdTask.row_id);
            nextTaskId = Math.max(nextTaskId, Number(newTask.id) + 1);
            notifyTaskCreated(newTask);
            refreshTaskRelatedUi();
            quickTaskForm.reset();
            quickTaskForm.querySelector('input[name="database"]').value = currentDatabaseId;
            quickTaskForm.querySelector('input[name="department"]').value = '';
            quickTaskDeadline.value = getDateWithOffset(3);
            quickTaskForm.querySelector('select[name="priority"]').value = 'Низкий';
            quickTaskForm.querySelector('input[name="office"]').value = userProfile.office || '';
            quickTaskForm.querySelector('input[name="phone"]').value = userProfile.phone || '';
            showToast(`Задача #${newTask.id} успешно создана`, 'success');
            setSyncBanner('Изменения сохранены в SeaTable.');
            return true;
        } catch (error) {
            db.tasks = db.tasks.filter(t => t.id !== newTask.id);
            refreshTaskRelatedUi();
            setSyncBanner(`Не удалось сохранить задачу: ${error.message}`, true);
            showToast(`Ошибка сохранения: ${error.message}`, 'error');
            return false;
        } finally {
            quickTaskForm.dataset.submitting = 'false';
        }
    }

    async function deleteSelectedTasks() {
        const checkboxes = document.querySelectorAll('.task-checkbox:checked');
        if (checkboxes.length === 0) { showToast('Выберите задачи', 'warning'); return; }
        const ids = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id));
        const removableIds = ids.filter(id => {
            const context = findTaskContext(id);
            return context && canDeleteTask(context.task);
        });
        if (!removableIds.length) { showToast('Нет задач для удаления по вашим правам', 'warning'); return; }
        
        showConfirmModal('Удаление задач', `Удалить ${removableIds.length} задач(у)?`, async () => {
            const rowsToDelete = removableIds.map(id => {
                const context = findTaskContext(id);
                return { id, rowId: context?.task?.row_id || taskRowMap.get(id) || null };
            });
            const snapshots = databases.map(db => ({ id: db.id, tasks: [...db.tasks] }));
            databases.forEach(db => { db.tasks = db.tasks.filter(t => !removableIds.includes(t.id)); });
            refreshTaskRelatedUi();
            try {
                for (const item of rowsToDelete) {
                    await apiRequest(API_BASE, { method: 'DELETE', body: JSON.stringify({ row_id: item.rowId }) });
                    taskRowMap.delete(item.id);
                }
                setSyncBanner('Изменения сохранены в SeaTable.');
                showToast(`Удалено ${removableIds.length} задач(и)`, 'success');
            } catch (error) {
                snapshots.forEach(snapshot => { const db = databases.find(item => item.id === snapshot.id); if (db) db.tasks = snapshot.tasks; });
                refreshTaskRelatedUi();
                setSyncBanner(`Ошибка удаления: ${error.message}`, true);
            }
        });
    }

// ==================== ФИЛЬТРЫ И ЭКСПОРТ ====================
    [filterDepartment, filterPriority, filterStatus, filterDate, searchTask, sortTasks].forEach(el => {
        el?.addEventListener('input', () => { currentPage = 1; renderTasks(); });
        el?.addEventListener('change', () => { currentPage = 1; renderTasks(); });
    });
    const filterDbEmployee = document.getElementById('filterDatabaseEmployee');
    filterDatabase?.addEventListener('change', e => {
        currentDatabaseId = e.target.value;
        filterDbEmployee.value = currentDatabaseId;
        currentPage = 1;
        if (reportDatabase) reportDatabase.value = currentDatabaseId;
        renderTasks();
        populateDepartmentSelects();
        savePersistedData();
    });
    filterDbEmployee?.addEventListener('change', e => {
        currentDatabaseId = e.target.value || databases[0]?.id || '';
        filterDatabase.value = currentDatabaseId;
        currentPage = 1;
        if (reportDatabase) reportDatabase.value = currentDatabaseId;
        renderTasks();
        populateDepartmentSelects();
        savePersistedData();
    });
    resetFiltersBtn.addEventListener('click', () => {
        filterDepartment.value = filterPriority.value = filterStatus.value = filterDate.value = searchTask.value = '';
        if (sortTasks) sortTasks.value = 'createdAt_desc';
        currentPage = 1;
        activeQuickFilter = '';
        quickFilterButtons.forEach(b => b.classList.remove('active'));
        renderTasks();
    });
setTodayFilterBtn.addEventListener('click', () => {
        filterDate.value = getTodayYmd(); currentPage = 1; renderTasks();
    });
    setTodayDeadlineBtn?.addEventListener('click', () => {
        quickTaskDeadline.value = getTodayYmd();
    });
    exportTasksBtn.addEventListener('click', () => {
        const filtered = filterTasks();
        if (!filtered.length) { showToast('Нет данных для экспорта', 'warning'); return; }
        const headers = ['ID','Дата создания','База','Тип','Тема','Направление','Описание','Автор','Исполнитель','Кабинет','Телефон','Приоритет','Статус','Срок','SLA(дней)','Отчёт','Причина отклонения'];
        const rows = filtered.map(t => [t.id, t.createdAt, databases.find(d=>d.id===t.databaseId)?.name||'', t.type || '', t.title || '', t.department, t.description, t.author, t.assignee || '', t.office, t.phone, t.priority, t.status, t.deadline, t.slaDays || '', t.report, t.rejectedReason || '']);
        const csv = headers.join(',') + '\n' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8;'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tasks_${new Date().toISOString().slice(0,10)}.csv`; a.click();
        showToast('Экспорт выполнен', 'success');
    });

    // ==================== DRAG & DROP ====================
    let dragSrcId = null;
    function setupDragAndDrop() {
        document.querySelectorAll('.task-row').forEach(row => {
            if (!(currentUser && (currentUser.role === 'admin' || currentUser.role === 'admin'))) return;
            row.addEventListener('dragstart', e => { dragSrcId = parseInt(row.dataset.index); });
            row.addEventListener('dragover', e => e.preventDefault());
            row.addEventListener('drop', e => {
                e.preventDefault();
                const targetId = parseInt(e.target.closest('tr')?.dataset.index);
                if (!targetId || dragSrcId === targetId) return;
                const db = getCurrentDatabase();
                if (!db) return;
                const src = db.tasks.findIndex(t => t.id === dragSrcId);
                const tgt = db.tasks.findIndex(t => t.id === targetId);
                if (src < 0 || tgt < 0) return;
                [db.tasks[src], db.tasks[tgt]] = [db.tasks[tgt], db.tasks[src]];
                renderTasks();
            });
        });
    }

    // ==================== УВЕДОМЛЕНИЯ (UI) ====================
    function updateNotificationBadge() {
        if (!notificationCount) return;
        notificationCount.textContent = notifications.filter(n => !n.read).length;
    }
    notificationBadge.addEventListener('click', () => {
        notificationsList.innerHTML =
            notifications
                .map(n => `<div class="notification-item ${n.read ? '' : 'unread'}"><div>${escapeHtml(n.message)}</div></div>`)
                .join('') || '<p>Нет уведомлений</p>';
        notifications.forEach(n => { n.read = true; });
        persistCurrentUserNotifications();
        updateNotificationBadge();
        notificationsModal.classList.add('show');
    });

    // ==================== ПРОФИЛЬ ====================
    profileBtn.addEventListener('click', () => {
        if (!currentUser) return;
        document.getElementById('profileFullName').value = currentUser.fullName || '';
        document.getElementById('profilePosition').value = currentUser.position || '';
        document.getElementById('profileEmail').value = currentUser.email || '';
        document.getElementById('profilePhone').value = currentUser.phone || '';
        const av = localStorage.getItem(`avatar_${currentUser.username}`);
        if (av) {
            document.getElementById('profileAvatarImg').src = av;
            document.getElementById('profileAvatarImg').style.display = 'block';
            document.getElementById('profileAvatarIcon').style.display = 'none';
        } else {
            document.getElementById('profileAvatarImg').style.display = 'none';
            document.getElementById('profileAvatarIcon').style.display = 'block';
        }
        profileModal.classList.add('show');
    });

    const profileFormEl = document.getElementById('profileForm');
    profileFormEl?.addEventListener('submit', async e => {
        e.preventDefault();
        if (!currentUser) return;
        const savedAvatar = localStorage.getItem(`avatar_${currentUser.username}`) || '';
        const result = await editUser(currentUser.username, {
            username: currentUser.username,
            originalFullName: currentUser.fullName,
            password: '',
            fullName: document.getElementById('profileFullName').value.trim(),
            position: document.getElementById('profilePosition').value.trim(),
            email: document.getElementById('profileEmail').value.trim(),
            phone: document.getElementById('profilePhone').value.trim(),
            department: currentUser.department || '',
            office: currentUser.office || '',
            avatar: savedAvatar
        });

        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }

        renderUsers();
        showToast('Профиль сохранён', 'success');
        profileModal.classList.remove('show');
    });

    document.getElementById('changeAvatarBtn')?.addEventListener('click', () => document.getElementById('avatarUpload')?.click());
    document.getElementById('avatarUpload')?.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (file) saveAvatar(file, currentUser.username);
    });

    function saveAvatar(file, username) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const maxSize = 150;
                let width = img.width, height = img.height;
                if (width > height) {
                    if (width > maxSize) { height *= maxSize / width; width = maxSize; }
                } else {
                    if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const compressedData = canvas.toDataURL('image/jpeg', 0.5);
                localStorage.setItem(`avatar_${username}`, compressedData);
                const user = findUserByUsername(username);
                if (user) {
                    user.avatar = compressedData;
                    console.log('[saveAvatar] synced to SeaTable for:', username);
                    syncUserToSeaTable(user, 'update', username).then(() => {
                        console.log('[saveAvatar] SUCCESS:', username);
                    }).catch(err => {
                        console.error('[saveAvatar] FAILED:', err);
                    });
                }
                updateHeaderAvatar();
                if (profileModal.classList.contains('show')) {
                    document.getElementById('profileAvatarImg').src = compressedData;
                    document.getElementById('profileAvatarImg').style.display = 'block';
                    document.getElementById('profileAvatarIcon').style.display = 'none';
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ==================== НАСТРОЙКИ ====================
    function loadSettings() {
        const settings = getAppSettings();
        if (themeSelect) themeSelect.value = settings.theme;
        if (compactModeInput) compactModeInput.checked = Boolean(settings.compactMode);
        if (desktopNotificationsInput) desktopNotificationsInput.checked = Boolean(settings.desktopNotifications);
        if (defaultViewSelect) defaultViewSelect.value = resolveStartView(settings.defaultView);
        updateDefaultViewOptions();
        applyUiSettings(settings);
        return settings;
    }
    settingsForm.addEventListener('submit', e => {
        e.preventDefault();
        const currentSettings = getAppSettings();
        const nextSettings = {
            ...currentSettings,
            theme: themeSelect?.value === 'dark' ? 'dark' : 'light',
            compactMode: Boolean(compactModeInput?.checked),
            desktopNotifications: Boolean(desktopNotificationsInput?.checked),
            defaultView: resolveStartView(defaultViewSelect?.value || 'tasks')
        };
        saveAppSettings(nextSettings);
        applyUiSettings(nextSettings);
        showToast('Настройки сохранены', 'success');
    });

    // ==================== РАЗДЕЛЫ ====================
    function renderDepartments() {
        document.getElementById('departmentsTableBody').innerHTML = departmentsData.map((d, index) => 
            `<tr>
                <td>${sanitizeHTML(d.name || '')}</td>
                <td>
                    <button class="icon-btn edit-department" data-index="${index}" title="Редактировать"><i class="fas fa-pen"></i></button>
                    <button class="icon-btn delete-department" data-index="${index}" title="Удалить" style="margin-left:4px;"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`
        ).join('');
        document.querySelectorAll('.edit-department').forEach(btn => btn.addEventListener('click', function() {
            const idx = parseInt(this.dataset.index);
            openEditDepartmentModal(idx);
        }));
        document.querySelectorAll('.delete-department').forEach(btn => btn.addEventListener('click', function() {
            const idx = parseInt(this.dataset.index);
            const dept = departmentsData[idx];
            showConfirmModal('Удалить направление?', `Удалить "${dept.name}"?`, async () => {
                const deletedName = dept.name;
                const fallback =
                    deletedName === FALLBACK_DIRECTION_ON_DELETE
                        ? (departmentsData.find(d => d.name !== deletedName)?.name || FALLBACK_DIRECTION_ON_DELETE)
                        : FALLBACK_DIRECTION_ON_DELETE;

                try {
                    // Сначала переназначаем все задачи, где было удаляемое направление.
                    await syncTasksForDirectionRename(deletedName, fallback);
                    // Затем удаляем направление из SeaTable.
                    await apiRequest(API_DIRECTIONS, {
                        method: 'DELETE',
                        body: JSON.stringify({ name: deletedName }),
                        timeoutMs: 12000,
                    });
                } catch (error) {
                    setSyncBanner(`Не удалось удалить направление: ${error.message}`, true);
                    showToast('Ошибка удаления направления', 'error');
                    return;
                }

                await initDirections();
                populateDepartmentSelects();
                renderDepartments();
                showToast(`Направление удалено (задачи перенесены в "${fallback}")`, 'success');
            });
        }));
    }

    function openEditDepartmentModal(index) {
        const dept = departmentsData[index];
        if (!dept) return;
        const modal = document.getElementById('editDepartmentModal');
        const form = document.getElementById('editDepartmentForm');
        if (!modal || !form) return;
        form.dataset.index = String(index);
        document.getElementById('editDeptName').value = dept.name || '';
        modal.classList.add('show');
    }

    // ==================== НАПРАВЛЕНИЯ ДЕЯТЕЛЬНОСТИ ====================
    const addActivityModal = document.getElementById('addActivityModal');
    const addActivityForm = document.getElementById('addActivityForm');
    
    document.getElementById('addActivityBtn')?.addEventListener('click', () => {
        if (!currentUser || currentUser.role !== 'admin') return;
        addActivityForm?.reset();
        addActivityModal?.classList.add('show');
    });
    
    addActivityForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser || currentUser.role !== 'admin') return;
        
        const formData = new FormData(addActivityForm);
        const name = (formData.get('name') || '').trim();
        
        if (!name) { showToast('Введите название', 'error'); return; }
        if (activityData.some(d => d.name.toLowerCase() === name.toLowerCase())) {
            showToast('Такое направление уже существует', 'error'); return;
        }
        
        try {
            await apiRequest(API_ACTIVITY, { method: 'POST', body: JSON.stringify({ name }), timeoutMs: 12000 });
            await initActivity();
            renderActivity();
            addActivityModal.classList.remove('show');
            showToast(`Направление "${name}" добавлено`, 'success');
        } catch (error) {
            showToast('Ошибка добавления', 'error');
        }
    });
    
    document.getElementById('editActivityForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser || currentUser.role !== 'admin') return;
        
        const formData = new FormData(e.target);
        const name = (formData.get('name') || '').trim();
        const rowId = e.target.dataset.rowId;
        if (!name || !rowId) return;
        
        const current = activityData.find(d => d.row_id === rowId);
        const oldName = current?.name;
        
        if (!oldName || oldName === name) {
            document.getElementById('editActivityModal')?.classList.remove('show');
            return;
        }
        
        try {
            await apiRequest(API_ACTIVITY, { method: 'PUT', body: JSON.stringify({ row_id: rowId, name }), timeoutMs: 12000 });
            await initActivity();
            renderActivity();
            document.getElementById('editActivityModal')?.classList.remove('show');
            showToast('Направление обновлено', 'success');
        } catch (error) {
            showToast('Ошибка обновления', 'error');
        }
    });
    
    function openEditActivityModal(rowId) {
        const activity = activityData.find(d => d.row_id === rowId);
        if (!activity) return;
        const form = document.getElementById('editActivityForm');
        if (!form) return;
        form.dataset.rowId = String(rowId);
        document.getElementById('editActivityName').value = activity.name || '';
        document.getElementById('editActivityModal')?.classList.add('show');
    }

    // ==================== ПОЛЬЗОВАТЕЛИ ====================
    const ROLE_LABELS = { admin: 'Администратор', employee: 'Сотрудник СП' };
    
    function renderUsers() {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody || !currentUser || currentUser.role !== 'admin') return;
        
        tbody.innerHTML = users.map(u => 
            `<tr>
                <td>${sanitizeHTML(u.username)}</td>
                <td>${sanitizeHTML(u.fullName)}</td>
                <td>${ROLE_LABELS[u.role] || u.role}</td>
                <td>${sanitizeHTML(u.department || '—')}</td>
                <td>${sanitizeHTML(u.email || '—')}</td>
                <td>${sanitizeHTML(u.phone || '—')}</td>
                <td>${sanitizeHTML(u.office || '—')}</td>
                <td>
                    ${u.username !== 'admin'
                        ? `<button class="icon-btn edit-user-btn" data-username="${sanitizeHTML(u.username)}" title="Редактировать"><i class="fas fa-pen"></i></button>
                           <button class="icon-btn delete-user-btn" data-username="${sanitizeHTML(u.username)}" title="Удалить" style="margin-left:4px;"><i class="fas fa-trash"></i></button>`
                        : `<button class="icon-btn edit-user-btn" data-username="admin" title="Редактировать (логин/пароль нельзя менять)"><i class="fas fa-pen"></i></button>
                           <span style="color:var(--primary); font-size:12px; margin-left:8px;">Основной</span>`}
                </td>
            </tr>`
        ).join('');
        
        // Редактирование
        document.querySelectorAll('.edit-user-btn').forEach(btn => btn.addEventListener('click', function() {
            const username = this.dataset.username;
            openEditUserModal(username);
        }));
        
        // Удаление
        document.querySelectorAll('.delete-user-btn').forEach(btn => btn.addEventListener('click', function() {
            const username = this.dataset.username;
            showConfirmModal('Удалить пользователя?', `Пользователь "${username}" будет удалён. Это действие нельзя отменить.`, () => {
                const result = deleteUser(username);
                if (result.success) {
                    renderUsers();
                    showToast('Пользователь удалён', 'success');
                } else {
                    showToast(result.error, 'error');
                }
            });
        }));
    }

    // Открытие модального окна редактирования
    async function openEditUserModal(username) {
        const user = findUserByUsername(username);
        if (!user) return;
        
        const editModal = document.getElementById('editUserModal');
        const editForm = document.getElementById('editUserForm');
        
        // Заполняем форму
        const isMainAdmin = user.username === 'admin';
        const editUsernameInput = document.getElementById('editUsername');
        editUsernameInput.value = user.username;
        document.getElementById('editFullName').value = user.fullName;
        editForm.dataset.originalFullname = user.fullName;
        document.getElementById('editPosition').value = user.position || '';
        const deptSelect = document.getElementById('editDepartment');
        const activityNames = activityData.map(a => a.name);
        deptSelect.innerHTML = '<option value="">Выберите направление</option>' + 
            activityNames
                .map(name => `<option value="${escapeAttr(name)}" ${name === user.department ? 'selected' : ''}>${escapeHtml(name)}</option>`)
                .join('');
        document.getElementById('editRole').value = user.role || 'employee';
        document.getElementById('editEmail').value = user.email || '';
        document.getElementById('editPhone').value = user.phone || '';
        document.getElementById('editOffice').value = user.office || '';
        const editPasswordInput = document.getElementById('editPassword');
        editPasswordInput.value = '';

        // Для главного админа запрещаем менять логин и пароль
        editUsernameInput.disabled = isMainAdmin;
        editPasswordInput.disabled = isMainAdmin;
        editPasswordInput.placeholder = isMainAdmin ? 'Недоступно для основного администратора' : 'Оставьте пустым, чтобы не менять';
        
        // Сохраняем оригинальный логин для поиска
        editForm.dataset.originalUsername = username;
        
        const currentDept = user.department || '';
        const actOpts = activityNames
            .map(n => `<option value="${escapeAttr(n)}" ${n === currentDept ? 'selected' : ''}>${escapeHtml(n)}</option>`)
            .join('');
        deptSelect.innerHTML = '<option value="">Выберите направление</option>' + actOpts;
        
        editModal.classList.add('show');
    }

    // <-- ВАЖНО: функция renderBasesList объявлена ДО вызовов
    function renderBasesList() {
        if (!basesListContainer) return;
        basesListContainer.innerHTML = databases.map(db => {
            const taskCount = db.tasks.length;
            return `<div style="padding:10px;border:1px solid var(--border);margin-bottom:10px;border-radius:6px;">
                <strong>${db.name}</strong> (${taskCount})
                <button class="btn btn-outline btn-small set-active-base" data-id="${db.id}">Активная</button>
            </div>`;
        }).join('');
        document.querySelectorAll('.set-active-base').forEach(b => b.addEventListener('click', e => {
            currentDatabaseId = e.target.dataset.id;
            if (filterDatabase) filterDatabase.value = currentDatabaseId;
            if (reportDatabase) reportDatabase.value = currentDatabaseId;
            renderTasks();
            populateDepartmentSelects();
            switchView('tasks');
            savePersistedData();
        }));
    }

    function updateStats() {
        let tasks = getCurrentDatabaseTasks();
        const isAdmin = currentUser?.role === 'admin';
        const executorFilter = document.getElementById('reportExecutor');
        const execValue = executorFilter?.value;
        const dateFrom = document.getElementById('reportDateFrom')?.value;
        const dateTo = document.getElementById('reportDateTo')?.value;
        
        if (!isAdmin) {
            tasks = tasks.filter(t => t.author === currentUser?.fullName);
        }
        
        if (isAdmin && execValue) {
            tasks = tasks.filter(t => t.assignee === execValue);
        }
        
        if (dateFrom || dateTo) {
            tasks = tasks.filter(t => {
                const created = (t.createdAt || '').slice(0, 10);
                if (dateFrom && created < dateFrom) return false;
                if (dateTo && created > dateTo) return false;
                return true;
            });
        }
        
        document.getElementById('statTotalTasks').textContent = tasks.length;
        document.getElementById('statInProgress').textContent = tasks.filter(t => t.status === 'В работе').length;
        document.getElementById('statCompleted').textContent = tasks.filter(t => t.status === 'Завершена').length;
        if (statNewTasks) statNewTasks.textContent = tasks.filter(t => t.status === 'Новая').length;
        const today = getTodayYmd();
        const overdueEl = document.getElementById('statOverdue');
        if (overdueEl) overdueEl.textContent = tasks.filter(t => {
            const deadline = toLocalDateYmd(t.deadline);
            return deadline && deadline < today && t.status !== 'Завершена';
        }).length;
        const inSlaEl = document.getElementById('statInSla');
        const outSlaEl = document.getElementById('statOutSla');
        let inSla = 0;
        let outSla = 0;
        tasks.forEach(t => {
            if (!t.deadline) return;
            if (t.status === 'Завершена') {
                const closeDate = (t.closedAt || t.updatedAt || t.createdAt || '').slice(0, 10);
                if (closeDate && closeDate <= t.deadline) inSla++;
                else outSla++;
            } else if (today <= t.deadline) {
                inSla++;
            } else {
                outSla++;
            }
        });
        if (inSlaEl) inSlaEl.textContent = inSla;
        if (outSlaEl) outSlaEl.textContent = outSla;
    }
        
function renderDetailedStats() {
        let tasks = getCurrentDatabaseTasks();
        const isAdmin = currentUser?.role === 'admin';
        if (!isAdmin) {
            tasks = tasks.filter(t => t.author === currentUser?.fullName);
        }
        const deptCounts = {};
        tasks.forEach(t => { deptCounts[t.department] = (deptCounts[t.department]||0)+1; });
        renderBarList('statsDepartments', deptCounts);
        const authorCounts = {};
        tasks.forEach(t => { authorCounts[t.author] = (authorCounts[t.author]||0)+1; });
        const sorted = Object.entries(authorCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
        renderBarList('statsAssignees', Object.fromEntries(sorted));
        const statusCounts = {};
        tasks.forEach(t => { statusCounts[t.status] = (statusCounts[t.status]||0)+1; });
        renderBarList('statsStatuses', statusCounts, { 'Новая':'var(--primary-light)', 'В работе':'var(--warning)', 'Завершена':'var(--success)', 'Отклонена':'var(--danger)' });
        const dailyContainer = document.getElementById('statsDaily');
        if (!dailyContainer) return;
        const dates = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            dates.push(toLocalDateYmd(d));
        }
        const dailyCounts = {};
        dates.forEach(d => dailyCounts[d] = 0);
        tasks.forEach(t => {
            const createdAt = toLocalDateYmd(t.createdAt);
            if (createdAt && dailyCounts.hasOwnProperty(createdAt)) dailyCounts[createdAt]++;
        });
        const maxCount = Math.max(...Object.values(dailyCounts), 1);
        let html = '<div class="daily-chart-vertical">';
        dates.forEach(date => {
            const count = dailyCounts[date];
            const heightPercent = (count / maxCount) * 100;
            const day = date.slice(8); const month = date.slice(5, 7);
            html += `<div class="daily-bar-col"><div class="daily-col-value">${count}</div><div class="daily-col-bar" style="height:${heightPercent}%"></div><div class="daily-col-label">${day}.${month}</div></div>`;
        });
        html += '</div>';
        dailyContainer.innerHTML = html;
    }

    function renderBarList(id, data, colors={}) {
        const container = document.getElementById(id);
        if (!container) return;
        const entries = Object.entries(data).sort((a,b)=>b[1]-a[1]);
        const max = Math.max(...entries.map(e=>e[1]),1);
        let html = '';
        entries.forEach(([key,val]) => {
            const pct = (val/max)*100;
            const color = colors[key] || 'var(--primary)';
            html += `<div class="stats-bar-item"><div class="stats-bar-label">${key}</div><div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%; background:${color};"></div></div><div class="stats-bar-value">${val}</div></div>`;
        });
        container.innerHTML = html || '<p>Нет данных</p>';
    }

    function toggleDetailedStats() {
        const simple = document.getElementById('simpleStats');
        const detailed = document.getElementById('detailedStats');
        const btn = toggleDetailedStatsBtn;
        
        if (detailed.style.display === 'none') {
            simple.style.display = 'none';
            detailed.style.display = 'block';
            btn.innerHTML = 'Простая статистика';
            renderDetailedStats();
        } else {
            simple.style.display = 'grid';
            detailed.style.display = 'none';
            btn.innerHTML = 'Детальная статистика';
        }
    }

    // ==================== НАВИГАЦИЯ ====================
    function switchView(viewId) {
        const activeMenuItem = document.querySelector(`.menu-item[data-view="${viewId}"]`);
        if (activeMenuItem && activeMenuItem.dataset.role && currentUser) {
            const allowedRoles = activeMenuItem.dataset.role.split(',');
            if (!allowedRoles.includes(currentUser.role)) {
                viewId = 'tasks';
            }
        }

        views.forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(`view-${viewId}`);
        if (!targetView) {
            console.error('Не найден view:', viewId);
            return;
        }
        targetView.classList.add('active');

        menuItems.forEach(m => m.classList.remove('active'));
        const nextActiveMenuItem = document.querySelector(`.menu-item[data-view="${viewId}"]`);
        if (nextActiveMenuItem) nextActiveMenuItem.classList.add('active');

        if (viewId === 'reports') {
            updateStats();
            if (reportDatabase) reportDatabase.value = currentDatabaseId;
            const execSelect = document.getElementById('reportExecutor');
            const toggleBtn = document.getElementById('toggleDetailedStatsBtn');
            const isAdmin = currentUser?.role === 'admin';
            if (execSelect) {
                const admins = getAssignableEmployees();
                execSelect.innerHTML = '<option value="">Все исполнители</option>' + 
                    admins.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
                execSelect.style.display = isAdmin ? 'block' : 'none';
            }
            if (toggleBtn) {
                toggleBtn.style.display = 'inline-flex';
            }
        } else if (viewId === 'activity') {
            renderActivity();
        } else if (viewId === 'bases') {
            renderBasesList();
        } else if (viewId === 'settings') {
            loadSettings();
        }
    }

    // ==================== НАВИГАЦИЯ ====================
    // Добавление направления (модальное окно)
    const addDepartmentForm = document.getElementById('addDepartmentForm');
    const addDepartmentModal = document.getElementById('addDepartmentModal');
    const addDeptHeadSelect = document.getElementById('addDeptHead');
    
    document.getElementById('addDepartmentBtn')?.addEventListener('click', () => {
        if (!currentUser || currentUser.role !== 'admin') return;
        addDepartmentForm.reset();

        addDepartmentModal.classList.add('show');
    });
    
    addDepartmentForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentUser || currentUser.role !== 'admin') return;
        
        const formData = new FormData(addDepartmentForm);
        const name = (formData.get('name') || '').trim();
        
        if (!name) {
            showToast('Введите название направления', 'error');
            return;
        }
        
        // Проверка на дубликат
        if (departmentsData.some(d => d.name.toLowerCase() === name.toLowerCase())) {
            showToast('Такое направление уже существует', 'error');
            return;
        }

        void (async () => {
            try {
                await apiRequest(API_DIRECTIONS, {
                    method: 'POST',
                    body: JSON.stringify({ name }),
                    timeoutMs: 12000,
                });
                await initDirections();
                populateDepartmentSelects();
                renderDepartments();
                addDepartmentModal.classList.remove('show');
                showToast(`Направление "${name}" добавлено`, 'success');
            } catch (error) {
                showToast(error?.message || 'Ошибка при добавлении направления', 'error');
            }
        })();
    });

    const editDepartmentForm = document.getElementById('editDepartmentForm');
    const editDepartmentModal = document.getElementById('editDepartmentModal');
    editDepartmentForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser || currentUser.role !== 'admin') return;
        const formData = new FormData(editDepartmentForm);
        const name = (formData.get('name') || '').trim();
        if (!name) { showToast('Введите название направления', 'error'); return; }

        const idx = Number(editDepartmentForm.dataset.index || -1);
        const prev = departmentsData[idx];
        if (!prev) return;

        const snapshot = JSON.parse(JSON.stringify(prev));
        const oldName = prev.name;

        // Запрещаем дубликаты (кроме текущего направления)
        if (departmentsData.some((d, i) => i !== idx && String(d?.name || '').toLowerCase() === name.toLowerCase())) {
            showToast('Такое направление уже существует', 'error');
            return;
        }

        prev.name = name;
        FULL_DEPARTMENTS = Array.from(new Set(departmentsData.map(d => d.name))).filter(Boolean);
        populateDepartmentSelects();
        renderDepartments();
        editDepartmentModal?.classList.remove('show');

        try {
            await syncTasksForDirectionRename(oldName, name);
            await apiRequest(API_DIRECTIONS, {
                method: 'PUT',
                body: JSON.stringify({ oldName, name }),
                timeoutMs: 12000,
            });

            await initDirections();
            populateDepartmentSelects();
            renderDepartments();
            showToast('Направление обновлено', 'success');
        } catch (error) {
            Object.assign(prev, snapshot);
            // Пробуем откатить задачи на старое значение направления.
            await syncTasksForDirectionRename(name, oldName);

            await initDirections();
            populateDepartmentSelects();
            renderDepartments();
            setSyncBanner(`Не удалось обновить направление в SeaTable: ${error.message}`, true);
            showToast('Ошибка обновления направления', 'error');
        }
    });

    // Добавление пользователя (admin)
    const addUserForm = document.getElementById('addUserForm');
    const addUserModal = document.getElementById('addUserModal');
    const addUserDepartment = document.getElementById('addUserDepartment');
    
document.getElementById('addUserBtn')?.addEventListener('click', () => {
        if (!currentUser || currentUser.role !== 'admin') return;
        addUserForm.reset();
        // Заполняем направления деятельности
        if (addUserDepartment) {
            const activityNames = activityData.map(a => a.name);
            addUserDepartment.innerHTML = '<option value="">Выберите направление</option>' + 
                activityNames.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
        }
        addUserModal.classList.add('show');
    });
        
    addUserForm?.addEventListener('submit', async e => {
        e.preventDefault();
        if (!currentUser || currentUser.role !== 'admin') return;
        
        const formData = new FormData(addUserForm);
        const username = (formData.get('username') || '').trim();
        const password = formData.get('password') || '';
        const fullName = (formData.get('fullName') || '').trim();
        const department = (formData.get('department') || '').trim();
        const position = (formData.get('position') || '').trim();
        const email = (formData.get('email') || '').trim();
        const phone = (formData.get('phone') || '').trim();
        const office = (formData.get('office') || '').trim();
        const role = (formData.get('role') || 'employee').trim();
        
        if (!username || !password || !fullName) {
            showToast('Заполните обязательные поля (логин, пароль, ФИО)', 'error');
            return;
        }
        if (password.length < 6) {
            showToast('Пароль должен быть не менее 6 символов', 'error');
            return;
        }
        
        const result = await addUser({ username, password, fullName, department, position, email, phone, office, role });
        if (result.success) {
            addUserModal.classList.remove('show');
            renderUsers();
            populateDepartmentSelects();
            showToast(`Пользователь "${username}" успешно создан`, 'success');
        } else {
            showToast(result.error, 'error');
        }
    });

    // Редактирование пользователя
    const editUserForm = document.getElementById('editUserForm');
    const editUserModal = document.getElementById('editUserModal');
    
    // Закрытие модальных окон при клике на крестик
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) modal.classList.remove('show');
        });
    });
    
    editUserForm?.addEventListener('submit', async e => {
        e.preventDefault();
        if (!currentUser || currentUser.role !== 'admin') return;
        
        const originalUsername = editUserForm.dataset.originalUsername;
        const originalFullName = editUserForm.dataset.originalFullname;
        const formData = new FormData(editUserForm);
        const isMainAdmin = originalUsername === 'admin';
        const username = isMainAdmin ? 'admin' : (formData.get('username') || '').trim();
        const password = isMainAdmin ? '' : (formData.get('password') || '');
        const fullName = (formData.get('fullName') || '').trim();
        const department = (formData.get('department') || '').trim();
        const position = (formData.get('position') || '').trim();
        const email = (formData.get('email') || '').trim();
        const phone = (formData.get('phone') || '').trim();
        const office = (formData.get('office') || '').trim();
        
        const role = (formData.get('role') || 'employee').trim();
        
        if (!username || !fullName) {
            showToast('Заполните обязательные поля (логин, ФИО)', 'error');
            return;
        }
        
        const result = await editUser(originalUsername, { username, password, fullName, department, position, email, phone, office, role, originalFullName });
        if (result.success) {
            editUserModal.classList.remove('show');
            renderUsers();
            populateDepartmentSelects();
            showToast('Данные пользователя обновлены', 'success');
        } else {
            showToast(result.error, 'error');
        }
    });

    // ==================== ГЛАВНЫЕ ОБРАБОТЧИКИ ====================
    function setupEventListeners() {
        burgerBtn.addEventListener('click', () => sidebar.classList.add('open'));
        closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));
        menuItems.forEach(item => item.addEventListener('click', () => {
            if (!item.dataset.view) return;
            switchView(item.dataset.view);
            sidebar.classList.remove('open');
        }));
        openQuickTaskBtn.addEventListener('click', () => {
            const userProfile = findUserByUsername(currentUser.username) || currentUser;
            const isAdmin = currentUser?.role === 'admin';
            const authorGroup = document.getElementById('authorSelectGroup');
            const authorSelect = document.getElementById('quickTaskAuthor');
            
            if (isAdmin) {
                const adminUsers = users.filter(u => u.role === 'admin').map(u => u.fullName).filter(Boolean).sort();
                authorSelect.innerHTML = '<option value="">Выберите автора</option>' + 
                    adminUsers.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
                authorGroup.style.display = 'block';
            } else {
                authorGroup.style.display = 'none';
            }
            
            quickTaskForm.querySelector('input[name="database"]').value = currentDatabaseId;
            quickTaskForm.querySelector('input[name="department"]').value = '';
            quickTaskForm.querySelector('textarea[name="description"]').value = '';
            quickTaskForm.querySelector('select[name="priority"]').value = 'Низкий';
            quickTaskForm.querySelector('input[name="deadline"]').value = getDateWithOffset(SLA_DAYS_BY_PRIORITY['Низкий'] || 3);
            quickTaskForm.querySelector('input[name="office"]').value = userProfile.office || '';
            quickTaskForm.querySelector('input[name="phone"]').value = userProfile.phone || '';
            if (quickTaskAttachmentInput) quickTaskAttachmentInput.value = '';
            quickTaskForm.dataset.submitting = 'false';
            quickTaskModal.classList.add('show');
        });
        
        quickTaskForm.querySelector('select[name="priority"]')?.addEventListener('change', e => {
            const priority = e.target.value;
            const slaDays = SLA_DAYS_BY_PRIORITY[priority] || 3;
            quickTaskForm.querySelector('input[name="deadline"]').value = getDateWithOffset(slaDays);
        });
        document.querySelectorAll('.close-modal, .close-modal-btn').forEach(b =>
            b.addEventListener('click', e => e.target.closest('.modal').classList.remove('show'))
        );
        quickTaskForm.addEventListener('submit', async e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            const created = await createTask(new FormData(quickTaskForm));
            if (created) quickTaskModal.classList.remove('show');
        });
        taskDetailForm.addEventListener('submit', async e => {
            e.preventDefault();
            const updated = await updateTaskFromModal();
            if (updated) taskDetailModal.classList.remove('show');
        });
        taskDetailForm.report?.addEventListener('input', () => {
            if (!taskDetailForm.report.value.trim()) return;
            taskDetailForm.status.value = 'Завершена';
        });
        logoutBtn.addEventListener('click', () => {
            logoutUser();
        });
        roleDisplay.style.cursor = 'pointer';
        roleDisplay.addEventListener('click', () => {
            showConfirmModal('Выход из системы', 'Выйти из системы?', () => { logoutUser(); });
        });
        selectAllTasks.addEventListener('change', e => {
            document.querySelectorAll('.task-checkbox').forEach(cb => cb.checked = e.target.checked);
        });
        deleteSelectedBtn.addEventListener('click', () => { void deleteSelectedTasks(); });
        document.getElementById('deleteTaskBtn')?.addEventListener('click', () => {
            const taskId = parseInt(document.getElementById('detailTaskIndex').value);
            const context = findTaskContext(taskId);
            if (!context || !canDeleteTask(context.task)) return;
            showConfirmModal('Удалить задачу?', 'Вы уверены?', async () => {
                const rowId = context.task.row_id || taskRowMap.get(taskId);
                const snapshot = [...context.db.tasks];
                context.db.tasks = context.db.tasks.filter(t => t.id !== taskId);
                refreshTaskRelatedUi();
                taskDetailModal.classList.remove('show');
                try {
                    await apiRequest(`${API_BASE}/${taskId}`, { method: 'DELETE', body: JSON.stringify({ row_id: rowId }), timeoutMs: 20000 });
                    taskRowMap.delete(taskId);
                    setSyncBanner('Изменения сохранены в SeaTable.');
                    showToast('Задача удалена', 'success');
                } catch (error) {
                    context.db.tasks = snapshot;
                    refreshTaskRelatedUi();
                    setSyncBanner(`Не удалось удалить задачу: ${error.message}`, true);
                }
            });
        });
        quickFilterButtons.forEach(btn => btn.addEventListener('click', () => {
            currentPage = 1;
            activeQuickFilter = btn.dataset.quickFilter || '';
            quickFilterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTasks();
        }));
        toggleDetailedStatsBtn.addEventListener('click', toggleDetailedStats);
        document.getElementById('reportApplyBtn')?.addEventListener('click', () => {
            updateStats();
        });
        document.getElementById('reportResetBtn')?.addEventListener('click', () => {
            document.getElementById('reportExecutor').value = '';
            document.getElementById('reportDateFrom').value = '';
            document.getElementById('reportDateTo').value = '';
            if (reportDatabase) reportDatabase.value = currentDatabaseId;
            updateStats();
        });
        document.getElementById('reportExecutor')?.addEventListener('change', () => {
            updateStats();
        });
        reportDatabase.addEventListener('change', e => {
            currentDatabaseId = e.target.value;
            updateStats();
            if (document.getElementById('detailedStats').style.display === 'block') renderDetailedStats();
            savePersistedData();
        });
        themeSelect?.addEventListener('change', () => {
            const nextSettings = updateAppSettings({ theme: themeSelect.value === 'dark' ? 'dark' : 'light' });
            applyUiSettings(nextSettings);
        });
        compactModeInput?.addEventListener('change', () => {
            const nextSettings = updateAppSettings({ compactMode: Boolean(compactModeInput.checked) });
            applyUiSettings(nextSettings);
        });
        desktopNotificationsInput?.addEventListener('change', () => {
            updateAppSettings({ desktopNotifications: Boolean(desktopNotificationsInput.checked) });
        });
        addTaskCommentBtn?.addEventListener('click', () => {
            const taskId = parseInt(document.getElementById('detailTaskIndex').value);
            const context = findTaskContext(taskId);
            if (!context || !canViewTask(context.task)) return;
            const text = (taskCommentInput?.value || '').trim();
            if (!text) return;
            context.task.comments.push({
                author: currentUser.fullName,
                text,
                createdAt: new Date().toISOString()
            });
            addHistoryEntry(context.task, 'Комментарий добавлен');
            taskCommentInput.value = '';
            renderTaskComments(context.task);
            renderTaskHistory(context.task);
            refreshTaskRelatedUi();
        });
        taskHistoryFilter?.addEventListener('change', () => {
            const taskId = parseInt(document.getElementById('detailTaskIndex').value);
            const context = findTaskContext(taskId);
            if (!context) return;
            renderTaskHistory(context.task);
        });
        addTaskAttachmentBtn?.addEventListener('click', () => {
            const file = taskAttachmentInput?.files?.[0];
            if (!file) return;
            const taskId = parseInt(document.getElementById('detailTaskIndex').value);
            const context = findTaskContext(taskId);
            if (!context || !canEditTask(context.task)) return;
            const reader = new FileReader();
            reader.onload = async () => {
                const snapshot = JSON.parse(JSON.stringify(context.task));
                context.task.attachments.push({
                    name: file.name,
                    size: file.size,
                    type: String(file.type || ''),
                    dataUrl: String(reader.result || ''),
                    author: currentUser.fullName,
                    createdAt: new Date().toISOString()
                });
                addHistoryEntry(context.task, `Добавлено вложение: ${file.name}`);
                taskAttachmentInput.value = '';
                renderTaskAttachments(context.task);
                renderTaskHistory(context.task);
                refreshTaskRelatedUi();
                try {
                    const rowId = context.task.row_id || taskRowMap.get(taskId);
                    if (!rowId) throw new Error('Не найден row_id задачи');
                    const payload = await apiRequest(`${API_BASE}/${taskId}`, {
                        method: 'PUT',
                        body: JSON.stringify({ ...context.task, row_id: rowId, id: taskId }),
                        timeoutMs: 20000
                    });
                    if (payload?.task) {
                        Object.assign(context.task, payload.task);
                        if (payload.task.row_id) taskRowMap.set(taskId, payload.task.row_id);
                    }
                    setSyncBanner('Вложение сохранено в SeaTable.');
                    showToast('Вложение добавлено', 'success');
                    renderTaskAttachments(context.task);
                } catch (error) {
                    Object.assign(context.task, snapshot);
                    renderTaskAttachments(context.task);
                    renderTaskHistory(context.task);
                    refreshTaskRelatedUi();
                    setSyncBanner(`Не удалось загрузить вложение: ${error.message}`, true);
                    showToast('Ошибка загрузки вложения', 'error');
                }
            };
            reader.readAsDataURL(file);
        });
        taskAttachmentsList?.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove-attachment-btn');
            if (!removeBtn) return;
            const taskId = parseInt(document.getElementById('detailTaskIndex').value);
            const context = findTaskContext(taskId);
            if (!context || !canEditTask(context.task)) return;
            const idx = parseInt(removeBtn.dataset.index);
            const removed = context.task.attachments[idx];
            const snapshot = JSON.parse(JSON.stringify(context.task));
            context.task.attachments.splice(idx, 1);
            if (removed) addHistoryEntry(context.task, `Удалено вложение: ${removed.name}`);
            renderTaskAttachments(context.task);
            renderTaskHistory(context.task);
            refreshTaskRelatedUi();
            void (async () => {
                try {
                    const rowId = context.task.row_id || taskRowMap.get(taskId);
                    if (!rowId) throw new Error('Не найден row_id задачи');
                    const payload = await apiRequest(`${API_BASE}/${taskId}`, {
                        method: 'PUT',
                        body: JSON.stringify({ ...context.task, row_id: rowId, id: taskId }),
                        timeoutMs: 20000
                    });
                    if (payload?.task) {
                        Object.assign(context.task, payload.task);
                        if (payload.task.row_id) taskRowMap.set(taskId, payload.task.row_id);
                    }
                    setSyncBanner('Вложение удалено из SeaTable.');
                    showToast('Вложение удалено', 'success');
                    renderTaskAttachments(context.task);
                } catch (error) {
                    Object.assign(context.task, snapshot);
                    renderTaskAttachments(context.task);
                    renderTaskHistory(context.task);
                    refreshTaskRelatedUi();
                    setSyncBanner(`Не удалось удалить вложение: ${error.message}`, true);
                    showToast('Ошибка удаления вложения', 'error');
                }
            })();
        });
        document.getElementById('addDatabaseBtn')?.addEventListener('click', () => {
            const name = prompt('Название новой базы');
            if (name) {
                databases.push({ id: 'db' + Date.now(), name, tasks: [] });
                populateDatabaseSelects();
                renderBasesList();
                savePersistedData();
            }
        });
        window.addEventListener('click', e => {
            if (e.target.classList.contains('modal')) e.target.classList.remove('show');
        });
        
        // Горячие клавиши
        window.addEventListener('online', () => {
            scheduleSyncTasks('сеть восстановлена');
        });

        window.addEventListener('pageshow', () => {
            scheduleSyncTasks('возврат на страницу');
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                scheduleSyncTasks('вкладка снова активна');
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
            }
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                const detailModal = document.getElementById('taskDetailModal');
                if (detailModal.classList.contains('show')) {
                    taskDetailForm.dispatchEvent(new Event('submit'));
                }
            }
        });
        
        // Сброс таймера сессии при активности пользователя
        ['mousemove', 'keydown', 'click', 'scroll'].forEach(event => {
            document.addEventListener(event, () => { if (currentUser) resetSessionTimer(); }, true);
        });
        
        // Перерисовка при изменении размера окна
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                renderTasks();
            }, 250);
        });
    }

    async function bootstrapSession() {
        let payload;
        try {
            payload = await apiRequest(API_AUTH_ME, { timeoutMs: 8000 });
        } catch (error) {
            localStorage.removeItem(ACTIVE_SESSION_KEY);
            return;
        }
        const savedUser = payload?.user;
        if (!savedUser?.username) return;
        currentUser = { ...savedUser };
        await initUsers();
        localStorage.setItem(ACTIVE_SESSION_KEY, currentUser.username);
        applyRole(currentUser.role);
        loginScreen.style.display = 'none';
        app.style.display = 'flex';
        void initApp();
        resetSessionTimer();
    }

    void bootstrapSession();
})();
