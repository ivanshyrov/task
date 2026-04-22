// Конфигурация
const API_GATEWAY = '/.netlify/functions/seatable-api';
let allTasks = [];

// Вспомогательные функции для работы с API
async function callApi(action, data = null, rowId = null) {
    try {
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, data, rowId })
        };
        const response = await fetch(API_GATEWAY, options);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Ошибка API:', error);
        throw error;
    }
}

// Загрузка всех задач
async function loadTasks() {
    const container = document.getElementById('tasks-container');
    container.innerHTML = '<div class="loading">Загрузка задач...</div>';
    
    try {
        const result = await callApi('list');
        if (result && result.rows) {
            allTasks = result.rows;
            renderTasks(allTasks);
        } else {
            container.innerHTML = '<div class="error">Не удалось загрузить задачи</div>';
        }
    } catch (error) {
        container.innerHTML = `<div class="error">Ошибка: ${error.message}</div>`;
    }
}

// Фильтрация и рендеринг задач
function renderTasks(tasks) {
    const container = document.getElementById('tasks-container');
    const filterStatus = document.getElementById('filter-status').value;
    
    let filtered = tasks;
    if (filterStatus) {
        filtered = tasks.filter(t => t.Status === filterStatus);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty">Нет задач для отображения</div>';
        return;
    }
    
    let html = '';
    filtered.forEach(task => {
        const statusClass = getStatusClass(task.Status);
        const deadline = task.Deadline ? new Date(task.Deadline).toLocaleDateString('ru-RU') : 'Без срока';
        
        html += `
            <div class="task-card" data-id="${task._id}">
                <div class="task-header">
                    <span class="task-title">${escapeHtml(task.Name) || 'Без названия'}</span>
                    <span class="task-status ${statusClass}">${escapeHtml(task.Status) || 'Новая'}</span>
                </div>
                ${task.Description ? `<div class="task-description">${escapeHtml(task.Description)}</div>` : ''}
                <div class="task-meta">
                    ${task.Assignee ? `<span>👤 ${escapeHtml(task.Assignee)}</span>` : ''}
                    <span>📅 ${deadline}</span>
                </div>
                <div class="task-actions">
                    <button class="btn btn-secondary btn-small edit-btn" data-id="${task._id}">✏️ Изменить</button>
                    <button class="btn btn-danger btn-small delete-btn" data-id="${task._id}">🗑️ Удалить</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
    
    // Навешиваем обработчики на кнопки
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteTask(btn.dataset.id));
    });
}

function getStatusClass(status) {
    switch(status) {
        case 'Новая': return 'status-new';
        case 'В работе': return 'status-progress';
        case 'На проверке': return 'status-review';
        case 'Завершена': return 'status-done';
        default: return '';
    }
}

function escapeHtml(text) {
    if (!text) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Создание новой задачи
async function createTask(formData) {
    try {
        const result = await callApi('create', formData);
        if (result && result.first_row) {
            alert('Задача успешно создана!');
            document.getElementById('task-form').reset();
            await loadTasks();
        } else {
            alert('Ошибка при создании задачи');
        }
    } catch (error) {
        alert(`Ошибка: ${error.message}`);
    }
}

// Удаление задачи
async function deleteTask(rowId) {
    if (!confirm('Вы уверены, что хотите удалить эту задачу?')) return;
    
    try {
        await callApi('delete', null, rowId);
        await loadTasks();
    } catch (error) {
        alert(`Ошибка при удалении: ${error.message}`);
    }
}

// Редактирование задачи
function openEditModal(rowId) {
    const task = allTasks.find(t => t._id === rowId);
    if (!task) return;
    
    document.getElementById('edit-row-id').value = rowId;
    document.getElementById('edit-name').value = task.Name || '';
    document.getElementById('edit-description').value = task.Description || '';
    document.getElementById('edit-assignee').value = task.Assignee || '';
    document.getElementById('edit-deadline').value = task.Deadline || '';
    document.getElementById('edit-status').value = task.Status || 'Новая';
    
    document.getElementById('edit-modal').style.display = 'block';
}

async function updateTask(formData, rowId) {
    try {
        await callApi('update', formData, rowId);
        alert('Задача обновлена!');
        closeModal();
        await loadTasks();
    } catch (error) {
        alert(`Ошибка при обновлении: ${error.message}`);
    }
}

function closeModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

// Инициализация приложения
function initApp() {
    // Установка текущей даты
    const today = new Date().toLocaleDateString('ru-RU');
    document.getElementById('current-date').textContent = today;
    
    // Загрузка задач
    loadTasks();
    
    // Обработчик формы создания задачи
    document.getElementById('task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = {
            Name: document.getElementById('task-name').value,
            Description: document.getElementById('task-description').value,
            Assignee: document.getElementById('task-assignee').value,
            Deadline: document.getElementById('task-deadline').value,
            Status: document.getElementById('task-status').value
        };
        await createTask(formData);
    });
    
    // Обработчик формы редактирования
    document.getElementById('edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const rowId = document.getElementById('edit-row-id').value;
        const formData = {
            Name: document.getElementById('edit-name').value,
            Description: document.getElementById('edit-description').value,
            Assignee: document.getElementById('edit-assignee').value,
            Deadline: document.getElementById('edit-deadline').value,
            Status: document.getElementById('edit-status').value
        };
        await updateTask(formData, rowId);
    });
    
    // Фильтр по статусу
    document.getElementById('filter-status').addEventListener('change', () => renderTasks(allTasks));
    
    // Кнопка обновления
    document.getElementById('refresh-btn').addEventListener('click', loadTasks);
    
    // Закрытие модального окна
    document.querySelector('.close').addEventListener('click', closeModal);
    document.getElementById('cancel-edit').addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('edit-modal')) closeModal();
    });
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', initApp);