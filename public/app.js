// Load Socket.io from CDN dynamically if not present, but better to add to HTML.
// For now, assuming we add it to index.html or use the one served by the server.
const socket = io();

socket.on('connect', () => {
    console.log('Connected to Real-Time Updates');
});

socket.on('order_new', () => {
    console.log('New order received!');
    fetchStatus();
    if (document.querySelector('.tab-content.active').id === 'vista-ordenes') fetchOrders();
});

socket.on('order_updated', () => {
    console.log('Order updated!');
    fetchStatus();
    if (document.querySelector('.tab-content.active').id === 'vista-ordenes') fetchOrders();
});

socket.on('table_updated', () => {
    console.log('Table status changed!');
    fetchStatus();
    if (document.querySelector('.tab-content.active').id === 'vista-mesas') fetchTables();
});

const API_URL = '/api';

// Simple Login Session with Persistence
let isAuthenticated = false;

function checkAuth() {
    const auth = localStorage.getItem('admin_auth');
    if (auth === 'true') {
        isAuthenticated = true;
        showDashboard();
    }
}

function showDashboard() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    initDashboard();
}

document.getElementById('login-btn').addEventListener('click', () => {
    const pin = document.getElementById('admin-pin').value;
    if (pin === '1234') { // Admin PIN for now
        isAuthenticated = true;
        localStorage.setItem('admin_auth', 'true');
        showDashboard();
    } else {
        document.getElementById('login-err').style.display = 'block';
    }
});

// Logout Helper
function logout() {
    localStorage.removeItem('admin_auth');
    window.location.reload();
}

// Sidebar Navigation
const navItems = document.querySelectorAll('.nav-links li');
const tabContents = document.querySelectorAll('.tab-content');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        // Remove active class
        navItems.forEach(n => n.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        // Add to clicked
        item.classList.add('active');
        const target = item.getAttribute('data-target');
        document.getElementById(target).classList.add('active');

        if (target === 'vista-ordenes') fetchOrders();
        if (target === 'vista-para-llevar') fetchToGoOrders();
        if (target === 'vista-mesas') fetchTables();
        if (target === 'vista-general') fetchStatus();
        if (target === 'vista-personal' || target === 'vista-clientes') fetchUsers();
    });
});

document.getElementById('btn-refresh').addEventListener('click', () => {
    fetchStatus();
});

document.querySelectorAll('.btn-refresh-orders').forEach(btn => {
    btn.addEventListener('click', () => fetchOrders());
});

document.querySelectorAll('.btn-refresh-tables').forEach(btn => {
    btn.addEventListener('click', () => fetchTables());
});

async function initDashboard() {
    fetchStatus();
    fetchOrders();
    fetchTables();
    // No more manual polling needed thanks to WebSockets!
}

