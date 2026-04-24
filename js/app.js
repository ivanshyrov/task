(function(){
    
    "use strict";

    // ==================== ДАННЫЕ ====================
    const databases = [
        { id: 'db1', name: 'Основная', tasks: [] },
        { id: 'db2', name: 'Проекты', tasks: [] }
    ];
    databases[0].tasks.push(
        { id: 1001, createdAt: '2026-04-20', databaseId: 'db1', type: 'Инцидент', title: 'Настроить VPN', department: 'IT', description: 'Настроить VPN', author: 'Шувалов Е.А.', assignee: 'Шувалов Е.А.', office: '229', phone: '2-22-76', priority: 'Высокий', status: 'В работе', deadline: '2026-05-01', report: '', comments: [], history: [] },
        { id: 1002, createdAt: '2026-04-19', databaseId: 'db1', type: 'ПО', title: 'Подготовить презентацию', department: 'Маркетинг', description: 'Подготовить презентацию', author: 'Козлова Д.С.', assignee: '', office: '310', phone: '2-22-52', priority: 'Средний', status: 'Новая', deadline: '2026-04-28', report: '', comments: [], history: [] }
    );

    let FULL_DEPARTMENTS = ['IT', 'Маркетинг', 'Продажи'];

    let currentDatabaseId = 'db1';
    let currentUser = null;
    let notifications = [];
    let nextTaskId = 2000;
    let eventsBound = false;
    let activeQuickFilter = '';
    const taskRowMap = new Map();
    const API_BASE = '/api/tasks';

    const users = [
        { username: 'admin', password: 'admin123', role: 'admin', department: 'IT', fullName: 'Администратор Системы', position: 'Главный администратор', email: 'admin@it-sp.ru', phone: '+7 (999) 111-11-11' },
        { username: 'director', password: 'director123', role: 'director', department: 'IT', fullName: 'Иванов Сергей Петрович', position: 'Руководитель отдела', email: 'director@it-sp.ru', phone: '+7 (999) 222-22-22' },
        { username: 'employee', password: 'employee123', role: 'employee', department: 'IT', fullName: 'Петров Алексей Иванович', position: 'Специалист', email: 'employee@it-sp.ru', phone: '+7 (999) 333-33-33' }
    ];

    let employeesData = [
        { name: 'Шувалов Е.А.', position: 'Начальник IT', department: 'IT', phone: '2-22-76', email: 'shuvalov@it-sp.ru' },
        { name: 'Козлова Д.С.', position: 'Маркетолог', department: 'Маркетинг', phone: '2-22-52', email: 'kozlova@it-sp.ru' }
    ];
    let departmentsData = [
        { name: 'IT', head: 'Шувалов Е.А.', count: 8 },
        { name: 'Маркетинг', head: 'Козлова Д.С.', count: 5 },
        { name: 'Продажи', head: 'Иванов П.Н.', count: 6 }
    ];

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
    const orgNameInput = document.getElementById('orgName');
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
    const syncStatusBanner = document.getElementById('syncStatusBanner');
    const addTaskCommentBtn = document.getElementById('addTaskCommentBtn');
    const taskCommentInput = document.getElementById('taskCommentInput');
    const taskCommentsList = document.getElementById('taskCommentsList');
    const taskHistoryList = document.getElementById('taskHistoryList');
    const taskHistoryFilter = document.getElementById('taskHistoryFilter');
    const taskAttachmentsList = document.getElementById('taskAttachmentsList');
    const taskAttachmentInput = document.getElementById('taskAttachmentInput');
    const addTaskAttachmentBtn = document.getElementById('addTaskAttachmentBtn');
    const DEFAULT_SETTINGS = {
        orgName: 'IT-SP',
        theme: 'light',
        compactMode: false,
        desktopNotifications: true,
        defaultView: 'tasks'
    };
    const TASK_STATUSES = ['Новая', 'Назначена', 'В работе', 'На проверке', 'Закрыта', 'Отклонена'];
    const PRIORITIES = ['Критический', 'Высокий', 'Средний', 'Низкий'];
    const STORAGE_KEY = 'taskPlannerDataV1';
    const SLA_DAYS_BY_PRIORITY = { 'Критический': 1, 'Высокий': 2, 'Средний': 3, 'Низкий': 5 };
    const STATUS_TRANSITIONS = {
        'Новая': ['Назначена', 'Отклонена'],
        'Назначена': ['В работе', 'Отклонена'],
        'В работе': ['На проверке', 'Отклонена'],
        'На проверке': ['Закрыта', 'В работе', 'Отклонена'],
        'Закрыта': [],
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
                type: record.type || 'Прочее',
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

    function canUseDatabaseScopes() {
        return currentUser && (currentUser.role === 'admin' || currentUser.role === 'director');
    }

    function getCurrentDatabase() {
        return databases.find(d => d.id === currentDatabaseId) || null;
    }

    function loadPersistedData() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed.databases)) return;
            databases.splice(0, databases.length, ...parsed.databases);
            if (Array.isArray(parsed.employeesData)) employeesData = parsed.employeesData;
            if (Array.isArray(parsed.departmentsData)) departmentsData = parsed.departmentsData;
            if (parsed.currentDatabaseId && databases.some(d => d.id === parsed.currentDatabaseId)) {
                currentDatabaseId = parsed.currentDatabaseId;
            }
        } catch (error) {
            console.error('Ошибка чтения сохраненных данных:', error);
        }
    }

    function savePersistedData() {
        if (!dataLoaded) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            databases,
            employeesData,
            departmentsData,
            currentDatabaseId
        }));
    }

    function refreshTaskRelatedUi() {
        renderTasks();
        updateStats();
        populateDepartmentSelects();
        renderBasesList();
        savePersistedData();
    }

    function logoutUser() {
        currentUser = null;
        app.style.display = 'none';
        loginScreen.style.display = 'flex';
        sidebar.classList.remove('open');
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
    }

    function updateDefaultViewOptions() {
        if (!defaultViewSelect || !currentUser) return;
        const allowedViews = getAllowedStartViews();
        Array.from(defaultViewSelect.options).forEach(option => {
            option.hidden = !allowedViews.includes(option.value);
        });
        defaultViewSelect.value = resolveStartView(defaultViewSelect.value);
    }

    function normalizeTask(task) {
        if (task.status === 'Завершена') task.status = 'Закрыта';
        if (!TASK_STATUSES.includes(task.status)) task.status = 'Новая';
        task.type = task.type || 'Прочее';
        task.title = task.title || task.description || `Заявка #${task.id}`;
        task.assignee = task.assignee || '';
        if (!PRIORITIES.includes(task.priority)) task.priority = 'Средний';
        task.updatedAt = task.updatedAt || task.createdAt || new Date().toISOString().split('T')[0];
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
        return date.toISOString().split('T')[0];
    }

    function validateTaskShape(task) {
        if (!task.title || !task.title.trim()) return 'Тема заявки обязательна';
        if (!task.description || !task.description.trim()) return 'Описание заявки обязательно';
        if (!PRIORITIES.includes(task.priority)) return 'Некорректный приоритет';
        if (!TASK_STATUSES.includes(task.status)) return 'Некорректный статус';
        if (!task.department) return 'Отдел обязателен';
        if (task.status === 'Назначена' && !task.assignee) return 'Для статуса "Назначена" нужно выбрать исполнителя';
        if (task.status === 'На проверке' && !task.report?.trim()) return 'Для статуса "На проверке" нужен отчёт';
        if (task.status === 'Отклонена' && !task.rejectedReason?.trim()) return 'Для статуса "Отклонена" нужна причина';
        return '';
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
        if (currentUser.role === 'director') {
            return task.department === currentUser.department || task.author === currentUser.fullName;
        }
        return task.author === currentUser.fullName;
    }

    function canAssignTask(task) {
        if (!currentUser) return false;
        return (currentUser.role === 'admin' || currentUser.role === 'director') && canViewTask(task);
    }

    function canEditTask(task) {
        if (!currentUser) return false;
        if (!canViewTask(task)) return false;
        if (currentUser.role === 'admin') return task.status !== 'Закрыта';
        if (currentUser.role === 'director') return task.status !== 'Закрыта';
        return task.author === currentUser.fullName && task.status === 'Новая';
    }

    function canDeleteTask(task) {
        if (!currentUser) return false;
        if (!canViewTask(task)) return false;
        if (currentUser.role === 'admin') return true;
        if (currentUser.role === 'director') return task.status !== 'Закрыта';
        return task.author === currentUser.fullName && task.status === 'Новая';
    }

    function getEditDeniedReason(task) {
        if (!currentUser) return 'Нужно войти в систему';
        if (!canViewTask(task)) return 'Нет доступа к заявке';
        if (task.status === 'Закрыта') return 'Закрытые заявки нельзя редактировать';
        if (currentUser.role === 'employee' && task.author !== currentUser.fullName) return 'Сотрудник редактирует только свои заявки';
        if (currentUser.role === 'employee' && task.status !== 'Новая') return 'Сотрудник редактирует только новые заявки';
        return 'Недостаточно прав';
    }

    function getDeleteDeniedReason(task) {
        if (!currentUser) return 'Нужно войти в систему';
        if (!canViewTask(task)) return 'Нет доступа к заявке';
        if (currentUser.role === 'director' && task.status === 'Закрыта') return 'Руководитель не удаляет закрытые заявки';
        if (currentUser.role === 'employee' && task.author !== currentUser.fullName) return 'Можно удалять только свои заявки';
        if (currentUser.role === 'employee' && task.status !== 'Новая') return 'Можно удалять только новые заявки';
        return 'Недостаточно прав';
    }

    function canTransitionStatus(task, nextStatus) {
        if (!TASK_STATUSES.includes(nextStatus)) return false;
        if (task.status === nextStatus) return true;
        if (!STATUS_TRANSITIONS[task.status]?.includes(nextStatus)) return false;
        if (!currentUser) return false;
        if (currentUser.role === 'admin') return true;
        if (currentUser.role === 'director') return canViewTask(task);
        if (currentUser.role === 'employee') {
            if (task.author !== currentUser.fullName) return false;
            if (task.assignee && task.assignee !== currentUser.fullName) return false;
            return nextStatus === 'В работе' || nextStatus === 'На проверке';
        }
        return false;
    }

    function getAssignableEmployees(department) {
        const fromEmployees = employeesData.filter(e => e.department === department).map(e => e.name);
        const fromUsers = users.filter(u => u.department === department).map(u => u.fullName);
        return [...new Set([...fromEmployees, ...fromUsers])].sort();
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

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `Ошибка API (${response.status})`);
        }
        return response.status === 204 ? null : response.json();
    }

    async function syncTasksFromApi() {
        setSyncBanner('Синхронизация задач с SeaTable...');
        try {
            const payload = await apiRequest(API_BASE);
            const remoteTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
            taskRowMap.clear();
            databases.forEach(db => { db.tasks = []; });
            remoteTasks.forEach((task) => {
                const normalizedTask = { ...task };
                normalizeTask(normalizedTask);
                if (task.row_id) taskRowMap.set(normalizedTask.id, task.row_id);
                const db = databases.find(d => d.id === normalizedTask.databaseId) || databases[0];
                normalizedTask.databaseId = db.id;
                db.tasks.push(normalizedTask);
            });
            let maxId = 0;
            databases.forEach(db => db.tasks.forEach(t => { if (t.id > maxId) maxId = t.id; }));
            nextTaskId = Math.max(nextTaskId, maxId + 1);
            refreshTaskRelatedUi();
            setSyncBanner('SeaTable подключен. Данные актуальны.');
        } catch (error) {
            setSyncBanner(`Работа офлайн: ${error.message}`, true);
        }
    }

    // ==================== АВТОРИЗАЦИЯ ====================
    loginForm.addEventListener('submit', e => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        const user = users.find(u => u.username === username && u.password === password);
        if (!user) { alert('Неверный логин или пароль'); return; }
        currentUser = { ...user };
        applyRole(currentUser.role);
        loginScreen.style.display = 'none';
        app.style.display = 'flex';
        initApp();
    });

    function applyRole(role) {
        const roleNames = { admin: 'Администратор', director: 'Руководитель', employee: 'Сотрудник' };
        roleName.textContent = roleNames[role];
        document.querySelectorAll('[data-role]').forEach(el => {
            el.style.display = el.dataset.role.split(',').includes(role) ? '' : 'none';
        });
        openQuickTaskBtn.style.display = (role === 'employee' || role === 'admin' || role === 'director') ? 'flex' : 'none';
        if (filterDatabase) filterDatabase.style.display = (role === 'admin' || role === 'director') ? 'block' : 'none';
        if (reportDatabase) reportDatabase.style.display = (role === 'admin' || role === 'director') ? 'block' : 'none';
        const canBulkDelete = role === 'admin' || role === 'director';
        deleteSelectedBtn.style.display = canBulkDelete ? 'inline-flex' : 'none';
        selectAllTasks.style.display = canBulkDelete ? 'inline-block' : 'none';
        updateDefaultViewOptions();
    }

    function initApp() {
        loadPersistedData();
        let maxId = 0;
        databases.forEach(db => db.tasks.forEach(t => {
            normalizeTask(t);
            if (t.id > maxId) maxId = t.id;
        }));
        dataLoaded = true;
        nextTaskId = maxId + 1;
        FULL_DEPARTMENTS = departmentsData.map(d => d.name);
        populateDatabaseSelects();
        populateDepartmentSelects();
        renderTasks();
        renderEmployees();
        renderDepartments();
        renderBasesList();
        updateStats();
        updateNotificationBadge();
        const settings = loadSettings();
        if (!eventsBound) {
            setupEventListeners();
            eventsBound = true;
        }
        switchView(resolveStartView(settings.defaultView));
        updateHeaderAvatar();
        void syncTasksFromApi();
    }

    function updateHeaderAvatar() {
        const saved = localStorage.getItem(`avatar_${currentUser?.username}`);
        if (saved) {
            headerAvatar.src = saved;
            headerAvatar.style.display = 'block';
            headerAvatarIcon.style.display = 'none';
        } else {
            headerAvatar.style.display = 'none';
            headerAvatarIcon.style.display = 'block';
        }
    }

    // ==================== SELECT'Ы ====================
    function populateDatabaseSelects() {
        [filterDatabase, document.querySelector('#quickTaskForm select[name="database"]'), reportDatabase].forEach(select => {
            if (!select) return;
            select.innerHTML = '';
            databases.forEach(db => {
                const opt = document.createElement('option');
                opt.value = db.id;
                opt.textContent = db.name;
                select.appendChild(opt);
            });
        });
        if (filterDatabase) filterDatabase.value = currentDatabaseId;
        if (reportDatabase) reportDatabase.value = currentDatabaseId;
    }

    function populateDepartmentSelects() {
        if (filterDepartment) {
            const deptsInTasks = new Set();
            databases.forEach(db => db.tasks.forEach(t => deptsInTasks.add(t.department)));
            filterDepartment.innerHTML = '<option value="">Все отделы</option>';
            [...deptsInTasks].filter(d => d).sort().forEach(dept => {
                const opt = document.createElement('option');
                opt.value = dept; opt.textContent = dept;
                filterDepartment.appendChild(opt);
            });
        }
        const formSelect = document.querySelector('#quickTaskForm select[name="department"]');
        if (formSelect) {
            formSelect.innerHTML = '';
            FULL_DEPARTMENTS.forEach(dept => {
                const opt = document.createElement('option');
                opt.value = dept; opt.textContent = dept;
                formSelect.appendChild(opt);
            });
            if (formSelect.options.length > 0) formSelect.value = formSelect.options[0].value;
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
        if (filterDate.value) tasks = tasks.filter(t => t.createdAt === filterDate.value);
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
        } else if (activeQuickFilter === 'review') {
            tasks = tasks.filter(t => t.status === 'На проверке');
        } else if (activeQuickFilter === 'overdue') {
            const today = new Date().toISOString().split('T')[0];
            tasks = tasks.filter(t => t.deadline && t.deadline < today && t.status !== 'Закрыта');
        }
        const priorityWeight = { 'Критический': 4, 'Высокий': 3, 'Средний': 2, 'Низкий': 1 };
        const sortMode = sortTasks?.value || 'createdAt_desc';
        tasks = tasks.slice().sort((a, b) => {
            if (sortMode === 'createdAt_asc') return (a.createdAt || '').localeCompare(b.createdAt || '');
            if (sortMode === 'createdAt_desc') return (b.createdAt || '').localeCompare(a.createdAt || '');
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
        const today = new Date(); today.setHours(0,0,0,0);
        const dl = new Date(deadline); dl.setHours(0,0,0,0);
        return Math.ceil((dl - today) / (1000*60*60*24));
    }

    function renderTasks() {
        const filtered = filterTasks();
        let html = '';
        filtered.forEach(task => {
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

            html += `<tr data-index="${task.id}" draggable="true" class="task-row" data-taskid="${task.id}">
                <td><input type="checkbox" class="task-checkbox" data-id="${task.id}" ${canDelete ? '' : 'disabled'}></td>
                <td>${task.id}</td><td>${task.createdAt}</td><td>${dbName}</td><td>${task.type || 'Прочее'}</td><td>${task.title || '—'}</td><td>${task.department}</td>
                <td>${task.author}</td><td>${task.assignee || '—'}</td><td>${task.office}</td><td>${task.phone}</td>
                <td class="priority-${task.priority.toLowerCase()}">${task.priority}</td>
                <td><span class="status-badge ${statusClass}">${task.status}</span></td>
                <td>${task.deadline || '—'}</td>
                <td style="${daysStyle}">${daysDisplay}</td>
                <td>${task.report ? '✓' : ''}</td>
                <td class="action-buttons">
                    <button class="icon-btn view-task" title="Просмотр"><i class="fas fa-eye"></i></button>
                    <button class="icon-btn edit-task ${canEdit ? '' : 'icon-btn-disabled'}" title="${editHint}" data-id="${task.id}" ${canEdit ? '' : 'disabled'}><i class="fas fa-edit"></i></button>
                    <button class="icon-btn delete-task-btn ${canDelete ? '' : 'icon-btn-disabled'}" title="${deleteHint}" data-id="${task.id}" ${canDelete ? '' : 'disabled'}><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        });
        tasksTbody.innerHTML = html || `<tr><td colspan="17" style="text-align:center; padding:40px;">Нет задач</td></tr>`;
        attachRowButtons();
        setupDragAndDrop();
        document.querySelectorAll('.task-row').forEach(row => {
            row.addEventListener('click', function(e) {
                if (e.target.closest('button') || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
                openTaskDetail(parseInt(this.dataset.taskid), true);
            });
        });
    }

    function getStatusClass(s) {
        switch(s) {
            case 'Новая': return 'status-new';
            case 'Назначена': return 'status-assigned';
            case 'В работе': return 'status-progress';
            case 'На проверке': return 'status-review';
            case 'Закрыта': return 'status-done';
            case 'Отклонена': return 'status-rejected';
            default: return '';
        }
    }

    function attachRowButtons() {
        document.querySelectorAll('.view-task').forEach(btn => btn.addEventListener('click', e => {
            const row = e.target.closest('tr');
            openTaskDetail(parseInt(row.dataset.taskid), true);
        }));
        document.querySelectorAll('.edit-task').forEach(btn => btn.addEventListener('click', e => {
            if (btn.disabled) return;
            const row = e.target.closest('tr');
            openTaskDetail(parseInt(row.dataset.taskid), false);
        }));
        document.querySelectorAll('.delete-task-btn').forEach(btn => btn.addEventListener('click', async e => {
            if (btn.disabled) return;
            const taskId = parseInt(btn.dataset.id);
            const context = findTaskContext(taskId);
            if (!context || !canDeleteTask(context.task)) return;
            if (confirm('Удалить задачу?')) {
                const rowId = taskRowMap.get(taskId);
                const snapshot = [...context.db.tasks];
                context.db.tasks = context.db.tasks.filter(t => t.id !== taskId);
                refreshTaskRelatedUi();
                try {
                    await apiRequest(`${API_BASE}/${taskId}`, {
                        method: 'DELETE',
                        body: JSON.stringify({ row_id: rowId })
                    });
                    taskRowMap.delete(taskId);
                    setSyncBanner('Изменения сохранены в SeaTable.');
                } catch (error) {
                    context.db.tasks = snapshot;
                    refreshTaskRelatedUi();
                    setSyncBanner(`Не удалось удалить задачу: ${error.message}`, true);
                }
            }
        }));
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
        f.type.value = task.type || 'Прочее';
        f.title.value = task.title || '';
        f.description.value = task.description;
        f.database.value = databases.find(d => d.id === task.databaseId)?.name || '';
        f.department.value = task.department;
        f.author.value = task.author;
        const assigneeOptions = [''].concat(getAssignableEmployees(task.department));
        f.assignee.innerHTML = assigneeOptions.map(name => `<option value="${name}">${name || 'Не назначен'}</option>`).join('');
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
                <div class="comment-meta">${a.author} · ${new Date(a.createdAt).toLocaleString('ru-RU')}</div>
                <a href="${a.dataUrl}" download="${a.name}">${a.name}</a>
                <button type="button" class="icon-btn remove-attachment-btn" data-index="${idx}" title="Удалить"><i class="fas fa-trash"></i></button>
            </div>`
        ).join('') || '<div class="comment-item"><div class="comment-meta">Вложений пока нет</div></div>';
    }

    async function updateTaskFromModal() {
        const taskId = parseInt(document.getElementById('detailTaskIndex').value);
        const context = findTaskContext(taskId);
        if (!context) return false;
        const task = context.task;
        if (!canEditTask(task)) { alert('Недостаточно прав для редактирования'); return false; }
        const f = taskDetailForm;
        const nextStatus = f.status.value;
        if (!canTransitionStatus(task, nextStatus)) {
            alert('Недопустимый переход статуса для вашей роли');
            return false;
        }
        if (nextStatus === 'На проверке' && !f.report.value.trim()) {
            alert('Для перевода на проверку заполните отчёт');
            return false;
        }
        const prevStatus = task.status;
        const prevAssignee = task.assignee || '';
        const draft = { ...task };
        draft.type = f.type.value;
        draft.title = f.title.value.trim() || task.title;
        draft.status = f.status.value;
        draft.priority = f.priority.value;
        draft.deadline = f.deadline.value;
        draft.description = f.description.value;
        if (canAssignTask(task)) draft.assignee = f.assignee.value;
        draft.office = f.office.value;
        draft.phone = f.phone.value;
        draft.report = f.report.value;
        draft.rejectedReason = f.rejectedReason.value.trim();
        draft.slaDays = draft.slaDays || SLA_DAYS_BY_PRIORITY[draft.priority] || 3;
        if (!draft.deadline) draft.deadline = getDateWithOffset(draft.slaDays);
        if (prevStatus !== draft.status) {
            const now = new Date().toISOString();
            if (draft.status === 'Назначена') draft.assignedAt = now;
            if (draft.status === 'В работе') draft.inProgressAt = now;
            if (draft.status === 'На проверке') draft.reviewAt = now;
            if (draft.status === 'Закрыта') draft.closedAt = now;
            if (draft.status === 'Отклонена') draft.rejectedAt = now;
        }
        const validationError = validateTaskShape(draft);
        if (validationError) {
            alert(validationError);
            return false;
        }
        const snapshot = JSON.parse(JSON.stringify(task));
        Object.assign(task, draft);
        task.updatedAt = new Date().toISOString().split('T')[0];
        if (prevStatus !== task.status) addHistoryEntry(task, `Статус: ${prevStatus} -> ${task.status}`);
        if (prevAssignee !== task.assignee) addHistoryEntry(task, `Исполнитель: ${prevAssignee || 'Не назначен'} -> ${task.assignee || 'Не назначен'}`);
        refreshTaskRelatedUi();
        try {
            const rowId = taskRowMap.get(task.id);
            await apiRequest(`${API_BASE}/${task.id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...task, row_id: rowId })
            });
            showToast(`Задача #${task.id} обновлена`);
            setSyncBanner('Изменения сохранены в SeaTable.');
            return true;
        } catch (error) {
            Object.assign(task, snapshot);
            refreshTaskRelatedUi();
            setSyncBanner(`Не удалось обновить задачу: ${error.message}`, true);
            alert(`Ошибка обновления: ${error.message}`);
            return false;
        }
    }

    async function createTask(formData) {
        if (quickTaskForm.dataset.submitting === 'true') return;
        quickTaskForm.dataset.submitting = 'true';

        const dbId = formData.get('database') || currentDatabaseId;
        const db = databases.find(d => d.id === dbId);
        if (!db) { quickTaskForm.dataset.submitting = 'false'; return false; }

        const dept = formData.get('department');
        if (!dept) { alert('Выберите отдел'); quickTaskForm.dataset.submitting = 'false'; return false; }
        const title = (formData.get('title') || '').trim();
        if (!title) { alert('Введите тему заявки'); quickTaskForm.dataset.submitting = 'false'; return false; }

        const description = formData.get('description').trim();
        if (!description) {
            alert('Введите описание задачи');
            quickTaskForm.dataset.submitting = 'false';
            return false;
        }

        const newTask = {
            id: nextTaskId++,
            createdAt: new Date().toISOString().split('T')[0],
            updatedAt: new Date().toISOString().split('T')[0],
            databaseId: dbId,
            type: formData.get('type') || 'Прочее',
            title,
            department: dept,
            description: description,
            author: currentUser.fullName,
            assignee: '',
            office: formData.get('office') || '—',
            phone: formData.get('phone') || '—',
            priority: formData.get('priority'),
            status: 'Новая',
            deadline: formData.get('deadline') || '',
            slaDays: SLA_DAYS_BY_PRIORITY[formData.get('priority')] || 3,
            assignedAt: '',
            inProgressAt: '',
            reviewAt: '',
            closedAt: '',
            rejectedAt: '',
            rejectedReason: '',
            report: '',
            comments: [],
            history: [],
            attachments: []
        };
        if (!newTask.deadline) newTask.deadline = getDateWithOffset(newTask.slaDays);
        const validationError = validateTaskShape(newTask);
        if (validationError) {
            alert(validationError);
            quickTaskForm.dataset.submitting = 'false';
            return false;
        }
        addHistoryEntry(newTask, 'Заявка создана');

        try {
            db.tasks.push(newTask);
            addNotification(`Новая задача #${newTask.id} от ${newTask.author}`, newTask.id);
            refreshTaskRelatedUi();
            const payload = await apiRequest(API_BASE, {
                method: 'POST',
                body: JSON.stringify(newTask)
            });
            if (payload?.task?.row_id) taskRowMap.set(newTask.id, payload.task.row_id);
            quickTaskForm.reset();
            document.querySelector('#quickTaskForm select[name="database"]').value = currentDatabaseId;
            showToast(`Задача #${newTask.id} успешно создана`);
            setSyncBanner('Изменения сохранены в SeaTable.');
            return true;
        } catch (error) {
            db.tasks = db.tasks.filter(t => t.id !== newTask.id);
            refreshTaskRelatedUi();
            setSyncBanner(`Не удалось сохранить задачу: ${error.message}`, true);
            alert(`Ошибка сохранения: ${error.message}`);
            return false;
        } finally {
            quickTaskForm.dataset.submitting = 'false';
        }
    }

    // ==================== УДАЛЕНИЕ ВЫБРАННЫХ ====================
    async function deleteSelectedTasks() {
        const checkboxes = document.querySelectorAll('.task-checkbox:checked');
        if (checkboxes.length === 0) { alert('Выберите задачи'); return; }
        const ids = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id));
        const removableIds = ids.filter(id => {
            const context = findTaskContext(id);
            return context && canDeleteTask(context.task);
        });
        if (!removableIds.length) { alert('Нет задач для удаления по вашим правам'); return; }
        if (!confirm(`Удалить ${removableIds.length} задач(у)?`)) return;
        const snapshots = databases.map(db => ({ id: db.id, tasks: [...db.tasks] }));
        databases.forEach(db => {
            db.tasks = db.tasks.filter(t => !removableIds.includes(t.id));
        });
        refreshTaskRelatedUi();
        try {
            for (const id of removableIds) {
                const rowId = taskRowMap.get(id);
                await apiRequest(`${API_BASE}/${id}`, {
                    method: 'DELETE',
                    body: JSON.stringify({ row_id: rowId })
                });
                taskRowMap.delete(id);
            }
            setSyncBanner('Изменения сохранены в SeaTable.');
        } catch (error) {
            snapshots.forEach(snapshot => {
                const db = databases.find(item => item.id === snapshot.id);
                if (db) db.tasks = snapshot.tasks;
            });
            refreshTaskRelatedUi();
            setSyncBanner(`Ошибка пакетного удаления: ${error.message}`, true);
        }
    }

    // ==================== ФИЛЬТРЫ И ЭКСПОРТ ====================
    [filterDepartment, filterPriority, filterStatus, filterDate, searchTask, sortTasks].forEach(el => el?.addEventListener('input', renderTasks));
    filterDatabase?.addEventListener('change', e => {
        currentDatabaseId = e.target.value;
        if (reportDatabase) reportDatabase.value = currentDatabaseId;
            renderTasks();
            populateDepartmentSelects();
        savePersistedData();
    });
    resetFiltersBtn.addEventListener('click', () => {
        filterDepartment.value = filterPriority.value = filterStatus.value = filterDate.value = searchTask.value = '';
        if (sortTasks) sortTasks.value = 'createdAt_desc';
        activeQuickFilter = '';
        quickFilterButtons.forEach(b => b.classList.remove('active'));
        renderTasks();
    });
    setTodayFilterBtn.addEventListener('click', () => {
        filterDate.value = new Date().toISOString().split('T')[0]; renderTasks();
    });
    setTodayDeadlineBtn.addEventListener('click', () => {
        quickTaskDeadline.value = new Date().toISOString().split('T')[0];
    });
    exportTasksBtn.addEventListener('click', () => {
        const filtered = filterTasks();
        if (!filtered.length) { alert('Нет данных'); return; }
        const headers = ['ID','Дата создания','База','Тип','Тема','Отдел','Описание','Автор','Исполнитель','Кабинет','Телефон','Приоритет','Статус','Срок','SLA(дней)','Отчёт','Причина отклонения'];
        const rows = filtered.map(t => [t.id, t.createdAt, databases.find(d=>d.id===t.databaseId)?.name||'', t.type || '', t.title || '', t.department, t.description, t.author, t.assignee || '', t.office, t.phone, t.priority, t.status, t.deadline, t.slaDays || '', t.report, t.rejectedReason || '']);
        const csv = headers.join(',') + '\n' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8;'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tasks_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    });

    // ==================== DRAG & DROP ====================
    let dragSrcId = null;
    function setupDragAndDrop() {
        document.querySelectorAll('.task-row').forEach(row => {
            if (!(currentUser && (currentUser.role === 'admin' || currentUser.role === 'director'))) return;
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

    // ==================== УВЕДОМЛЕНИЯ ====================
    function addNotification(msg, taskId) {
        notifications.unshift({ id: Date.now(), message: msg, taskId, read: false });
        updateNotificationBadge();
    }
    function updateNotificationBadge() { notificationCount.textContent = notifications.filter(n => !n.read).length; }
    notificationBadge.addEventListener('click', () => {
        notificationsList.innerHTML = notifications.map(n => `<div class="notification-item ${n.read?'':'unread'}"><i class="fas fa-bell"></i><div>${n.message}</div></div>`).join('') || '<p>Нет уведомлений</p>';
        notifications.forEach(n => n.read = true);
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

    document.getElementById('profileForm').addEventListener('submit', e => {
        e.preventDefault();
        const oldName = currentUser.fullName;
        currentUser.fullName = document.getElementById('profileFullName').value;
        currentUser.position = document.getElementById('profilePosition').value;
        currentUser.email = document.getElementById('profileEmail').value;
        currentUser.phone = document.getElementById('profilePhone').value;
        if (oldName !== currentUser.fullName) {
            databases.forEach(db => db.tasks.forEach(t => { if (t.author === oldName) t.author = currentUser.fullName; }));
            renderTasks();
        }
        profileModal.classList.remove('show');
    });

    document.getElementById('changeAvatarBtn').addEventListener('click', () => document.getElementById('avatarUpload').click());
    document.getElementById('avatarUpload').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) saveAvatar(file, currentUser.username);
    });

    function saveAvatar(file, username) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const maxSize = 200;
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
                const compressedData = canvas.toDataURL('image/jpeg', 0.7);
                localStorage.setItem(`avatar_${username}`, compressedData);
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
        if (orgNameInput) orgNameInput.value = settings.orgName;
        if (themeSelect) themeSelect.value = settings.theme;
        if (compactModeInput) compactModeInput.checked = Boolean(settings.compactMode);
        if (desktopNotificationsInput) desktopNotificationsInput.checked = Boolean(settings.desktopNotifications);
        if (defaultViewSelect) defaultViewSelect.value = resolveStartView(settings.defaultView);
        updateDefaultViewOptions();
        document.querySelector('.logo').textContent = settings.orgName + ' · Планировщик';
        applyUiSettings(settings);
        return settings;
    }
    settingsForm.addEventListener('submit', e => {
        e.preventDefault();
        const currentSettings = getAppSettings();
        const canEditOrgName = currentUser && (currentUser.role === 'admin' || currentUser.role === 'director');
        const nextSettings = {
            ...currentSettings,
            orgName: canEditOrgName ? (orgNameInput?.value?.trim() || DEFAULT_SETTINGS.orgName) : currentSettings.orgName,
            theme: themeSelect?.value === 'dark' ? 'dark' : 'light',
            compactMode: Boolean(compactModeInput?.checked),
            desktopNotifications: Boolean(desktopNotificationsInput?.checked),
            defaultView: resolveStartView(defaultViewSelect?.value || 'tasks')
        };
        saveAppSettings(nextSettings);
        document.querySelector('.logo').textContent = nextSettings.orgName + ' · Планировщик';
        applyUiSettings(nextSettings);
        alert('Настройки сохранены');
    });

    // ==================== РАЗДЕЛЫ ====================
    function renderEmployees() {
        document.getElementById('employeesTableBody').innerHTML = employeesData.map((e, index) => 
            `<tr>
                <td>${e.name}</td><td>${e.position}</td><td>${e.department}</td><td>${e.phone}</td><td>${e.email}</td>
                <td><button class="icon-btn delete-employee" data-index="${index}" title="Удалить"><i class="fas fa-trash"></i></button></td>
            </tr>`
        ).join('');
        document.querySelectorAll('.delete-employee').forEach(btn => btn.addEventListener('click', function() {
            const idx = parseInt(this.dataset.index);
            employeesData.splice(idx, 1);
            renderEmployees();
            savePersistedData();
        }));
    }

    function renderDepartments() {
        document.getElementById('departmentsTableBody').innerHTML = departmentsData.map((d, index) => 
            `<tr>
                <td>${d.name}</td><td>${d.head}</td><td>${d.count}</td>
                <td><button class="icon-btn delete-department" data-index="${index}" title="Удалить"><i class="fas fa-trash"></i></button></td>
            </tr>`
        ).join('');
        document.querySelectorAll('.delete-department').forEach(btn => btn.addEventListener('click', function() {
            const idx = parseInt(this.dataset.index);
            const name = departmentsData[idx].name;
            departmentsData.splice(idx, 1);
            FULL_DEPARTMENTS = departmentsData.map(d => d.name);
            populateDepartmentSelects();
            renderDepartments();
            databases.forEach(db => db.tasks = db.tasks.filter(t => t.department !== name));
            renderTasks();
            renderBasesList();
            savePersistedData();
        }));
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
        const tasks = getCurrentDatabaseTasks();
        document.getElementById('statTotalTasks').textContent = tasks.length;
        document.getElementById('statInProgress').textContent = tasks.filter(t => t.status === 'В работе').length;
        document.getElementById('statCompleted').textContent = tasks.filter(t => t.status === 'Закрыта').length;
        if (statNewTasks) statNewTasks.textContent = tasks.filter(t => t.status === 'Новая').length;
        const today = new Date().toISOString().split('T')[0];
        const overdueEl = document.getElementById('statOverdue');
        if (overdueEl) overdueEl.textContent = tasks.filter(t => t.deadline && t.deadline < today && t.status !== 'Закрыта').length;
        const inSlaEl = document.getElementById('statInSla');
        const outSlaEl = document.getElementById('statOutSla');
        let inSla = 0;
        let outSla = 0;
        tasks.forEach(t => {
            if (!t.deadline) return;
            if (t.status === 'Закрыта') {
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
        const tasks = getCurrentDatabaseTasks();
        const deptCounts = {};


        tasks.forEach(t => { deptCounts[t.department] = (deptCounts[t.department]||0)+1; });
        renderBarList('statsDepartments', deptCounts);
        const authorCounts = {};
        tasks.forEach(t => { authorCounts[t.author] = (authorCounts[t.author]||0)+1; });
        const sorted = Object.entries(authorCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
        renderBarList('statsAssignees', Object.fromEntries(sorted));
        const statusCounts = {};
        tasks.forEach(t => { statusCounts[t.status] = (statusCounts[t.status]||0)+1; });
        renderBarList('statsStatuses', statusCounts, { 'Новая':'var(--primary-light)', 'Назначена':'#22c55e', 'В работе':'var(--warning)', 'На проверке':'#9b59b6', 'Закрыта':'var(--success)', 'Отклонена':'var(--danger)' });
        const dailyContainer = document.getElementById('statsDaily');
        if (!dailyContainer) return;
        const dates = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }
        const dailyCounts = {};
        dates.forEach(d => dailyCounts[d] = 0);
        tasks.forEach(t => { if (dailyCounts.hasOwnProperty(t.createdAt)) dailyCounts[t.createdAt]++; });
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
            btn.innerHTML = '<i class="fas fa-chart-pie"></i> Простая статистика';
            renderDetailedStats();
        } else {
            simple.style.display = 'grid';
            detailed.style.display = 'none';
            btn.innerHTML = '<i class="fas fa-chart-pie"></i> Детальная статистика';
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
        } else if (viewId === 'bases') {
            renderBasesList();
        } else if (viewId === 'settings') {
            loadSettings();
        }
    }

    // ==================== ТОСТЫ ====================
    function showToast(message) {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // ==================== ДОБАВЛЕНИЕ ====================
    document.getElementById('addEmployeeBtn')?.addEventListener('click', () => {
        const name = prompt('ФИО сотрудника'); if (!name) return;
        const position = prompt('Должность') || '';
        const department = prompt('Отдел') || '';
        const phone = prompt('Телефон') || '';
        const email = prompt('Email') || '';
        employeesData.push({ name, position, department, phone, email });
        if (department && !FULL_DEPARTMENTS.includes(department)) {
            FULL_DEPARTMENTS.push(department);
            populateDepartmentSelects();
        }
        renderEmployees();
        savePersistedData();
    });

    document.getElementById('addDepartmentBtn')?.addEventListener('click', () => {
        const name = prompt('Название отдела'); if (!name) return;
        const head = prompt('Руководитель') || '';
        const count = parseInt(prompt('Количество сотрудников')) || 0;
        departmentsData.push({ name, head, count });
        FULL_DEPARTMENTS = departmentsData.map(d => d.name);
        populateDepartmentSelects();
        renderDepartments();
        savePersistedData();
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
            document.querySelector('#quickTaskForm select[name="database"]').value = currentDatabaseId;
            quickTaskForm.dataset.submitting = 'false';
            quickTaskModal.classList.add('show');
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
        logoutBtn.addEventListener('click', () => {
            logoutUser();
        });
        roleDisplay.style.cursor = 'pointer';
        roleDisplay.addEventListener('click', () => {
            if (confirm('Выйти из системы?')) {
                logoutUser();
            }
        });
        selectAllTasks.addEventListener('change', e => {
            document.querySelectorAll('.task-checkbox').forEach(cb => cb.checked = e.target.checked);
        });
        deleteSelectedBtn.addEventListener('click', () => { void deleteSelectedTasks(); });
        quickFilterButtons.forEach(btn => btn.addEventListener('click', () => {
            activeQuickFilter = btn.dataset.quickFilter || '';
            quickFilterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTasks();
        }));
        toggleDetailedStatsBtn.addEventListener('click', toggleDetailedStats);
        reportDatabase.addEventListener('change', e => {
            currentDatabaseId = e.target.value;
            if (filterDatabase) filterDatabase.value = currentDatabaseId;
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
            reader.onload = () => {
                context.task.attachments.push({
                    name: file.name,
                    size: file.size,
                    dataUrl: String(reader.result || ''),
                    author: currentUser.fullName,
                    createdAt: new Date().toISOString()
                });
                addHistoryEntry(context.task, `Добавлено вложение: ${file.name}`);
                taskAttachmentInput.value = '';
                renderTaskAttachments(context.task);
                renderTaskHistory(context.task);
                refreshTaskRelatedUi();
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
            context.task.attachments.splice(idx, 1);
            if (removed) addHistoryEntry(context.task, `Удалено вложение: ${removed.name}`);
            renderTaskAttachments(context.task);
            renderTaskHistory(context.task);
            refreshTaskRelatedUi();
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
    }
})();