// SeaTable API для пользователей
const fetch = require('node-fetch');

const SEATABLE_SERVER = process.env.SEATABLE_SERVER || 'https://seatable.spyanao.ru';
const SEATABLE_API_TOKEN = process.env.SEATABLE_API_TOKEN || '';
const SEATABLE_BASE_UUID = process.env.SEATABLE_BASE_UUID || '';
const SEATABLE_USERS_TABLE = process.env.SEATABLE_USERS_TABLE || 'Users';

// Вспомогательная функция для запросов к SeaTable
async function seatableRequest(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            'Authorization': `Token ${SEATABLE_API_TOKEN}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`SeaTable API error: ${response.status} - ${error}`);
    }
    
    return response.json();
}

// GET /api/users - получить всех пользователей
module.exports = async (req, res) => {
    if (req.method === 'GET') {
        try {
            const rows = await seatableRequest(
                `${SEATABLE_SERVER}/api/v2.1/dtables/${SEATABLE_BASE_UUID}/rows/?table_name=${encodeURIComponent(SEATABLE_USERS_TABLE)}`
            );
            
            const users = rows.rows.map(row => ({
                username: row.data.username,
                fullName: row.data.full_name,
                role: row.data.role || 'employee',
                department: row.data.department,
                position: row.data.position,
                email: row.data.email,
                phone: row.data.phone
            }));
            
            res.status(200).json({ users });
        } catch (error) {
            console.error('Error fetching users from SeaTable:', error);
            res.status(500).json({ error: 'Не удалось получить пользователей' });
        }
    }
    
    // POST /api/users - создать пользователя
    else if (req.method === 'POST') {
        try {
            const { user } = req.body;
            
            const record = {
                username: user.username,
                full_name: user.fullName,
                role: user.role,
                department: user.department,
                position: user.position,
                email: user.email,
                phone: user.phone
            };
            
            const result = await seatableRequest(
                `${SEATABLE_SERVER}/api/v2.1/dtables/${SEATABLE_BASE_UUID}/rows/?table_name=${encodeURIComponent(SEATABLE_USERS_TABLE)}`,
                {
                    method: 'POST',
                    body: JSON.stringify([record])
                }
            );
            
            res.status(201).json({ success: true, row_id: result[0]?.id });
        } catch (error) {
            console.error('Error creating user in SeaTable:', error);
            res.status(500).json({ error: 'Не удалось создать пользователя' });
        }
    }
    
    // PUT /api/users/:username - обновить пользователя
    else if (req.method === 'PUT') {
        try {
            const { username } = req.params;
            const { user } = req.body;
            
            // Сначала найдём row_id по username
            const rows = await seatableRequest(
                `${SEATABLE_SERVER}/api/v2.1/dtables/${SEATABLE_BASE_UUID}/rows/?table_name=${encodeURIComponent(SEATABLE_USERS_TABLE)}`
            );
            
            const row = rows.rows.find(r => r.data.username === username);
            if (!row) {
                return res.status(404).json({ error: 'Пользователь не найден в SeaTable' });
            }
            
            const record = {
                username: user.username,
                full_name: user.fullName,
                role: user.role,
                department: user.department,
                position: user.position,
                email: user.email,
                phone: user.phone
            };
            
            await seatableRequest(
                `${SEATABLE_SERVER}/api/v2.1/dtables/${SEATABLE_BASE_UUID}/rows/?table_name=${encodeURIComponent(SEATABLE_USERS_TABLE)}`,
                {
                    method: 'PUT',
                    body: JSON.stringify([{
                        row_id: row._id,
                        data: record
                    }])
                }
            );
            
            res.status(200).json({ success: true });
        } catch (error) {
            console.error('Error updating user in SeaTable:', error);
            res.status(500).json({ error: 'Не удалось обновить пользователя' });
        }
    }
    
    // DELETE /api/users/:username - удалить пользователя
    else if (req.method === 'DELETE') {
        try {
            const { username } = req.params;
            
            // Найдём row_id по username
            const rows = await seatableRequest(
                `${SEATABLE_SERVER}/api/v2.1/dtables/${SEATABLE_BASE_UUID}/rows/?table_name=${encodeURIComponent(SEATABLE_USERS_TABLE)}`
            );
            
            const row = rows.rows.find(r => r.data.username === username);
            if (!row) {
                return res.status(404).json({ error: 'Пользователь не найден в SeaTable' });
            }
            
            await seatableRequest(
                `${SEATABLE_SERVER}/api/v2.1/dtables/${SEATABLE_BASE_UUID}/rows/?table_name=${encodeURIComponent(SEATABLE_USERS_TABLE)}`,
                {
                    method: 'DELETE',
                    body: JSON.stringify([row._id])
                }
            );
            
            res.status(200).json({ success: true });
        } catch (error) {
            console.error('Error deleting user from SeaTable:', error);
            res.status(500).json({ error: 'Не удалось удалить пользователя' });
        }
    }
    
    else {
        res.status(405).json({ error: 'Метод не поддерживается' });
    }
};
