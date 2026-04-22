// netlify/functions/seatable-api.js
const SEATABLE_URL = process.env.SEATABLE_URL || 'https://cloud.seatable.io';
const API_TOKEN = process.env.SEATABLE_API_TOKEN;
const TABLE_NAME = process.env.SEATABLE_TABLE_NAME || 'Tasks';

if (!API_TOKEN) {
    console.error('ОШИБКА: Не задан SEATABLE_API_TOKEN в переменных окружения');
}

async function getBaseToken() {
    const response = await fetch(`${SEATABLE_URL}/api/v2.1/dtable/app-access-token/`, {
        headers: { 'Authorization': `Bearer ${API_TOKEN}` }
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ошибка получения Base-Token: ${response.status} ${text}`);
    }
    const data = await response.json();
    return { token: data.access_token, uuid: data.dtable_uuid };
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const { token: baseToken, uuid: baseUuid } = await getBaseToken();
        const apiBase = `${SEATABLE_URL}/api-gateway/api/v2/dtables/${baseUuid}/rows/`;
        const authHeader = { 'Authorization': `Bearer ${baseToken}`, 'Content-Type': 'application/json' };

        let url = apiBase;
        let options = { headers: authHeader };
        const action = event.queryStringParameters?.action || (event.body ? JSON.parse(event.body).action : null);
        const body = event.body ? JSON.parse(event.body) : {};

        if (action === 'list') {
            url += `?table_name=${TABLE_NAME}`;
        } else if (action === 'create') {
            options.method = 'POST';
            options.body = JSON.stringify({ table_name: TABLE_NAME, rows: [body.data] });
        } else if (action === 'update') {
            options.method = 'PUT';
            options.body = JSON.stringify({
                table_name: TABLE_NAME,
                row_id: body.rowId,
                row: body.data
            });
        } else if (action === 'delete') {
            options.method = 'DELETE';
            options.body = JSON.stringify({
                table_name: TABLE_NAME,
                row_id: body.rowId
            });
        } else {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Неизвестное действие' }) };
        }

        const response = await fetch(url, options);
        const data = await response.json();
        return { statusCode: response.status, headers, body: JSON.stringify(data) };

    } catch (error) {
        console.error('Ошибка функции:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};