// Fetch General Status
async function fetchStatus() {
    try {
        const [statusRes, salesRes] = await Promise.all([
            fetch(`${API_URL}/status`),
            fetch(`${API_URL}/sales`)
        ]);

        const status = await statusRes.json();
        const sales = await salesRes.json();

        document.getElementById('total-ventas').innerText = `$${sales.total.toFixed(2)}`;
        document.getElementById('total-cuentas').innerText = sales.count;

        const avgTicket = sales.count > 0 ? sales.total / sales.count : 0;
        const avgElem = document.getElementById('ticket-promedio');
        if (avgElem) avgElem.innerText = `$${avgTicket.toFixed(2)}`;

        document.getElementById('badge-orders').innerText = status.clientOrders;
        document.getElementById('badge-togo').innerText = status.toGoOrders;
        document.getElementById('badge-tables').innerText = status.activeTables;

        document.getElementById('total-ventas').innerText = `$${sales.total.toFixed(2)}`;
        document.getElementById('total-cuentas').innerText = sales.count;

        // Render Sales History Table
        const tbody = document.getElementById('sales-history-body');
        if (tbody) {
            tbody.innerHTML = '';
            if (sales.history && sales.history.length > 0) {
                sales.history.forEach(sale => {
                    const date = new Date(sale.time);
                    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${timeStr}</td>
                        <td><span class="badge ${sale.location === 'App' ? 'status-cart' : 'status-open'}" style="background: ${sale.location === 'App' ? '#3498db' : '#8e44ad'}">${sale.location}</span></td>
                        <td>${sale.waiter}</td>
                        <td>${sale.closer}</td>
                        <td><small>${sale.method === 'CASH' ? 'Efectivo' : (sale.method === 'CARD' ? 'Tarjeta' : 'Otro')}</small></td>
                        <td class="font-bold">$${sale.total.toFixed(2)}</td>
                        <td>
                            <button class="btn btn-secondary btn-sm" onclick="showTicket('${sale.id}')" title="Ver Ticket">
                                <i class="fas fa-receipt"></i> Ticket
                            </button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay ventas registradas hoy.</td></tr>';
            }
        }
    } catch (e) {
        console.error('Error fetching status', e);
    }
}

// Ticket Modal Functions
let currentTicketId = null;

function showTicket(orderId) {
    currentTicketId = orderId;
    const modal = document.getElementById('ticket-modal');
    const img = document.getElementById('ticket-img');
    const loading = document.getElementById('ticket-loading');

    modal.classList.remove('hidden');
    img.classList.add('hidden');
    loading.classList.remove('hidden');

    img.src = `${API_URL}/ticket/${orderId}`;
    img.onload = () => {
        loading.classList.add('hidden');
        img.classList.remove('hidden');
    };
}

function closeTicketModal() {
    document.getElementById('ticket-modal').classList.add('hidden');
}

function downloadTicket() {
    if (!currentTicketId) return;
    const link = document.createElement('a');
    link.href = `${API_URL}/ticket/${currentTicketId}`;
    link.download = `ticket-${currentTicketId}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function printTicket() {
    const img = document.getElementById('ticket-img');
    if (!img.src) return;

    const win = window.open('', '_blank');
    win.document.write(`
        <html>
            <body style="margin:0; display:flex; justify-content:center;">
                <img src="${img.src}" style="width: 320px;" onload="window.print(); window.close();">
            </body>
        </html>
    `);
}

// Fetch and Render Orders
// Fetch and Render Client Orders
async function fetchOrders() {
    try {
        const res = await fetch(`${API_URL}/orders`);
        const orders = await res.json();
        // Filter orders that are specifically from clients (clientId present, no tableId)
        const clientOrders = orders.filter(o => !o.tableId && o.clientId);
        renderOrdersList(clientOrders, 'orders-container');
    } catch (e) {
        console.error('Error fetching orders', e);
    }
}

// Fetch and Render To Go Orders (Waiters)
async function fetchToGoOrders() {
    try {
        const res = await fetch(`${API_URL}/orders`);
        const orders = await res.json();
        // Filter orders that are To Go from waiters (no tableId, no clientId)
        const toGoOrders = orders.filter(o => !o.tableId && !o.clientId);
        renderOrdersList(toGoOrders, 'togo-container');
    } catch (e) {
        console.error('Error fetching togo orders', e);
    }
}

function renderOrdersList(orders, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (orders.length === 0) {
        container.innerHTML = '<p class="text-muted">No hay cuentas abiertas en este momento.</p>';
        return;
    }

    orders.forEach(order => {
        const isApp = !order.tableId;
        const locName = isApp ? (order.clientId ? 'Pedido Cliente' : 'Para Llevar') : `Mesa ${order.table.number}`;
        const clientName = order.client ? order.client.firstName : (order.user ? order.user.firstName : 'Mesa');

        const orderDisplayId = `${order.client ? order.client.firstName.toUpperCase() : (order.user ? order.user.firstName.toUpperCase() : 'APP')}-${order.pickupCode || 'N/A'}`;

        const card = document.createElement('div');
        card.className = 'card glass-panel';

        let itemsHtml = order.items.map(item => `
            <div class="item-line">
                <span>${item.quantity}x ${item.name}</span>
                <span>$${item.price.toFixed(2)}</span>
            </div>
        `).join('');

        const statusMap = {
            'PENDING_APPROVAL': { text: 'Por Aprobar', class: 'status-pending' },
            'OPEN': { text: 'En Preparación', class: 'status-open' },
            'CLOSED': { text: 'Cerrado', class: 'status-closed' },
            'CART': { text: 'Carrito', class: 'status-cart' }
        };
        const statusInfo = statusMap[order.status] || { text: order.status, class: '' };

        card.innerHTML = `
            <div class="card-header">
                <div>
                    <div class="card-title">${locName}</div>
                    <div class="card-subtitle">ID: <span class="font-bold">${orderDisplayId}</span></div>
                    <div class="card-subtitle">Atiende: ${clientName}</div>
                </div>
                <div class="card-status-container">
                    <span class="badge ${statusInfo.class}">${statusInfo.text}</span>
                    ${order.pickupCode ? `<span class="badge" style="background:#f39c12">PIN: ${order.pickupCode}</span>` : ''}
                </div>
            </div>
            <div class="card-body">
                ${itemsHtml || '<div class="text-muted">Sin productos</div>'}
                <div class="card-total">
                    <span>TOTAL:</span>
                    <span>$${order.total.toFixed(2)}</span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// --- Table Management ---
let isMgmtMode = false;

function toggleMgmtMode() {
    isMgmtMode = document.getElementById('mgmt-mode-toggle').checked;
    document.getElementById('btn-add-table').style.display = isMgmtMode ? 'inline-flex' : 'none';
    fetchTables();
}

async function createTable() {
    try {
        const res = await fetch(`${API_URL}/tables`, { method: 'POST' });
        if (res.ok) {
            fetchTables();
        } else {
            alert('Error al crear la mesa');
        }
    } catch (e) {
        console.error('Error creating table:', e);
    }
}

async function deleteTable(id, number) {
    if (!confirm(`¿Estás seguro de eliminar la Mesa ${number}?`)) return;
    try {
        const res = await fetch(`${API_URL}/tables/${id}`, { method: 'DELETE' });
        if (res.ok) {
            fetchTables();
        } else {
            const err = await res.json();
            alert(err.error || 'Error al eliminar la mesa');
        }
    } catch (e) {
        console.error('Error deleting table:', e);
    }
}

async function toggleTableStatus(id) {
    try {
        const res = await fetch(`${API_URL}/tables/${id}/status`, { method: 'PATCH' });
        if (res.ok) {
            fetchTables();
        } else {
            alert('Error al cambiar estado de la mesa');
        }
    } catch (e) {
        console.error('Error toggling table status:', e);
    }
}

// Fetch and Render Tables
async function fetchTables() {
    try {
        const res = await fetch(`${API_URL}/tables`);
        const tables = await res.json();
        const container = document.getElementById('tables-container');
        container.innerHTML = '';

        tables.forEach(table => {
            const card = document.createElement('div');
            card.className = 'card glass-panel';
            if (table.status === 'AVAILABLE') {
                card.style.opacity = '0.7';
            } else if (table.status === 'BLOCKED') {
                card.style.background = 'rgba(0,0,0,0.05)';
                card.style.opacity = '0.5';
            }

            let infoHtml = '';
            let mgmtHtml = '';

            if (isMgmtMode) {
                mgmtHtml = `
                    <div class="card-mgmt-actions mt-2" style="display:flex; gap:10px; border-top: 1px solid rgba(0,0,0,0.05); padding-top:10px;">
                        <button class="btn btn-sm btn-icon" title="${table.status === 'BLOCKED' ? 'Desbloquear' : 'Bloquear'}" onclick="toggleTableStatus('${table.id}')">
                            <i class="fas ${table.status === 'BLOCKED' ? 'fa-lock-open' : 'fa-lock'}"></i>
                        </button>
                        <button class="btn btn-sm btn-delete" onclick="deleteTable('${table.id}', ${table.number})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            }

            if ((table.status === 'OCCUPIED' || table.status === 'BLOCKED') && table.activeOrder) {
                const waiterList = table.activeOrder.waiters.join(', ');
                const itemsHtml = table.activeOrder.items.map(item => `
                    <div class="item-line">
                        <span>${item.quantity}x ${item.name}</span>
                        <span>$${item.price.toFixed(2)}</span>
                    </div>
                `).join('');

                infoHtml = `
                    <div class="table-info mt-2">
                        <div class="text-muted mb-2"><i class="fas fa-user-tag"></i> ${waiterList}</div>
                        <div class="items-list" style="max-height: 150px; overflow-y: auto;">
                            ${itemsHtml}
                        </div>
                        <div class="card-total mt-2" style="font-size: 1.1em; border-top: 1px solid rgba(0,0,0,0.1); padding-top:10px;">
                            <span>TOTAL:</span>
                            <span>$${table.activeOrder.total.toFixed(2)}</span>
                        </div>
                        ${table.status === 'BLOCKED' ? '<div class="mt-2 text-danger" style="font-size:0.85em; font-weight:bold;"><i class="fas fa-exclamation-triangle"></i> Mesa fuera de servicio (No permite añadir más)</div>' : ''}
                    </div>
                `;
            } else if (table.status === 'BLOCKED') {
                infoHtml = `<p class="text-muted"><i class="fas fa-ban"></i> Mesa Bloqueada / Fuera de Servicio</p>`;
            } else {
                infoHtml = `<p class="text-muted">Mesa disponible para nuevos clientes.</p>`;
            }

            let statusColor = '#2ecc71'; // Available
            let statusText = 'Libre';
            if (table.status === 'OCCUPIED') {
                statusColor = '#e74c3c';
                statusText = 'Ocupada';
            } else if (table.status === 'BLOCKED') {
                statusColor = '#777';
                statusText = 'Bloqueada';
            }

            card.innerHTML = `
                <div class="card-header">
                    <div class="card-title">Mesa ${table.number} ${table.status === 'BLOCKED' ? '<i class="fas fa-lock" style="font-size:0.8em; opacity:0.6;"></i>' : ''}</div>
                    <span class="badge" style="background:${statusColor}">
                        ${statusText}
                    </span>
                </div>
                <div class="card-body">
                    ${infoHtml}
                    ${mgmtHtml}
                </div>
            `;
            container.appendChild(card);
        });
    } catch (e) {
        console.error('Error fetching tables', e);
    }
}

// Fetch and Render Users (Staff and Clients)
async function fetchUsers() {
    try {
        const [usersRes, rolesRes] = await Promise.all([
            fetch(`${API_URL}/users`),
            fetch(`${API_URL}/roles`)
        ]);
        const users = await usersRes.json();
        const roles = await rolesRes.json();

        const staffBody = document.getElementById('staff-table-body');
        const clientsBody = document.getElementById('clients-table-body');

        if (staffBody) staffBody.innerHTML = '';
        if (clientsBody) clientsBody.innerHTML = '';

        users.forEach(user => {
            const dateStr = new Date(user.createdAt).toLocaleDateString();
            const tr = document.createElement('tr');

            if (user.role === 'CLIENTE') {
                if (!clientsBody) return;
                // Render in Clients Table
                tr.innerHTML = `
                    <td>${user.firstName}</td>
                    <td><small class="text-muted">@${user.username || 'N/A'}</small></td>
                    <td>${user.phone || 'N/A'}</td>
                    <td>${dateStr}</td>
                    <td>
                        <div class="td-actions">
                            <button class="btn btn-secondary btn-sm" onclick="changeRole('${user.id}', 'MESERO')" title="Ascender a Mesero">
                                <i class="fas fa-user-tie"></i> Mesero
                            </button>
                            <button class="btn btn-delete btn-sm" onclick="deleteUser('${user.id}')" title="Eliminar Cliente">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                clientsBody.appendChild(tr);
            } else {
                if (!staffBody) return;
                // Render in Staff Table
                const roleBadgeClass = user.role === 'PENDING' ? 'status-pending' : (user.role === 'ADMIN' ? 'status-closed' : 'status-open');
                let roleOptions = roles.map(r => `<option value="${r}" ${user.role === r ? 'selected' : ''}>${r}</option>`).join('');

                tr.innerHTML = `
                    <td>${user.firstName}</td>
                    <td><small class="text-muted">@${user.username || 'N/A'}</small></td>
                    <td><span class="badge ${roleBadgeClass}">${user.role}</span></td>
                    <td>${dateStr}</td>
                    <td>
                        <div class="td-actions">
                            <select class="btn-sm" onchange="changeRole('${user.id}', this.value)" style="padding: 6px; border-radius: 8px; border: 1px solid #ddd; outline: none;">
                                ${roleOptions}
                            </select>
                            ${user.role === 'PENDING' ? `
                                <button class="btn btn-success btn-sm" onclick="changeRole('${user.id}', 'MESERO')" title="Aprobar">
                                    <i class="fas fa-check"></i>
                                </button>
                            ` : ''}
                            <button class="btn btn-delete btn-sm" onclick="deleteUser('${user.id}')" title="Eliminar">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                staffBody.appendChild(tr);
            }
        });
    } catch (e) {
        console.error('Error fetching users', e);
    }
}

async function changeRole(userId, newRole) {
    if (!confirm(`¿Estás seguro de cambiar el rol a ${newRole}?`)) return;

    try {
        const res = await fetch(`${API_URL}/users/${userId}/role`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });

        if (res.ok) {
            fetchUsers();
        } else {
            alert('Error al actualizar el rol');
        }
    } catch (e) {
        console.error('Error updating role', e);
    }
}

async function deleteUser(userId) {
    if (!confirm('¿ESTÁS COMPLETAMENTE SEGURO? Esta acción no se puede deshacer y el usuario perderá acceso al bot.')) return;

    try {
        const res = await fetch(`${API_URL}/users/${userId}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            fetchUsers();
        } else {
            alert('Error al eliminar el usuario');
        }
    } catch (e) {
        console.error('Error deleting user:', e);
    }
}

// Broadcast Messaging

// --- Image Selection & Upload Handling ---
let selectedFile = null;

function handleImageSelect(input) {
    if (input.files && input.files[0]) {
        selectedFile = input.files[0];
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('image-preview').src = e.target.result;
            document.getElementById('image-preview-container').style.display = 'block';
            document.querySelector('.upload-container').style.display = 'none';
        }
        reader.readAsDataURL(selectedFile);
    }
}

function clearImageSelection() {
    selectedFile = null;
    document.getElementById('broadcast-file').value = '';
    document.getElementById('image-preview-container').style.display = 'none';
    document.querySelector('.upload-container').style.display = 'block';
    document.getElementById('image-preview').src = '';
}

// Broadcast Messaging
async function sendBroadcast() {
    const msgInput = document.getElementById('broadcast-msg');
    const imgUrlInput = document.getElementById('broadcast-img-url');
    const statusText = document.getElementById('broadcast-status');
    const sendBtn = document.getElementById('broadcast-send-btn');
    const message = msgInput.value.trim();

    if (!message) {
        alert('Por favor escribe un mensaje.');
        return;
    }

    if (!confirm(`¿Estás seguro de enviar este mensaje a TODOS los clientes?`)) return;

    try {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        statusText.innerText = 'Preparando envío...';

        let imageUrl = imgUrlInput ? imgUrlInput.value.trim() : '';

        // If a file is selected, upload it first
        if (selectedFile) {
            statusText.innerText = 'Subiendo imagen...';
            const formData = new FormData();
            formData.append('image', selectedFile);

            const uploadRes = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                body: formData
            });

            if (uploadRes.ok) {
                const uploadData = await uploadRes.json();
                imageUrl = uploadData.imageUrl;
            } else {
                throw new Error('Error al subir la imagen');
            }
        }

        statusText.innerText = 'Iniciando envío masivo...';
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

        const res = await fetch(`${API_URL}/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, imageUrl })
        });

        const result = await res.json();

        if (res.ok) {
            alert(`¡Envío completado!\n\nExitosos: ${result.sent}\nFallidos: ${result.failed}`);
            msgInput.value = '';
            if (imgUrlInput) imgUrlInput.value = '';
            clearImageSelection();
            statusText.innerText = `Último envío: ${result.sent} entregados.`;
        } else {
            alert('Error al procesar el mensaje masivo.');
            statusText.innerText = 'Error en el último intento.';
        }
    } catch (e) {
        console.error('Broadcast error:', e);
        alert(e.message || 'Error de conexión.');
        statusText.innerText = 'Error en el envío.';
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar a Clientes';
    }
}

// Check session on load
checkAuth();

// Initialize users fetch for both tabs
const btnStaff = document.querySelector('[data-target="vista-personal"]');
const btnClients = document.querySelector('[data-target="vista-clientes"]');
if (btnStaff) btnStaff.addEventListener('click', fetchUsers);
if (btnClients) btnClients.addEventListener('click', fetchUsers);
