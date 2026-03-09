import { Telegraf, Markup } from 'telegraf';
import { prisma } from './db';
import * as dotenv from 'dotenv';
import nodeHtmlToImage from 'node-html-to-image';
import { Parser } from 'json2csv';
import multer from 'multer';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

// Basic Error Handling
// Basic Error Handling
const productAddState = new Set<number>(); // For tracking admin adding products
const orderAddState = new Map<number, { orderId: string, tableNumber?: number }>(); // For tracking active order
const configEditState = new Map<number, 'LOGO' | 'LOCATION' | 'MESSAGE'>(); // For editing ticket config
const clientRegState = new Map<number, { step: 'NAME' | 'PHONE', name?: string }>(); // For tracking client name and phone number registration
const waiterPickupCodeState = new Map<number, { orderId: string, paymentMethod: 'CASH' | 'CARD' }>(); // For waiter checkout validation
const exportDateState = new Set<number>(); // For tracking users providing a date for CSV export
const expenseState = new Map<number, { step: 'DESCRIPTION' | 'AMOUNT', description?: string }>(); // For tracking expense registration
const waiterClientSearchState = new Map<number, { orderId: string }>(); // For waiters searching for clients

// Reusable Admin Keyboard

function getAdminKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👥 Gestión de Roles', callback_data: 'admin_roles' }],
            [{ text: '👥 Gestión de Clientes', callback_data: 'admin_clientes' }],
            [{ text: '🪑 Gestión de Mesas', callback_data: 'admin_mesas' }],
            [{ text: '🍔 Gestión de Menú', callback_data: 'admin_menu' }],
            [{ text: '🧾 Cuentas Abiertas', callback_data: 'admin_cuentas' }],
            [{ text: '📊 Finanzas', callback_data: 'admin_finanzas' }],
            [{ text: '🖨️ Configuración del Ticket', callback_data: 'admin_config' }]
        ]
    };
}

// Utility function to escape MarkdownV2
function escapeMarkdownV2(text: string | number): string {
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// Main Reply Keyboard

function getMainKeyboard(role: string) {
    const buttons: string[][] = [];
    if (role === 'ADMIN') {
        buttons.push(['📝 Nueva Orden / Ver Mesa', '🥡 Para Llevar']);
        buttons.push(['🛎️ Pedidos de Clientes']);
        buttons.push(['🧾 Cuentas Abiertas', '⚙️ Panel de Administración', '📊 Reporte de Ventas']);
    } else if (role === 'MESERO') {
        buttons.push(['📝 Nueva Orden / Ver Mesa', '🥡 Para Llevar']);
        buttons.push(['🛎️ Pedidos de Clientes', '🧾 Cuentas Abiertas']);
    } else if (role === 'CONTADOR') {
        buttons.push(['📊 Reporte de Ventas']);
    } else if (role === 'CLIENTE') {
        buttons.push(['🛍️ Hacer Pedido']);
        buttons.push(['📋 Mis Pedidos', '📖 Ver Menú']);
    }
    buttons.push(['❓ Ayuda', '🚪 Salir']);

    return {
        reply_markup: {
            keyboard: buttons,
            resize_keyboard: true
        }
    };
}

// Generate Ticket Image Function
async function generateTicketImage(order: any, config: any): Promise<Buffer> {
    const itemsHtml = order.items.map((item: any) => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>${item.quantity}x ${item.name}</span>
            <span>$${item.price.toFixed(2)}</span>
        </div>
    `).join('');

    const html = `
        <html>
            <head>
                <style>
                    body {
                        font-family: 'Courier New', Courier, monospace;
                        width: 320px;
                        padding: 20px;
                        background: white;
                        color: black;
                        margin: 0;
                    }
                    .text-center { text-align: center; }
                    .font-bold { font-weight: bold; }
                    .divider { border-bottom: 1px dashed black; margin: 10px 0; }
                    .logo { max-width: 150px; display: block; margin: 0 auto 10px auto; }
                </style>
            </head>
            <body>
                ${config.logoUrl ? `<img src="${config.logoUrl}" class="logo" />` : ''}
                <div class="text-center font-bold" style="font-size: 1.2em;">TICKET DE VENTA</div>
                ${config.locationText ? `<div class="text-center" style="font-size: 0.9em; margin-bottom: 10px;">${config.locationText}</div>` : ''}
                
                <div class="divider"></div>
                <div style="margin-bottom: 5px;">${order.table ? `Mesa: ${order.table.number}` : '<span style="background:black; color:white; padding: 2px 5px;">PARA LLEVAR</span>'}</div>
                <div style="margin-bottom: 10px;">ID Orden: ${order.client ? order.client.firstName.toUpperCase() : (order.user ? order.user.firstName.toUpperCase() : 'APP')}-${order.pickupCode || 'N/A'}</div>
                
                <div class="divider"></div>
                <div style="font-size: 0.9em;">
                    ${itemsHtml}
                </div>
                
                <div class="divider"></div>
                <div style="display: flex; justify-content: space-between; font-size: 1.1em;" class="font-bold">
                    <span>TOTAL:</span>
                    <span>$${order.total.toFixed(2)}</span>
                </div>
                <div style="font-size: 0.9em; margin-top: 5px;">Pago: ${order.paymentMethod === 'CASH' ? 'Efectivo' : 'Tarjeta'}</div>
                
                <div class="divider"></div>
                <div class="text-center" style="font-size: 0.9em; margin-top: 15px;">
                    ${config.thankYouMessage || '¡Gracias por su compra!'}
                </div>
            </body>
        </html>
    `;

    return (await nodeHtmlToImage({
        html: html,
        puppeteerArgs: {
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    })) as Buffer;
}

bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username ?? null;
    const firstName = ctx.from.first_name;

    try {
        let user = await prisma.user.findUnique({ where: { telegramId } });

        if (!user) {
            // Check if it's the first user ever
            const totalUsers = await prisma.user.count();
            const isFirst = totalUsers === 0;

            if (isFirst) {
                user = await prisma.user.create({
                    data: {
                        telegramId,
                        username,
                        firstName,
                        role: 'ADMIN' // Always ADMIN for the first user
                    }
                });
                await ctx.reply(`¡Hola ${firstName}! Has sido registrado como ADMIN del sistema. Usa los botones de abajo o /help.`, getMainKeyboard('ADMIN'));
            } else {
                // If not first user, ask them who they are, don't create user until they select
                await ctx.reply(`¡Bienvenido ${firstName}! ¿Cómo deseas registrarte?`,
                    Markup.keyboard([
                        ['🌮 Soy Cliente', '💼 Soy Empleado']
                    ]).oneTime().resize()
                );
            }
        } else {
            console.log('DEBUG KEYBOARD:', JSON.stringify(getMainKeyboard(user.role)));
            await ctx.reply(`¡Hola de nuevo, ${firstName}! (Bot v1.0.5) Tu rol actual es: ${user.role}`, getMainKeyboard(user.role));
        }
    } catch (error) {
        console.error(error);
        await ctx.reply('Ocurrió un error al procesar tu solicitud.');
    }
});

// Registration Handlers
bot.hears('🌮 Soy Cliente', async (ctx) => {
    const telegramId = ctx.from.id;
    clientRegState.set(telegramId, { step: 'NAME' });
    await ctx.reply('¡Excelente! Por favor, envíame tu **Nombre Completo**:', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
    });
});

bot.hears('💼 Soy Empleado', async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username ?? null;
    const firstName = ctx.from.first_name;

    try {
        const user = await prisma.user.upsert({
            where: { telegramId },
            update: { username, firstName, role: 'PENDING' },
            create: { telegramId, username, firstName, role: 'PENDING' }
        });

        await ctx.reply('Tu cuenta está en estado PENDIENTE. Un administrador debe aprobarte.', Markup.removeKeyboard());

        // Notify Admins
        const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
        const adminKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Aprobar como Mesero', `approve_mesero_${user.id}`)],
            [Markup.button.callback('Aprobar como Contador', `approve_contador_${user.id}`)],
            [Markup.button.callback('Rechazar', `reject_${user.id}`)]
        ]);

        for (const admin of admins) {
            try {
                await ctx.telegram.sendMessage(
                    Number(admin.telegramId),
                    `Nuevo empleado quiere registrarse:\nNombre: ${firstName}\nUsername: @${username || 'N/A'}\nTelegram ID: ${telegramId}\n\n¿Qué rol deseas asignarle?`,
                    adminKeyboard
                );
            } catch (e) {
                console.error(`Could not notify admin ${admin.telegramId}`);
            }
        }
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al registrar tu cuenta.');
    }
});

bot.action(/approve_mesero_(.+)/, async (ctx) => {
    const targetUserId = ctx.match[1];
    try {
        const updatedUser = await prisma.user.update({
            where: { id: targetUserId },
            data: { role: 'MESERO' }
        });
        await ctx.editMessageText(`Usuario ${updatedUser.firstName} (@${updatedUser.username}) ha sido asignado como MESERO.`);
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), '¡Felicidades! Un administrador te ha asignado el rol de MESERO. Ya puedes usar los botones correspondientes.', getMainKeyboard('MESERO'));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al asignar el rol.');
    }
});

bot.action(/approve_contador_(.+)/, async (ctx) => {
    const targetUserId = ctx.match[1];
    try {
        const updatedUser = await prisma.user.update({
            where: { id: targetUserId },
            data: { role: 'CONTADOR' }
        });
        await ctx.editMessageText(`Usuario ${updatedUser.firstName} (@${updatedUser.username}) ha sido asignado como CONTADOR.`);
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), '¡Felicidades! Un administrador te ha asignado el rol de CONTADOR. Ya puedes usar los botones correspondientes.', getMainKeyboard('CONTADOR'));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al asignar el rol.');
    }
});

bot.action(/reject_(.+)/, async (ctx) => {
    const targetUserId = ctx.match[1];
    try {
        const updatedUser = await prisma.user.update({
            where: { id: targetUserId },
            data: { role: 'REJECTED' }
        });
        await ctx.editMessageText(`Usuario ${updatedUser.firstName} (@${updatedUser.username}) ha sido RECHAZADO.`);
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), 'Lo sentimos, tu solicitud ha sido rechazada por el administrador.', Markup.removeKeyboard());
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al rechazar usuario.');
    }
});

// Import middleware
import { requireRole } from './middleware';

// Restricted commands
bot.command('admin_panel', requireRole(['ADMIN']), async (ctx) => {
    await ctx.reply('⚙️ *Panel de Administración*\nSelecciona una opción:', { parse_mode: 'MarkdownV2', reply_markup: getAdminKeyboard() });
});

// Admin Panel Callbacks
bot.action('admin_roles', async (ctx) => {
    try {
        const users = await prisma.user.findMany({ where: { role: { notIn: ['ADMIN', 'CLIENTE'] } } });
        if (users.length === 0) {
            await ctx.editMessageText('No hay usuarios para gestionar.');
            return;
        }

        const buttons = users.map(u => [Markup.button.callback(`${u.firstName} - ${u.role}`, `manage_user_${u.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);

        await ctx.editMessageText('Selecciona un usuario para gestionar su rol:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar roles');
    }
});

bot.action(/manage_user_(.+)/, async (ctx) => {
    const userId = ctx.match[1];
    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return ctx.answerCbQuery('Usuario no encontrado');

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Asignar MESERO', `set_role_MESERO_${userId}`)],
            [Markup.button.callback('Asignar CONTADOR', `set_role_CONTADOR_${userId}`)],
            [Markup.button.callback('RECHAZAR', `set_role_REJECTED_${userId}`)],
            [Markup.button.callback('⬅️ Volver', 'admin_roles')]
        ]);
        await ctx.editMessageText(`Gestionando a ${user.firstName} (Rol actual: ${user.role})`, keyboard);
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar usuario');
    }
});

bot.action(/set_role_(.+)_(.+)/, async (ctx) => {
    const newRole = ctx.match[1] as any;
    const userId = ctx.match[2];
    try {
        await prisma.user.update({ where: { id: userId }, data: { role: newRole } });
        await ctx.answerCbQuery(`Rol de usuario actualizado a ${newRole}`);

        // Return to roles menu
        const users = await prisma.user.findMany({ where: { role: { notIn: ['ADMIN', 'CLIENTE'] } } });
        const buttons = users.map(u => [Markup.button.callback(`${u.firstName} - ${u.role}`, `manage_user_${u.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);

        await ctx.editMessageText('Rol actualizado. Selecciona un usuario para gestionar:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al actualizar el rol');
    }
});

bot.action('admin_panel_back', async (ctx) => {
    productAddState.delete(ctx.from.id);
    await ctx.editMessageText('⚙️ *Panel de Administración*\nSelecciona una opción:', { parse_mode: 'MarkdownV2', reply_markup: getAdminKeyboard() });
});

bot.action('admin_clientes', async (ctx) => {
    try {
        const clients = await prisma.user.findMany({ where: { role: 'CLIENTE' }, orderBy: { firstName: 'asc' } });
        if (clients.length === 0) {
            await ctx.editMessageText('No hay clientes registrados.', Markup.inlineKeyboard([
                [Markup.button.callback('⬅️ Volver', 'admin_panel_back')]
            ]));
            return;
        }

        const buttons = clients.map(c => [Markup.button.callback(`👤 ${c.firstName} (${c.phone || 'Sin tel'})`, `admin_view_client_${c.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);

        await ctx.editMessageText('👥 *Gestión de Clientes*\nSelecciona un cliente para ver más detalles:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar clientes');
    }
});

bot.action(/admin_view_client_(.+)/, async (ctx) => {
    const clientId = ctx.match[1];
    try {
        const client = await prisma.user.findUnique({
            where: { id: clientId },
            include: { clientOrders: { where: { status: 'CLOSED' } } }
        });

        if (!client) return ctx.answerCbQuery('Cliente no encontrado');

        const totalOrders = client.clientOrders.length;
        const totalSpent = client.clientOrders.reduce((acc, sum) => acc + sum.total, 0);

        let msg = `👤 *Detalles del Cliente*\n\n`;
        msg += `*Nombre:* ${escapeMarkdownV2(client.firstName)}\n`;
        msg += `*Teléfono:* ${client.phone ? escapeMarkdownV2(client.phone) : 'No registrado'}\n`;
        msg += `*Username:* ${client.username ? '@' + escapeMarkdownV2(client.username) : 'No registrado'}\n`;
        msg += `*Registro:* ${escapeMarkdownV2(client.createdAt.toLocaleDateString())}\n\n`;
        msg += `*Historial:* ${totalOrders} pedidos cerrados\n`;
        msg += `*Gasto Total:* \\$${escapeMarkdownV2(totalSpent.toFixed(2))}`;

        const buttons = [
            [Markup.button.callback('⬇️ Descargar Historial (CSV)', `export_client_csv_${client.id}`)],
            [Markup.button.callback('❌ Eliminar Cliente', `delete_client_${client.id}`)],
            [Markup.button.callback('⬅️ Volver a Lista', 'admin_clientes')]
        ];

        await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar cliente');
    }
});

bot.action(/export_client_csv_(.+)/, async (ctx) => {
    const clientId = ctx.match[1];
    try {
        const client = await prisma.user.findUnique({
            where: { id: clientId },
            include: {
                clientOrders: {
                    where: { status: 'CLOSED' },
                    include: { items: true, table: true }
                }
            }
        });

        if (!client) return ctx.answerCbQuery('Cliente no encontrado');
        if (client.clientOrders.length === 0) return ctx.answerCbQuery('Este cliente no tiene historial de pedidos.', { show_alert: true });

        const rows: any[] = [];
        for (const order of client.clientOrders) {
            rows.push({
                'Fecha': order.closedAt ? order.closedAt.toLocaleDateString() : 'N/A',
                'Mesa': order.table ? order.table.number : 'App',
                'Total': order.total.toFixed(2),
                'Metodo Pago': order.paymentMethod === 'CASH' ? 'Efectivo' : 'Tarjeta',
                'Productos': order.items.map(i => `${i.quantity}x ${i.name}`).join(' | ')
            });
        }

        const parser = new Parser({ fields: ['Fecha', 'Mesa', 'Total', 'Metodo Pago', 'Productos'] });
        const csv = parser.parse(rows);
        const buffer = Buffer.from(csv, 'utf-8');

        await ctx.telegram.sendDocument(ctx.from.id, {
            source: buffer,
            filename: `historial_${client.firstName.replace(/ /g, '_')}.csv`
        });
        await ctx.answerCbQuery('Archivo enviado por mensaje directo.');

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al exportar historial.');
    }
});

bot.action(/delete_client_(.+)/, async (ctx) => {
    const clientId = ctx.match[1];
    try {
        await prisma.user.delete({ where: { id: clientId } });
        await ctx.answerCbQuery('Cliente eliminado exitosamente', { show_alert: true });

        // Refresh list
        const clients = await prisma.user.findMany({ where: { role: 'CLIENTE' }, orderBy: { firstName: 'asc' } });
        if (clients.length === 0) {
            await ctx.editMessageText('No hay clientes registrados.', Markup.inlineKeyboard([
                [Markup.button.callback('⬅️ Volver', 'admin_panel_back')]
            ]));
            return;
        }
        const buttons = clients.map(c => [Markup.button.callback(`❌ Eliminar: ${c.firstName} (${c.phone || 'Sin tel'})`, `delete_client_${c.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);

        await ctx.editMessageText('👥 *Gestión de Clientes*\nSelecciona un cliente para eliminar su registro:', { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al eliminar cliente.');
    }
});

bot.action('admin_mesas', async (ctx) => {
    try {
        const tables = await prisma.table.findMany({ orderBy: { number: 'asc' } });
        const buttons = tables.map(t => [Markup.button.callback(`Mesa ${t.number} - ${t.status}`, `manage_mesa_${t.id}`)]);
        buttons.push([Markup.button.callback('➕ Añadir Mesa', 'add_mesa')]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);

        await ctx.editMessageText('Gestión de Mesas:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar mesas');
    }
});

bot.action('add_mesa', async (ctx) => {
    try {
        const tables = await prisma.table.findMany({ orderBy: { number: 'desc' }, take: 1 });
        const nextNumber = tables.length > 0 ? tables[0].number + 1 : 1;
        await prisma.table.create({ data: { number: nextNumber } });
        await ctx.answerCbQuery(`Mesa ${nextNumber} añadida.`);

        // Reload mesas
        const allTables = await prisma.table.findMany({ orderBy: { number: 'asc' } });
        const buttons = allTables.map(t => [Markup.button.callback(`Mesa ${t.number} - ${t.status}`, `manage_mesa_${t.id}`)]);
        buttons.push([Markup.button.callback('➕ Añadir Mesa', 'add_mesa')]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);
        await ctx.editMessageText('Gestión de Mesas:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al añadir mesa');
    }
});

bot.action(/manage_mesa_(.+)/, async (ctx) => {
    const tableId = ctx.match[1];
    try {
        const table = await prisma.table.findUnique({ where: { id: tableId } });
        if (!table) return ctx.answerCbQuery('Mesa no encontrada');
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('❌ Eliminar Mesa', `delete_mesa_${tableId}`)],
            [Markup.button.callback('⬅️ Volver', 'admin_mesas')]
        ]);
        await ctx.editMessageText(`Gestionando Mesa ${table.number}\nEstado actual: ${table.status}`, keyboard);
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar mesa');
    }
});

bot.action(/delete_mesa_(.+)/, async (ctx) => {
    const tableId = ctx.match[1];
    try {
        await prisma.table.delete({ where: { id: tableId } });
        await ctx.answerCbQuery('Mesa eliminada correctamente');

        // Reload mesas
        const allTables = await prisma.table.findMany({ orderBy: { number: 'asc' } });
        const buttons = allTables.map(t => [Markup.button.callback(`Mesa ${t.number} - ${t.status}`, `manage_mesa_${t.id}`)]);
        buttons.push([Markup.button.callback('➕ Añadir Mesa', 'add_mesa')]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);
        await ctx.editMessageText('Gestión de Mesas:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        // Usually fails if there are linked orders to this table
        await ctx.answerCbQuery('Error: No se puede eliminar si tiene historial de cuentas.');
    }
});

bot.action('admin_cuentas', async (ctx) => {
    try {
        const openOrders = await prisma.order.findMany({
            where: { status: 'OPEN' },
            include: { table: true, user: true, client: true }
        });

        const userRole = await prisma.user.findUnique({ where: { telegramId: ctx.from.id } });
        if (openOrders.length === 0) {
            const btns = userRole?.role === 'ADMIN' ? [[Markup.button.callback('⬅️ Volver', 'admin_panel_back')]] : [];
            await ctx.editMessageText('No hay cuentas abiertas actualmente.', Markup.inlineKeyboard(btns));
            return;
        }

        const buttons = openOrders.map(o => {
            const loc = o.table ? `Mesa ${o.table.number}` : 'App';
            const orderDisplayId = `${o.client ? o.client.firstName.toUpperCase() : (o.user ? o.user.firstName.toUpperCase() : 'APP')}-${o.pickupCode || 'N/A'}`;
            return [Markup.button.callback(`${loc} - ${orderDisplayId} ($${o.total.toFixed(2)})`, `view_order_${o.id}`)];
        });
        if (userRole?.role === 'ADMIN') {
            buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);
        }
        await ctx.editMessageText('🧾 *Cuentas Abiertas:*', {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar cuentas');
    }
});

bot.action(/view_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true, table: true, user: true, client: true }
        });

        if (!order) return ctx.answerCbQuery('Cuenta no encontrada');

        const loc = order.table ? `Mesa ${escapeMarkdownV2(order.table.number)}` : 'App';
        const per = order.user ? escapeMarkdownV2(order.user.firstName) : (order.client ? escapeMarkdownV2(order.client.firstName) : 'App');
        let msg = `🧾 *Cuenta ${loc}*\nAbierta por: ${per}\n\n*Productos:*\n`;

        if (order.items.length === 0) {
            msg += '\\- Ninguno aún\n';
        } else {
            order.items.forEach(item => {
                const itemName = escapeMarkdownV2(item.name);
                msg += `\\- ${itemName} x${item.quantity} \\(\\$${escapeMarkdownV2(item.price.toFixed(2))}\\)\n`;
            });
        }
        msg += `\n*TOTAL:* \\$${escapeMarkdownV2(order.total.toFixed(2))}`;

        const inlineKeyboard: any[] = [
            [Markup.button.callback('➕ Agregar Productos', `add_items_${order.id}`)],
            [Markup.button.callback('✏️ Editar Cuenta (Eliminar)', `edit_order_${order.id}`)]
        ];

        // Specific button for App pickup orders to notify the client
        if (!order.tableId && order.clientId) {
            inlineKeyboard.push([Markup.button.callback('🔔 Notificar Listo a Cliente', `notify_ready_${order.id}`)]);
        }

        inlineKeyboard.push([Markup.button.callback('❌ Cerrar Cuenta (Cobrar)', `close_order_${order.id}`)]);
        inlineKeyboard.push([Markup.button.callback('⬅️ Volver a Cuentas', `admin_cuentas`)]);

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar la cuenta');
    }
});

bot.action(/notify_ready_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { client: true }
        });

        if (!order || !order.client || !order.client.telegramId) {
            return ctx.answerCbQuery('No se encontró al cliente para notificarle.');
        }

        const msgBody = order.pickupCode
            ? `🔔 *¡Tu pedido está listo\\!*\nPor favor, pasa a recogerlo y proporciona este PIN de seguridad al cajero:\n\n*PIN:* \`${order.pickupCode}\``
            : `🔔 *¡Tu pedido está listo\\!*\nPor favor, pasa a recogerlo\\.`;

        await ctx.telegram.sendMessage(
            Number(order.client.telegramId),
            msgBody,
            { parse_mode: 'MarkdownV2' }
        );

        await ctx.answerCbQuery('Notificación enviada exitosamente.');
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al enviar notificación');
    }
});

// Menu Management
bot.action('admin_menu', async (ctx) => {
    productAddState.delete(ctx.from.id);
    try {
        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        const buttons = products.map(p => [Markup.button.callback(`${p.name} - $${p.price.toFixed(2)}`, `manage_product_${p.id}`)]);
        buttons.push([Markup.button.callback('➕ Añadir Producto', 'add_product')]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);

        await ctx.editMessageText('🍔 Gestión de Menú:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar menú');
    }
});

bot.action('add_product', async (ctx) => {
    productAddState.add(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply('✍️ Escribe el nombre del nuevo producto y su precio.\nFormato: Nombre - Precio\nEjemplo: Torta de asada - 80\n(Envía la palabra "cancelar" para detener)');
});

bot.action(/manage_product_(.+)/, async (ctx) => {
    const productId = ctx.match[1];
    try {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.answerCbQuery('Producto no encontrado');

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('❌ Eliminar Producto', `delete_product_${productId}`)],
            [Markup.button.callback('⬅️ Volver al menú', 'admin_menu')]
        ]);
        await ctx.editMessageText(`Gestionando: ${product.name}\nPrecio: $${product.price.toFixed(2)}\n\n(Para editar, elimínalo y créalo de nuevo por ahora)`, keyboard);
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar producto');
    }
});

bot.action(/delete_product_(.+)/, async (ctx) => {
    const productId = ctx.match[1];
    try {
        await prisma.product.delete({ where: { id: productId } });
        await ctx.answerCbQuery('Producto eliminado');

        // Reload Menu
        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        const buttons = products.map(p => [Markup.button.callback(`${p.name} - $${p.price.toFixed(2)}`, `manage_product_${p.id}`)]);
        buttons.push([Markup.button.callback('➕ Añadir Producto', 'add_product')]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);
        await ctx.editMessageText('🍔 Gestión de Menú:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al eliminar producto');
    }
});


// FinanceSection
bot.action('admin_finanzas', async (ctx) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const closedOrders = await prisma.order.findMany({
            where: { status: 'CLOSED', closedAt: { gte: today } }
        });

        const expenses = await prisma.expense.findMany({
            where: { createdAt: { gte: today } }
        });

        const totalIncome = closedOrders.reduce((acc: number, curr) => acc + curr.total, 0);
        const totalExpenses = expenses.reduce((acc: number, curr) => acc + curr.amount, 0);
        const netBalance = totalIncome - totalExpenses;

        const msg = `📊 *Resumen Financiero (Hoy)*\n\n` +
            `💰 *Ventas Totales:* $${escapeMarkdownV2(totalIncome.toFixed(2))}\n` +
            `💸 *Gastos Totales:* $${escapeMarkdownV2(totalExpenses.toFixed(2))}\n` +
            `📈 *Balance Neto:* $${escapeMarkdownV2(netBalance.toFixed(2))}\n\n` +
            `_Selecciona una opción:_`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('➕ Registrar Gasto', 'admin_add_expense')],
            [Markup.button.callback('📋 Ver Gastos de Hoy', 'admin_view_expenses')],
            [Markup.button.callback('⬅️ Volver', 'admin_panel_back')]
        ]);

        await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...keyboard });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar finanzas');
    }
});

bot.action('admin_add_expense', async (ctx) => {
    expenseState.set(ctx.from.id, { step: 'DESCRIPTION' });
    await ctx.editMessageText('📝 *Registro de Gasto*\nPor favor, escribe una descripción para el gasto (ej. Compra de aguacate):', { parse_mode: 'MarkdownV2' });
});

bot.action('admin_view_expenses', async (ctx) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expenses = await prisma.expense.findMany({
            where: { createdAt: { gte: today } },
            orderBy: { createdAt: 'desc' }
        });

        if (expenses.length === 0) {
            return ctx.answerCbQuery('No hay gastos registrados hoy.', { show_alert: true });
        }

        let msg = `📋 *Gastos de Hoy:*\n\n`;
        for (const exp of expenses) {
            msg += `\\- ${escapeMarkdownV2(exp.description)}: \\$${escapeMarkdownV2(exp.amount.toFixed(2))}\n`;
        }

        const keyboard = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'admin_finanzas')]]);
        await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...keyboard });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar gastos');
    }
});

// Admin Configuration
bot.action('admin_config', async (ctx) => {
    try {
        const config = await prisma.restaurantConfig.upsert({
            where: { id: 1 },
            update: {},
            create: {}
        });

        const logo = config.logoUrl || 'No definido';
        const loc = config.locationText || 'No definido';
        const msg = config.thankYouMessage || 'No definido';

        await ctx.editMessageText(`🖨️ *Configuración del Ticket*\n\n*Logo URL:* ${escapeMarkdownV2(logo)}\n*Slogan/Ubicación:* ${escapeMarkdownV2(loc)}\n*Mensaje:* ${escapeMarkdownV2(msg)}`, {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✏️ Editar Logo', 'edit_config_logo')],
                [Markup.button.callback('✏️ Editar Ubicación', 'edit_config_loc')],
                [Markup.button.callback('✏️ Editar Mensaje', 'edit_config_msg')],
                [Markup.button.callback('⬅️ Volver', 'admin_panel_back')]
            ])
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar configuración');
    }
});

bot.action('edit_config_logo', async (ctx) => {
    configEditState.set(ctx.from.id, 'LOGO');
    await ctx.answerCbQuery();
    await ctx.reply('Envíame la URL de la imagen del Logo (Ej. https://mi-dominio.com/logo.png o escribe "cancelar").');
});

bot.action('edit_config_loc', async (ctx) => {
    configEditState.set(ctx.from.id, 'LOCATION');
    await ctx.answerCbQuery();
    await ctx.reply('Envíame la ubicación, eslogan o encabezado del ticket (escribe "cancelar").');
});

bot.action('edit_config_msg', async (ctx) => {
    configEditState.set(ctx.from.id, 'MESSAGE');
    await ctx.answerCbQuery();
    await ctx.reply('Envíame el mensaje de agradecimiento para el ticket (escribe "cancelar").');
});

async function handleSalesReport(ctx: any) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const closedOrders = await prisma.order.findMany({
            where: {
                status: 'CLOSED',
                closedAt: { gte: today }
            },
            include: {
                user: true,
                closedBy: true,
                table: true,
                client: true
            },
            orderBy: {
                closedAt: 'asc'
            }
        });

        const totalCash = closedOrders.filter(o => o.paymentMethod === 'CASH').reduce((acc, curr) => acc + curr.total, 0);
        const totalCard = closedOrders.filter(o => o.paymentMethod === 'CARD').reduce((acc, curr) => acc + curr.total, 0);
        const total = totalCash + totalCard;

        let reportMessage = `📊 *Reporte de Ventas \\(Hoy\\)*\n\n`;

        if (closedOrders.length > 0) {
            reportMessage += `*Desglose de Tickets:*\n`;
            for (const order of closedOrders) {
                const timeStr = order.closedAt ? order.closedAt.toTimeString().split(' ')[0] : 'N/A';
                const openBy = order.client ? `Cliente: ${escapeMarkdownV2(order.client.firstName)}` : (order.user ? `Mesero: ${escapeMarkdownV2(order.user.firstName)}` : 'App');
                const closeName = order.closedBy ? escapeMarkdownV2(order.closedBy.firstName) : 'N/A';
                const methodStr = order.paymentMethod === 'CASH' ? 'Efectivo' : 'Tarjeta';
                const locStr = order.table ? `Mesa ${escapeMarkdownV2(order.table.number)}` : 'App';

                reportMessage += `\\- ${locStr} \\| \\$${escapeMarkdownV2(order.total.toFixed(2))} \\(${methodStr}\\)\n`;
                reportMessage += `  🕒 ${escapeMarkdownV2(timeStr)} \\| Abrió: ${openBy} \\| Cobró: ${closeName}\n\n`;
            }
        }

        reportMessage += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\n`;
        reportMessage += `💵 *Total Efectivo:* \\$${escapeMarkdownV2(totalCash.toFixed(2))}\n`;
        reportMessage += `💳 *Total Tarjeta:* \\$${escapeMarkdownV2(totalCard.toFixed(2))}\n`;
        reportMessage += `💰 *Gran Total:* \\$${escapeMarkdownV2(total.toFixed(2))}\n\n`;
        reportMessage += `_Total de cuentas cerradas:_ ${closedOrders.length}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('⬇️ Exportar CSV', 'export_sales_csv')]
        ]);

        await ctx.replyWithMarkdownV2(reportMessage, keyboard);
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al generar el reporte de ventas.');
    }
}

bot.command('sales_report', requireRole(['ADMIN', 'CONTADOR']), handleSalesReport);
bot.hears('📊 Reporte de Ventas', requireRole(['ADMIN', 'CONTADOR']), handleSalesReport);

async function generateAndSendSalesCSV(ctx: any, date: Date) {
    try {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const closedOrders = await prisma.order.findMany({
            where: {
                status: 'CLOSED',
                closedAt: { gte: startOfDay, lte: endOfDay }
            },
            include: {
                user: true,
                closedBy: true,
                table: true,
                client: true
            },
            orderBy: {
                closedAt: 'asc'
            }
        });

        if (closedOrders.length === 0) {
            const dateStr = startOfDay.toLocaleDateString();
            if (ctx.answerCbQuery) await ctx.answerCbQuery(`No hay ventas el ${dateStr} para exportar.`, { show_alert: true });
            else await ctx.reply(`No hay ventas el ${dateStr} para exportar.`);
            return;
        }

        let csvData = 'ID Orden,Mesa,Total,Metodo Pago,Fecha Cierre,Hora Cierre,Abierta Por,Cobrada Por\n';
        for (const order of closedOrders) {
            const dateStr = order.closedAt ? order.closedAt.toISOString().split('T')[0] : 'N/A';
            const timeStr = order.closedAt ? order.closedAt.toTimeString().split(' ')[0] : 'N/A';
            const openName = order.client ? `Cliente: ${order.client.firstName}` : (order.user ? `Mesero: ${order.user.firstName}` : 'App');
            const closeName = order.closedBy ? order.closedBy.firstName : 'N/A';
            const methodStr = order.paymentMethod === 'CASH' ? 'Efectivo' : 'Tarjeta';
            const tableNum = order.table ? order.table.number : 'App';

            csvData += `"${order.id}","${tableNum}","${order.total.toFixed(2)}","${methodStr}","${dateStr}","${timeStr}","${openName}","${closeName}"\n`;
        }

        const buffer = Buffer.from(csvData, 'utf-8');
        const filename = `Reporte_Ventas_${startOfDay.toISOString().split('T')[0]}.csv`;

        await ctx.replyWithDocument({ source: buffer, filename: filename });
        if (ctx.answerCbQuery) await ctx.answerCbQuery('CSV Exportado');
    } catch (err) {
        console.error(err);
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Error al exportar reporte.');
        else await ctx.reply('Error al exportar reporte.');
    }
}

bot.action('export_sales_csv', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user || !['ADMIN', 'CONTADOR'].includes(user.role)) {
        return ctx.answerCbQuery('No tienes permisos para exportar este reporte.', { show_alert: true });
    }

    exportDateState.add(telegramId);
    await ctx.reply('📅 *Exportar Ventas*\nPor favor, escribe la fecha del reporte que deseas descargar\\.\n\nFormato: `DD/MM/AAAA` \\(ej\\. 04/03/2026\\) o escribe "hoy":', { parse_mode: 'MarkdownV2' });
    await ctx.answerCbQuery();
});

async function handleNewOrderFlow(ctx: any) {
    try {
        const tables = await prisma.table.findMany({ orderBy: { number: 'asc' } });
        if (tables.length === 0) {
            return ctx.reply('No hay mesas configuradas en el sistema. Usa Panel de Administración para agregar mesas primero.');
        }

        const buttons = tables.map(t => [Markup.button.callback(`Mesa ${t.number} - ${t.status === 'AVAILABLE' ? 'Libre' : 'Ocupada'}`, `select_table_${t.id}`)]);
        await ctx.reply('🍽️ *Nueva Orden / Ver Cuenta*\nSelecciona una mesa:', {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al cargar mesas.');
    }
}

bot.command('new_order', requireRole(['ADMIN', 'MESERO']), handleNewOrderFlow);
bot.hears('📝 Nueva Orden / Ver Mesa', requireRole(['ADMIN', 'MESERO']), handleNewOrderFlow);

bot.hears('🥡 Para Llevar', requireRole(['ADMIN', 'MESERO']), async (ctx) => {
    const telegramId = ctx.from.id;
    try {
        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
        if (!user) return ctx.reply('Usuario no encontrado.');

        // Generate pickup code
        const pickupCode = Math.floor(1000 + Math.random() * 9000).toString();

        // Create order
        const order = await prisma.order.create({
            data: {
                userId: user.id,
                status: 'OPEN',
                pickupCode
            }
        });

        // Store active order ID in session state
        orderAddState.set(telegramId, { orderId: order.id, tableNumber: undefined });

        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        if (products.length === 0) {
            return ctx.reply('⚠️ Orden creada, pero el menú está vacío. Añade productos desde el panel de admin.');
        }

        const buttons = products.map(p => [Markup.button.callback(`➕ ${p.name} ($${p.price.toFixed(2)})`, `add_prod_${p.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver al menú principal', 'main_menu')]);

        await ctx.reply(`🛍️ *Orden Para Llevar*\nID: \`${order.id.split('-')[0].toUpperCase()}\-${pickupCode}\`\nSelecciona productos:`, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });

        notifyDashboard('order_new');
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al crear orden para llevar.');
    }
});

bot.hears('🧾 Cuentas Abiertas', requireRole(['ADMIN', 'MESERO']), async (ctx) => {
    try {
        const openOrders = await prisma.order.findMany({
            where: { status: 'OPEN' },
            include: { table: true, user: true, client: true }
        });

        if (openOrders.length === 0) {
            await ctx.reply('No hay cuentas abiertas actualmente.');
            return;
        }

        const buttons = openOrders.map(o => {
            const loc = o.table ? `Mesa ${o.table.number}` : 'App';
            const orderDisplayId = `${o.client ? o.client.firstName.toUpperCase() : (o.user ? o.user.firstName.toUpperCase() : 'APP')}-${o.pickupCode || 'N/A'}`;
            return [Markup.button.callback(`${loc} - ${orderDisplayId} ($${o.total.toFixed(2)})`, `view_order_${o.id}`)];
        });

        await ctx.reply('🧾 *Cuentas Abiertas:*', {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al cargar cuentas');
    }
});

bot.hears('⚙️ Panel de Administración', requireRole(['ADMIN']), async (ctx) => {
    await ctx.reply('⚙️ *Panel de Administración*\nSelecciona una opción:', {
        parse_mode: 'MarkdownV2',
        reply_markup: getAdminKeyboard()
    });
});

bot.hears('❓ Ayuda', async (ctx) => {
    // Calling the help logic
    helpCommandLogic(ctx);
});

async function helpCommandLogic(ctx: any) {
    const telegramId = ctx.from.id;
    try {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) {
            return ctx.reply('No estás registrado. Escribe /start para comenzar.');
        }

        let helpMessage = '📋 *Comandos Disponibles*\n\n';
        helpMessage += 'Usa los botones en la parte inferior de tu pantalla para navegar de forma rápida\\.\n';

        await ctx.replyWithMarkdownV2(helpMessage, getMainKeyboard(user.role));
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al obtener la ayuda.');
    }
}

bot.command('help', helpCommandLogic);

bot.action('list_tables', async (ctx) => {
    try {
        const tables = await prisma.table.findMany({ orderBy: { number: 'asc' } });
        if (tables.length === 0) {
            return ctx.editMessageText('No hay mesas configuradas en el sistema. Usa /admin_panel para agregar mesas primero.');
        }

        const buttons = tables.map(t => [Markup.button.callback(`Mesa ${t.number} - ${t.status === 'AVAILABLE' ? 'Libre' : 'Ocupada'}`, `select_table_${t.id}`)]);
        await ctx.editMessageText('🍽️ *Nueva Orden / Ver Cuenta*\nSelecciona una mesa:', { parse_mode: 'MarkdownV2', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar mesas.');
    }
});

bot.action(/select_table_(.+)/, async (ctx) => {
    const tableId = ctx.match[1];
    const telegramId = ctx.from.id;

    try {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return ctx.answerCbQuery('Usuario no encontrado');

        const table = await prisma.table.findUnique({
            where: { id: tableId },
            include: {
                orders: {
                    where: { status: 'OPEN' },
                    include: { items: true, user: true, client: true }
                }
            }
        });

        if (!table) return ctx.answerCbQuery('Mesa no encontrada');

        if (table.orders.length === 0) {
            // No open order, create one
            const newOrder = await prisma.order.create({
                data: {
                    tableId: table.id,
                    userId: user.id,
                    status: 'OPEN',
                    total: 0
                }
            });
            await prisma.table.update({ where: { id: table.id }, data: { status: 'OCCUPIED' } });

            await ctx.editMessageText(`✅ Cuenta abierta en *Mesa ${escapeMarkdownV2(table.number)}* por ${escapeMarkdownV2(user.firstName)}\\.\nUsa el botón abajo para agregar productos\\.`, {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('➕ Agregar Productos', `add_items_${newOrder.id}`)],
                    [Markup.button.callback('⬅️ Volver a Todas las Mesas', 'list_tables')]
                ])
            });
        } else {
            // Already has open order
            const order = table.orders[0];
            const openName = order.user ? escapeMarkdownV2(order.user.firstName) : (order.client ? escapeMarkdownV2(order.client.firstName) : 'Automático');
            let msg = `🧾 *Cuenta Mesa ${escapeMarkdownV2(table.number)}*\nAbierta por: ${openName}\n`;
            if (order.client) {
                msg += `Cliente: ${escapeMarkdownV2(order.client.firstName)}\n`;
            }
            msg += `\n*Productos:*\n`;

            if (order.items.length === 0) {
                msg += '\\- Ninguno aún\n';
            } else {
                order.items.forEach(item => {
                    const itemName = escapeMarkdownV2(item.name);
                    msg += `\\- ${itemName} x${item.quantity} \\(\\$${escapeMarkdownV2(item.price.toFixed(2))}\\)\n`;
                });
            }
            msg += `\n*TOTAL:* \\$${escapeMarkdownV2(order.total.toFixed(2))}`;

            await ctx.editMessageText(msg, {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('➕ Agregar Productos', `add_items_${order.id}`)],
                    [Markup.button.callback('👤 Asignar Cliente', `assign_client_${order.id}`)],
                    [Markup.button.callback('✏️ Editar Cuenta (Eliminar)', `edit_order_${order.id}`)],
                    [Markup.button.callback('❌ Cerrar Cuenta (Cobrar)', `close_order_${order.id}`)],
                    [Markup.button.callback('⬅️ Volver a Todas las Mesas', 'list_tables')]
                ])
            });
        }
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al procesar la mesa');
    }
});

bot.action(/edit_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true, table: true }
        });
        if (!order || !['OPEN', 'CART'].includes(order.status)) return ctx.answerCbQuery('La cuenta no está abierta o no existe');

        const loc = order.table ? `Mesa ${escapeMarkdownV2(order.table.number)}` : 'App';
        let msg = `✏️ *Editando Cuenta ${loc}*\nSelecciona un producto para eliminarlo:\n\n`;
        const buttons: any[] = [];

        if (order.items.length === 0) {
            msg += '\\- Ninguno aún\n';
        } else {
            for (const item of order.items) {
                const itemName = item.name.length > 20 ? item.name.substring(0, 20) + '...' : item.name;
                buttons.push([Markup.button.callback(`❌ Eliminar ${itemName} ($${item.price.toFixed(2)})`, `rm_itm_${item.id}`)]);
            }
        }

        const backCb = order.table ? `select_table_${order.table.id}` : `view_client_order_${order.id}`;
        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', backCb)]);

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar la edición de la orden');
    }
});

bot.action(/rm_itm_(.+)/, async (ctx) => {
    const itemId = ctx.match[1];

    try {
        const item = await prisma.orderItem.findUnique({ where: { id: itemId }, include: { order: { include: { table: true } } } });
        if (!item) return ctx.answerCbQuery('El producto ya fue eliminado', { show_alert: true });

        const orderId = item.orderId;

        if (item.quantity > 1) {
            // Decrement quantity
            await prisma.orderItem.update({
                where: { id: itemId },
                data: { quantity: { decrement: 1 } }
            });
        } else {
            // Delete item
            await prisma.orderItem.delete({ where: { id: itemId } });
        }

        // Update order total
        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { total: { decrement: item.price } },
            include: { items: { orderBy: { name: 'asc' } }, table: true }
        });

        await ctx.answerCbQuery(`🗑️ ${item.name} eliminado.`);

        // Rerender edit order menu
        const loc = updatedOrder.table ? `Mesa ${escapeMarkdownV2(updatedOrder.table.number)}` : 'App';
        let msg = `✏️ *Editando Cuenta ${loc}*\n✅ Eliminado: ${escapeMarkdownV2(item.name)}\nSelecciona otro producto para eliminarlo:\n\n`;
        const buttons: any[] = [];

        if (updatedOrder.items.length === 0) {
            msg += '\\- Ninguno aún\n';
        } else {
            for (const currentItem of updatedOrder.items) {
                const itemName = currentItem.name.length > 20 ? currentItem.name.substring(0, 20) + '...' : currentItem.name;
                buttons.push([Markup.button.callback(`❌ Eliminar ${itemName} ($${currentItem.price.toFixed(2)})`, `rm_itm_${currentItem.id}`)]);
            }
        }

        const backCb = updatedOrder.table ? `select_table_${updatedOrder.table.id}` : `view_client_order_${updatedOrder.id}`;
        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', backCb)]);

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al eliminar el producto');
    }
});

bot.action(/assign_client_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
        if (!order || !['OPEN', 'CART'].includes(order.status)) return ctx.answerCbQuery('La cuenta no está abierta o no existe');

        const backCb = order.table ? `select_table_${order.table.id}` : `view_client_order_${order.id}`;
        const loc = order.table ? `Mesa ${order.table.number}` : 'App';

        const buttons = [
            [Markup.button.callback('🔍 Buscar Cliente (Nombre/Tel)', `search_client_${order.id}`)],
            [Markup.button.callback('📋 Listar Todos los Clientes', `list_all_clients_${order.id}`)]
        ];

        if (order.clientId) {
            buttons.push([Markup.button.callback('❌ Quitar Cliente Actual', `set_client_${order.id}_none`)]);
        }

        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', backCb)]);

        await ctx.editMessageText(`👤 *Asignar Cliente a ${escapeMarkdownV2(loc)}*\n\n¿Cómo deseas encontrar al cliente?`, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar opciones de cliente');
    }
});

bot.action(/search_client_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    waiterClientSearchState.set(ctx.from.id, { orderId });
    await ctx.editMessageText('🔎 *Buscar Cliente*\nEscribe el nombre o teléfono del cliente para buscarlo:', {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `assign_client_${orderId}` }]] }
    });
});

bot.action(/list_all_clients_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const clients = await prisma.user.findMany({ where: { role: 'CLIENTE' }, orderBy: { firstName: 'asc' }, take: 50 });
        if (clients.length === 0) {
            return ctx.answerCbQuery('No hay clientes registrados.', { show_alert: true });
        }

        const buttons = clients.map(c => [Markup.button.callback(`👤 ${c.firstName} (${c.phone || 'N/T'})`, `set_client_${orderId}_${c.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver', `assign_client_${orderId}`)]);

        await ctx.editMessageText('👥 *Todos los Clientes:*', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al listar clientes');
    }
});

bot.action(/set_client_(.+)_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    const clientId = ctx.match[2];

    try {
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
        if (!order) return ctx.answerCbQuery('Orden no encontrada');

        if (clientId === 'none') {
            await prisma.order.update({ where: { id: orderId }, data: { clientId: null } });
            await ctx.answerCbQuery('Cliente quitado de la orden');
        } else {
            await prisma.order.update({ where: { id: orderId }, data: { clientId } });
            await ctx.answerCbQuery('Cliente asignado a la orden');
        }

        // Return to the table view by re-invoking the internal table load logic
        // We'll simulate the load table action 
        if (order.tableId) {
            const tableId = order.tableId;
            await ctx.editMessageText('✅ Actualizado. Vuelve a abrir la mesa.', {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`Volver a la Mesa ${order.table?.number || ''}`, `select_table_${tableId}`)]
                ])
            });
        } else {
            await ctx.editMessageText('✅ Cliente asignado.', {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`Volver a la Orden`, `view_client_order_${order.id}`)]
                ])
            });
        }

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al asignar el cliente');
    }
});

bot.action(/add_items_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    const telegramId = ctx.from.id;
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
        if (!order || !['OPEN', 'CART'].includes(order.status)) return ctx.answerCbQuery('La cuenta no está abierta o no existe');

        // Store active order ID in session state to avoid 64-byte callback limit on Telegram
        orderAddState.set(telegramId, { orderId, tableNumber: order.table?.number });

        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        if (products.length === 0) {
            return ctx.answerCbQuery('El menú está vacío. Añade productos desde el panel de admin.', { show_alert: true });
        }

        const backCb = order.table ? `select_table_${order.table.id}` : `view_client_order_${order.id}`;
        const loc = order.table ? `Mesa ${escapeMarkdownV2(order.table.number)}` : 'la orden de la App';

        const buttons = products.map(p => [Markup.button.callback(`➕ ${p.name} ($${p.price.toFixed(2)})`, `add_prod_${p.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', backCb)]);

        await ctx.editMessageText(`📖 *Menú*\nSelecciona productos para ${loc}:`, { parse_mode: 'MarkdownV2', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar el menú para la orden');
    }
});

bot.action(/add_prod_(.+)/, async (ctx) => {
    const productId = ctx.match[1];
    const telegramId = ctx.from.id;

    // Retrieve active order from state
    const state = orderAddState.get(telegramId);
    if (!state) return ctx.answerCbQuery('Sesión caducada, por favor vuelve a abrir la mesa.', { show_alert: true });

    const orderId = state.orderId;

    try {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });

        if (!product || !order) return ctx.answerCbQuery('Error, producto u orden no encontrados');

        if (order.table && (order.table.status as string) === 'BLOCKED') {
            return ctx.answerCbQuery('⚠️ Mesa Bloqueada: No se pueden agregar productos.', { show_alert: true });
        }

        const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
        if (!user) return ctx.answerCbQuery('Usuario no encontrado');

        // Check if item already exists in this order
        const existingItem = await prisma.orderItem.findFirst({
            where: { orderId: order.id, name: product.name }
        });

        if (existingItem) {
            await prisma.orderItem.update({
                where: { id: existingItem.id },
                data: { quantity: { increment: 1 } }
            });
        } else {
            await prisma.orderItem.create({
                data: {
                    orderId: order.id,
                    userId: user.id,
                    name: product.name,
                    price: product.price,
                    quantity: 1
                } as any
            });
        }

        await prisma.order.update({
            where: { id: order.id },
            data: { total: { increment: product.price } }
        });

        notifyDashboard('table_updated');

        await ctx.answerCbQuery(`✅ Añadido: ${product.name}`);

        // Rerender the menu to show the updated status
        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        const backCb = order.table ? `select_table_${order.table.id}` : `view_client_order_${order.id}`;

        const buttons = products.map(p => [Markup.button.callback(`➕ ${p.name} ($${p.price.toFixed(2)})`, `add_prod_${p.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', backCb)]);

        // Replace special characters for MarkdownV2, except the ones we use for formatting
        const safeProductName = escapeMarkdownV2(product.name);
        const safeLocName = order.table ? `la Mesa ${escapeMarkdownV2(order.table.number)}` : 'App';

        await ctx.editMessageText(`📖 *Menú*\n✅ Añadido: ${safeProductName}\nSigue seleccionando productos para ${safeLocName}:`, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al añadir producto a la orden');
    }
});

bot.action(/close_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
        if (!order) return ctx.answerCbQuery('No se encontró la orden');

        const loc = order.table ? `Mesa ${escapeMarkdownV2(order.table.number)}` : 'Pedido App';
        const backCb = order.table ? `select_table_${order.table.id}` : `view_client_order_${order.id}`;

        await ctx.editMessageText(`💰 *Cobrar ${loc}*\n*Total:* \\$${escapeMarkdownV2(order.total.toFixed(2))}\n\n¿Método de pago?`, {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💵 Efectivo', `pay_cash_${order.id}`)],
                [Markup.button.callback('💳 Tarjeta', `pay_card_${order.id}`)],
                [Markup.button.callback('⬅️ Volver a la cuenta', backCb)]
            ])
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al preparar cobro');
    }
});

async function processPaymentAndCloseOrder(ctx: any, orderId: string, telegramId: number, method: 'CASH' | 'CARD') {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true, items: true, client: true } });
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!order || !user) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Error al identificar usuario u orden');
        else await ctx.reply('Error al identificar usuario u orden');
        return;
    }

    const config = await prisma.restaurantConfig.upsert({ where: { id: 1 }, update: {}, create: {} });

    await prisma.order.update({
        where: { id: orderId },
        data: { status: 'CLOSED', paymentMethod: method, closedById: user.id, closedAt: new Date() }
    });
    if (order.tableId) {
        await prisma.table.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } });
        notifyDashboard('table_updated', { tableId: order.tableId, status: 'AVAILABLE' });
    }

    // Notify Dashboard of order closure
    notifyDashboard('order_updated', { orderId: order.id, status: 'CLOSED' });

    order.paymentMethod = method as any;

    const loc = order.table ? `Mesa ${escapeMarkdownV2(order.table.number)}` : 'App';
    const cbBack = order.table ? 'list_tables' : 'admin_cuentas';
    const cbText = order.table ? '⬅️ Volver a Todas las Mesas' : '⬅️ Volver a Cuentas Abiertas';

    const methodTxt = method === 'CASH' ? '💵 Efectivo' : '💳 Tarjeta';

    const msg = `✅ *Cuenta de ${loc} CERRADA*\n*Cobrado:* \\$${escapeMarkdownV2(order.total.toFixed(2))} \\(${methodTxt}\\)`;

    // Si viene de un boton (callback_query), se puede editar el mensaje. Si viene de un texto (message), se debe responder.
    if (ctx.updateType === 'callback_query' && ctx.editMessageText) {
        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: [[{ text: cbText, callback_data: cbBack }]] }
        });
    } else {
        await ctx.reply(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: [[{ text: cbText, callback_data: cbBack }]] }
        });
    }

    try {
        console.log(`Generating ticket image for order ${order.id}...`);
        const imageBuffer = await generateTicketImage(order, config);
        console.log(`Image generated successfully, size: ${imageBuffer.length} bytes. Sending to waiter...`);

        const tblName = order.table ? `Mesa ${order.table.number}` : 'App';
        await ctx.replyWithPhoto({ source: imageBuffer }, { caption: `Ticket ${tblName}` });

        console.log(`Ticket sent to waiter. Checking if client notification is needed... Client: ${order.client ? 'Yes' : 'No'}, TelegramId: ${order.client?.telegramId}`);

        if (order.client && order.client.telegramId) {
            try {
                console.log(`Sending ticket to client ${order.client.telegramId}...`);
                await ctx.telegram.sendPhoto(
                    Number(order.client.telegramId),
                    { source: imageBuffer },
                    {
                        caption: `✨ *¡Tu pedido ha sido entregado\\!*\n\nMuchas gracias por tu compra\\. ¡Esperamos volver a verte pronto\\!\n\\- _El equipo de Tacos_`,
                        parse_mode: 'MarkdownV2'
                    }
                );
                console.log(`Ticket successfully sent to client.`);
            } catch (e) {
                console.error(`Could not notify client ${order.client.telegramId} on order close:`, e);
            }
        }
    } catch (ticketError) {
        console.error('Error generating or sending ticket:', ticketError);
        await ctx.reply(`⚠️ El pedido se cerró correctamente, pero hubo un error al generar el ticket visual: ${ticketError}`);
    }
}

bot.action(/pay_cash_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (order?.pickupCode && order?.status === 'OPEN') {
            waiterPickupCodeState.set(ctx.from.id, { orderId, paymentMethod: 'CASH' });
            return ctx.editMessageText('🔒 *Validación de Entrega*\n\nPor favor, pídele al cliente e ingresa aquí su *código PIN de 4 dígitos* para poder cobrar y entregar su pedido:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `view_order_${orderId}` }]] }
            });
        }
        await processPaymentAndCloseOrder(ctx, orderId, ctx.from.id, 'CASH');
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al procesar cobro en efectivo');
    }
});

bot.action(/pay_card_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (order?.pickupCode && order?.status === 'OPEN') {
            waiterPickupCodeState.set(ctx.from.id, { orderId, paymentMethod: 'CARD' });
            return ctx.editMessageText('🔒 *Validación de Entrega*\n\nPor favor, pídele al cliente e ingresa aquí su *código PIN de 4 dígitos* para poder cobrar y entregar su pedido:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `view_order_${orderId}` }]] }
            });
        }
        await processPaymentAndCloseOrder(ctx, orderId, ctx.from.id, 'CARD');
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al procesar cobro con tarjeta');
    }
});

bot.on('message', async (ctx, next) => {
    const telegramId = ctx.from.id;

    if (ctx.message && 'text' in ctx.message) {
        const text = ctx.message.text.trim();

        // Auto-register prompt for WhatsApp/unknown users
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) {
            const totalUsers = await prisma.user.count();
            const isFirst = totalUsers === 0;
            const firstName = ctx.from.first_name || 'Usuario';
            const username = ctx.from.username ?? null;

            if (isFirst) {
                await prisma.user.create({
                    data: { telegramId, username, firstName, role: 'ADMIN' }
                });
                await ctx.reply(`¡Hola ${firstName}! Has sido registrado como ADMIN del sistema. Usa los botones de abajo o /help.`, getMainKeyboard('ADMIN'));
            } else {
                await ctx.reply(`¡Bienvenido ${firstName}! ¿Cómo deseas registrarte?`,
                    Markup.keyboard([
                        ['🌮 Soy Cliente', '💼 Soy Empleado']
                    ]).oneTime().resize()
                );
            }
            return;
        }

        if (expenseState.has(telegramId)) {
            const state = expenseState.get(telegramId)!;
            if (state.step === 'DESCRIPTION') {
                expenseState.set(telegramId, { step: 'AMOUNT', description: text });
                await ctx.reply('💰 *Monto del Gasto*\nAhora, ingresa el monto del gasto (solo números, ej: 150.50):', { parse_mode: 'MarkdownV2' });
                return;
            } else if (state.step === 'AMOUNT') {
                const amount = parseFloat(text.replace(',', '.'));
                if (isNaN(amount) || amount <= 0) {
                    return ctx.reply('❌ *Monto no válido.* Por favor ingresa un número positivo.');
                }

                try {
                    await prisma.expense.create({
                        data: {
                            description: state.description!,
                            amount: amount
                        }
                    });
                    expenseState.delete(telegramId);
                    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('📊 Volver a Finanzas', 'admin_finanzas')]]);
                    await ctx.reply(`✅ *Gasto registrado*\n\n*Descripción:* ${escapeMarkdownV2(state.description!)}\n*Monto:* \\$${escapeMarkdownV2(amount.toFixed(2))}`, { parse_mode: 'MarkdownV2', ...keyboard });
                } catch (err) {
                    console.error(err);
                    await ctx.reply('Error al registrar el gasto.');
                    expenseState.delete(telegramId);
                }
                return;
            }
        }

        if (exportDateState.has(telegramId)) {
            exportDateState.delete(telegramId);
            let targetDate = new Date();
            if (text.toLowerCase() !== 'hoy') {
                const parts = text.split(/[\/\-]/);
                if (parts.length === 3) {
                    // Try DD/MM/YYYY
                    const day = parseInt(parts[0]);
                    const month = parseInt(parts[1]) - 1;
                    const year = parts[2].length === 2 ? 2000 + parseInt(parts[2]) : parseInt(parts[2]);
                    targetDate = new Date(year, month, day);
                } else {
                    return ctx.reply('❌ *Formato de fecha incorrecto.* Debe ser DD/MM/AAAA (ej. 04/03/2026). Intenta de nuevo presionando Exportar.', { parse_mode: 'Markdown' });
                }
            }

            if (isNaN(targetDate.getTime())) {
                return ctx.reply('❌ *Fecha no válida.* Por favor intenta de nuevo presionando Exportar.', { parse_mode: 'Markdown' });
            }

            await ctx.reply(`🔍 *Generando reporte* para el día ${targetDate.toLocaleDateString()}...`, { parse_mode: 'Markdown' });
            await generateAndSendSalesCSV(ctx, targetDate);
            return;
        }

        if (waiterClientSearchState.has(telegramId)) {
            const state = waiterClientSearchState.get(telegramId)!;
            // Mode: Keep state if they want to retry? No, usually delete.
            waiterClientSearchState.delete(telegramId);

            try {
                const clients = await prisma.user.findMany({
                    where: {
                        role: 'CLIENTE',
                        OR: [
                            { firstName: { contains: text, mode: 'insensitive' } },
                            { phone: { contains: text, mode: 'insensitive' } }
                        ]
                    },
                    take: 10
                });

                if (clients.length === 0) {
                    await ctx.reply(`❌ No se encontraron clientes que coincidan con "${escapeMarkdownV2(text)}"\\.`, {
                        parse_mode: 'MarkdownV2',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('🔍 Reintentar', `search_client_${state.orderId}`)],
                            [Markup.button.callback('📋 Ver Todos', `list_all_clients_${state.orderId}`)],
                            [Markup.button.callback('⬅️ Volver', `assign_client_${state.orderId}`)]
                        ])
                    });
                    return;
                }

                const buttons = clients.map(c => [Markup.button.callback(`👤 ${c.firstName} (${c.phone || 'N/T'})`, `set_client_${state.orderId}_${c.id}`)]);
                buttons.push([Markup.button.callback('⬅️ Volver', `assign_client_${state.orderId}`)]);

                await ctx.reply(`✅ *Resultados para "${escapeMarkdownV2(text)}":*`, {
                    parse_mode: 'MarkdownV2',
                    reply_markup: { inline_keyboard: buttons }
                });
            } catch (err) {
                console.error(err);
                await ctx.reply('Error al realizar la búsqueda.');
            }
            return;
        }

        if (waiterPickupCodeState.has(telegramId)) {
            const state = waiterPickupCodeState.get(telegramId)!;
            const inputCode = text;

            const order = await prisma.order.findUnique({ where: { id: state.orderId } });
            if (!order || order.pickupCode !== inputCode) {
                await ctx.reply('❌ *Código incorrecto.* Asegúrate de pedirle al cliente su código de 4 dígitos e intenta de nuevo.', { parse_mode: 'Markdown' });
                return;
            }

            waiterPickupCodeState.delete(telegramId);
            await ctx.reply('✅ *Código verificado exitosamente.* Generando ticket y cerrando cuenta...', { parse_mode: 'Markdown' });
            await processPaymentAndCloseOrder(ctx, state.orderId, telegramId, state.paymentMethod);
            return;
        }

        if (clientRegState.has(telegramId)) {
            const state = clientRegState.get(telegramId)!;
            const username = ctx.from.username ?? null;

            if (state.step === 'NAME') {
                clientRegState.set(telegramId, { step: 'PHONE', name: text });
                await ctx.reply('¡Gracias! Ahora, por favor envíame tu **Número de Teléfono** de contacto:', { parse_mode: 'Markdown' });
                return;
            } else if (state.step === 'PHONE') {
                const fullName = state.name || ctx.from.first_name;
                try {
                    await prisma.user.upsert({
                        where: { telegramId },
                        update: {
                            username,
                            firstName: fullName,
                            phone: text,
                            role: 'CLIENTE'
                        },
                        create: {
                            telegramId,
                            username,
                            firstName: fullName,
                            phone: text,
                            role: 'CLIENTE'
                        }
                    });
                    clientRegState.delete(telegramId);
                    await ctx.reply(`¡Registro exitoso, ${fullName}!\nTu número (${text}) ha sido guardado.`, getMainKeyboard('CLIENTE'));
                } catch (err) {
                    console.error(err);
                    await ctx.reply('Error al registrar tus datos de cliente. Inténtalo de nuevo con /start.');
                    clientRegState.delete(telegramId);
                }
                return;
            }
        }

        if (configEditState.has(telegramId)) {
            const editMode = configEditState.get(telegramId);
            if (text.toLowerCase() === 'cancelar') {
                configEditState.delete(telegramId);
                return ctx.reply('Edición cancelada. Usa /admin_panel y entra a Configuración para continuar.');
            }

            try {
                if (editMode === 'LOGO') {
                    await prisma.restaurantConfig.upsert({ where: { id: 1 }, update: { logoUrl: text }, create: { logoUrl: text } });
                    await ctx.reply('Logo actualizado exitosamente.');
                } else if (editMode === 'LOCATION') {
                    await prisma.restaurantConfig.upsert({ where: { id: 1 }, update: { locationText: text }, create: { locationText: text } });
                    await ctx.reply('Ubicación actualizada exitosamente.');
                } else if (editMode === 'MESSAGE') {
                    await prisma.restaurantConfig.upsert({ where: { id: 1 }, update: { thankYouMessage: text }, create: { thankYouMessage: text } });
                    await ctx.reply('Mensaje de agradecimiento actualizado exitosamente.');
                }
                configEditState.delete(telegramId);
            } catch (err) {
                console.error(err);
                await ctx.reply('Error al actualizar configuración.');
            }
            return;
        }

        if (productAddState.has(telegramId)) {
            if (text.toLowerCase() === 'cancelar') {
                productAddState.delete(telegramId);
                return ctx.reply('Adición de producto cancelada. Usa /admin_panel para volver al menú.');
            }

            let price = 0;
            let name = text;
            const lastDashMatch = text.match(/(.+)(?:-|\$)\s*([\d.]+)$/);
            if (lastDashMatch) {
                name = lastDashMatch[1].trim();
                price = parseFloat(lastDashMatch[2]);
            }

            if (isNaN(price)) price = 0;

            if (price === 0) {
                return ctx.reply('No se detectó un precio válido. Por favor intenta de nuevo con el formato "Nombre - Precio" o escribe "cancelar".');
            }

            try {
                await prisma.product.create({
                    data: { name, price }
                });

                // Do not delete state, allow them to keep typing
                await ctx.reply(`✅ Producto "${name}" guardado exitosamente con precio $${price.toFixed(2)}.\n\nEscribe el siguiente producto o presiona "Volver al Menú" para terminar.`, {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('⬅️ Volver al menú', 'admin_menu')]
                    ])
                });
            } catch (err) {
                console.error(err);
                await ctx.reply('Error al guardar el producto.');
            }
            return;
        }
    }

    return next();
});

bot.hears('🚪 Salir', requireRole(['CLIENTE', 'ADMIN', 'MESERO', 'CONTADOR']), async (ctx) => {
    await ctx.reply('Has cerrado tu sesión actual en el bot.\n\n¿Cómo deseas registrarte ahora?',
        Markup.keyboard([
            ['🌮 Soy Cliente', '💼 Soy Empleado']
        ]).oneTime().resize()
    );
});

bot.hears('📖 Ver Menú', requireRole(['CLIENTE', 'ADMIN']), async (ctx) => {
    try {
        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        if (products.length === 0) {
            return ctx.reply('El menú está vacío por el momento.');
        }

        let menuMessage = `📖 *Menú del Restaurante*\n\n`;
        for (const product of products) {
            menuMessage += `🌮 *${escapeMarkdownV2(product.name)}*\n   \\$${escapeMarkdownV2(product.price.toFixed(2))}\n\n`;
        }

        await ctx.replyWithMarkdownV2(menuMessage);
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al mostrar el menú.');
    }
});

bot.hears('📋 Mis Pedidos', requireRole(['CLIENTE', 'ADMIN']), async (ctx) => {
    const telegramId = ctx.from.id;
    try {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return;

        const activeOrders = await prisma.order.findMany({
            where: {
                clientId: user.id,
                status: { in: ['OPEN', 'PENDING_APPROVAL'] }
            },
            include: { items: true },
            orderBy: { createdAt: 'desc' }
        });

        if (activeOrders.length === 0) {
            return ctx.reply('No tienes pedidos activos en este momento.');
        }

        let msg = `📋 *Mis Pedidos Activos*\n\n`;
        for (const order of activeOrders) {
            const statusEmoji = order.status === 'PENDING_APPROVAL' ? '⏳' : '👨‍🍳';
            const statusTxt = order.status === 'PENDING_APPROVAL' ? 'Pendiente de Aprobación' : 'Siendo Preparado';
            const orderDisplayId = `${user.firstName.toUpperCase()}-${order.pickupCode || 'N/A'}`;

            msg += `${statusEmoji} *Estado:* ${statusTxt}\n`;
            msg += `🆔 *ID:* \`${escapeMarkdownV2(orderDisplayId)}\`\n`;
            if (order.pickupCode) {
                msg += `🔑 *PIN de Recolección:* \`${order.pickupCode}\`\n`;
            }
            msg += `💰 *Total:* \\$${escapeMarkdownV2(order.total.toFixed(2))}\n`;
            msg += `📦 *Productos:* ${order.items.map(i => `${i.quantity}x ${escapeMarkdownV2(i.name)}`).join(', ')}\n\n`;
        }

        await ctx.replyWithMarkdownV2(msg);
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al obtener tus pedidos.');
    }
});

bot.hears('🛍️ Hacer Pedido', requireRole(['CLIENTE', 'ADMIN']), async (ctx) => {
    const telegramId = ctx.from.id;
    try {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return;

        // Check if there is already a CART or PENDING_APPROVAL order
        let order = await prisma.order.findFirst({
            where: {
                clientId: user.id,
                status: { in: ['CART', 'PENDING_APPROVAL'] }
            },
            include: { items: true }
        });

        if (order && order.status === 'PENDING_APPROVAL') {
            return ctx.reply('Tienes un pedido pendiente de aprobación. Por favor espera a que un mesero lo reciba.');
        }

        if (!order) {
            order = await prisma.order.create({
                data: {
                    clientId: user.id,
                    status: 'CART',
                    total: 0
                },
                include: { items: true }
            });
        }

        // Display current CART
        let msg = `🛒 *Tu Pedido \\(Carrito\\)*\n\n`;
        if (order.items.length === 0) {
            msg += '\\- _Aún no has agregado productos_\\.\n';
        } else {
            for (const item of order.items) {
                msg += `\\- ${escapeMarkdownV2(item.name)} x${item.quantity} \\(\\$${escapeMarkdownV2(item.price.toFixed(2))}\\)\n`;
            }
        }
        msg += `\n*TOTAL:* \\$${escapeMarkdownV2(order.total.toFixed(2))}\n`;
        msg += `\nUsa los botones abajo para gestionar tu carrito:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('➕ Agregar Productos', `add_items_${order.id}`)],
            order.items.length > 0 ? [Markup.button.callback('✏️ Editar (Eliminar)', `edit_order_${order.id}`)] : [],
            order.items.length > 0 ? [Markup.button.callback('✅ Enviar Pedido', `submit_client_order_${order.id}`)] : [],
            [Markup.button.callback('❌ Vaciar Carrito', `empty_cart_${order.id}`)]
        ].filter(row => row.length > 0));

        await ctx.replyWithMarkdownV2(msg, keyboard);

    } catch (err) {
        console.error(err);
        await ctx.reply('Error al abrir tu carrito.');
    }
});

bot.action(/view_client_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true }
        });

        if (!order || order.status !== 'CART') {
            return ctx.answerCbQuery('Carrito expirado o ya enviado.');
        }

        let msg = `🛒 *Tu Pedido \\(Carrito\\)*\n\n`;
        if (order.items.length === 0) {
            msg += '\\- _Aún no has agregado productos_\\.\n';
        } else {
            for (const item of order.items) {
                msg += `\\- ${escapeMarkdownV2(item.name)} x${item.quantity} \\(\\$${escapeMarkdownV2(item.price.toFixed(2))}\\)\n`;
            }
        }
        msg += `\n*TOTAL:* \\$${escapeMarkdownV2(order.total.toFixed(2))}\n`;
        msg += `\nUsa los botones abajo para gestionar tu carrito\\:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('➕ Agregar Productos', `add_items_${order.id}`)],
            order.items.length > 0 ? [Markup.button.callback('✏️ Editar (Eliminar)', `edit_order_${order.id}`)] : [],
            order.items.length > 0 ? [Markup.button.callback('✅ Enviar Pedido', `submit_client_order_${order.id}`)] : [],
            [Markup.button.callback('❌ Vaciar Carrito', `empty_cart_${order.id}`)]
        ].filter(row => row.length > 0));

        await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...keyboard });

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al actualizar el carrito.');
    }
});

bot.action(/submit_client_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true, client: true }
        });

        if (!order || order.status !== 'CART') {
            return ctx.answerCbQuery('No se puede enviar. El carrito ya fue enviado o no existe.', { show_alert: true });
        }

        if (order.items.length === 0) {
            return ctx.answerCbQuery('El carrito está vacío.', { show_alert: true });
        }

        const pickupCode = Math.floor(1000 + Math.random() * 9000).toString();

        await prisma.order.update({
            where: { id: orderId },
            data: { status: 'PENDING_APPROVAL', pickupCode }
        });

        const clientName = order.client ? escapeMarkdownV2(order.client.firstName) : 'Desconocido';
        const total = escapeMarkdownV2(order.total.toFixed(2));

        const orderDisplayId = `${order.client ? order.client.firstName.toUpperCase() : 'APP'}-${pickupCode}`;

        let clientMsg = `✅ *Pedido Enviado*\n\n*ID de Orden:* \`${orderDisplayId}\`\n\n*Resumen de tu pedido\\:*\n`;
        for (const item of order.items) {
            clientMsg += `\\- ${escapeMarkdownV2(item.name)} x${item.quantity} \\(\\$${escapeMarkdownV2(item.price.toFixed(2))}\\)\n`;
        }
        clientMsg += `\n*TOTAL:* \\$${total}\n\n*TU PIN DE RECOLECCIÓN:* \`${pickupCode}\`\n\n_El personal confirmará tu pedido en breve\\ y te pedirán este PIN al entregarte_\\.`;

        await ctx.editMessageText(clientMsg, { parse_mode: 'MarkdownV2' });

        // Notify Admins and Waiters
        const staff = await prisma.user.findMany({
            where: { role: { in: ['ADMIN', 'MESERO'] } }
        });

        const btnKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('👀 Ver Pedido Confirmar', `waiter_view_pending_${order.id}`)]
        ]);

        for (const user of staff) {
            try {
                await ctx.telegram.sendMessage(
                    Number(user.telegramId),
                    `🛎️ ¡Nuevo pedido recibido\\!\n*ID Orden:* ${escapeMarkdownV2(orderDisplayId)}\n*Cliente:* ${clientName}\n*Total:* \\$${total}`,
                    { parse_mode: 'MarkdownV2', ...btnKeyboard }
                );
            } catch (e) {
                console.error(`Could not notify staff ${user.telegramId}`);
            }
        }

        // Notify Dashboard of new app order
        notifyDashboard('order_new', { orderId: order.id, status: 'PENDING_APPROVAL' });

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al enviar el pedido.');
    }
});

bot.action(/empty_cart_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId }
        });

        if (!order || order.status !== 'CART') {
            return ctx.answerCbQuery('El carrito no existe o ya fue enviado.');
        }

        // Delete all items first, then the order
        await prisma.orderItem.deleteMany({ where: { orderId } });
        await prisma.order.delete({ where: { id: orderId } });

        await ctx.editMessageText('🗑️ Tu carrito ha sido vaciado.', Markup.inlineKeyboard([
            [Markup.button.callback('📖 Ver Menú', 'view_menu_client')]
        ]));

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al vaciar el carrito.');
    }
});

bot.hears('🛎️ Pedidos de Clientes', requireRole(['ADMIN', 'MESERO']), async (ctx) => {
    try {
        const pendingOrders = await prisma.order.findMany({
            where: { status: 'PENDING_APPROVAL' },
            include: { client: true },
            orderBy: { createdAt: 'asc' }
        });

        if (pendingOrders.length === 0) {
            return ctx.reply('No hay pedidos pendientes de clientes en este momento.');
        }

        const buttons = pendingOrders.map(o => {
            const clientName = o.client ? o.client.firstName : 'Desconocido';
            return [Markup.button.callback(`🕒 ${clientName} - $${o.total.toFixed(2)}`, `waiter_view_pending_${o.id}`)];
        });

        await ctx.reply('🛎️ *Pedidos Pendientes de Clientes*\nSelecciona un pedido para revisarlo:', {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al cargar pedidos pendientes.');
    }
});

bot.action(/waiter_view_pending_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true, client: true }
        });

        if (!order || order.status !== 'PENDING_APPROVAL') {
            return ctx.answerCbQuery('El pedido ya fue procesado o no existe.', { show_alert: true });
        }

        const clientName = order.client ? escapeMarkdownV2(order.client.firstName) : 'Desconocido';
        const clientPhone = order.client?.phone ? escapeMarkdownV2(order.client.phone) : 'Sin Teléfono';

        const orderDisplayId = `${order.client ? order.client.firstName.toUpperCase() : 'APP'}-${order.pickupCode || 'N/A'}`;

        let msg = `🛎️ *Pedido Pendiente*\n*ID Orden:* ${escapeMarkdownV2(orderDisplayId)}\n*Cliente:* ${clientName} \\(${clientPhone}\\)\n*Fecha:* ${escapeMarkdownV2(order.updatedAt.toLocaleString())}\n\n*Productos:*\n`;
        for (const item of order.items) {
            msg += `\\- ${escapeMarkdownV2(item.name)} x${item.quantity} \\(\\$${escapeMarkdownV2(item.price.toFixed(2))}\\)\n`;
        }
        msg += `\n*TOTAL:* \\$${escapeMarkdownV2(order.total.toFixed(2))}`;

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Confirmar Recepción', `waiter_accept_order_${order.id}`)],
                [Markup.button.callback('⬅️ Volver a Lista', 'btn_view_pending_list')]
            ])
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar el pedido pendiente.');
    }
});

bot.action('btn_view_pending_list', async (ctx) => {
    try {
        const pendingOrders = await prisma.order.findMany({
            where: { status: 'PENDING_APPROVAL' },
            include: { client: true },
            orderBy: { createdAt: 'asc' }
        });

        if (pendingOrders.length === 0) {
            return ctx.editMessageText('No hay pedidos pendientes de clientes en este momento.');
        }

        const buttons = pendingOrders.map(o => {
            const clientName = o.client ? o.client.firstName : 'Desconocido';
            return [Markup.button.callback(`🕒 ${clientName} - $${o.total.toFixed(2)}`, `waiter_view_pending_${o.id}`)];
        });

        await ctx.editMessageText('🛎️ *Pedidos Pendientes de Clientes*\nSelecciona un pedido para revisarlo:', {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar pedidos pendientes.');
    }
});

bot.action(/waiter_accept_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    const telegramId = ctx.from.id;
    try {
        const waiter = await prisma.user.findUnique({ where: { telegramId } });
        if (!waiter) return ctx.answerCbQuery('Personal no autorizado');

        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { client: true } });
        if (!order || order.status !== 'PENDING_APPROVAL') {
            return ctx.answerCbQuery('El pedido ya fue procesado o no existe.', { show_alert: true });
        }

        await prisma.order.update({
            where: { id: orderId },
            data: {
                status: 'OPEN',
                userId: waiter.id
            }
        });

        await ctx.editMessageText(`✅ Pedido aceptado. La orden se ha movido a tus *Cuentas Abiertas*.`);

        if (order.client && order.client.telegramId) {
            try {
                await ctx.telegram.sendMessage(
                    Number(order.client.telegramId),
                    `✅ *¡Tu pedido ha sido recibido y se está preparando\\!*\nSerás notificado por el personal de cualquier actualización\\.`,
                    { parse_mode: 'MarkdownV2' }
                );
            } catch (e) {
                console.error(`Could not notify client ${order.client.telegramId}`);
            }
        }

        // Notify Dashboard of status change
        notifyDashboard('order_updated', { orderId: order.id, status: 'OPEN' });

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al aceptar el pedido.');
    }
});
// --- Web Admin Dashboard (Express & Socket.io) ---

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// JSON BigInt serialization fix
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

// Serve static frontend files
// Multer configuration for image uploads
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, '../public')));

// Upload endpoint
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ imageUrl });
});

// Helper to notify dashboard
function notifyDashboard(event: string, data?: any) {
    io.emit(event, data);
}

// API Routes
app.get('/api/status', async (req, res) => {
    try {
        const activeTables = await prisma.table.count({ where: { status: 'OCCUPIED' } });
        const clientOrders = await prisma.order.count({
            where: {
                tableId: null,
                clientId: { not: null },
                status: { in: ['OPEN', 'PENDING_APPROVAL'] }
            }
        });
        const toGoOrders = await prisma.order.count({
            where: {
                tableId: null,
                clientId: null,
                status: { in: ['OPEN', 'PENDING_APPROVAL'] }
            }
        });
        res.json({ activeTables, clientOrders, toGoOrders });
    } catch (e) {
        console.error('API /api/status error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { status: { in: ['OPEN', 'PENDING_APPROVAL'] } },
            include: { items: true, table: true, client: true, user: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(orders);
    } catch (e) {
        console.error('API /api/orders error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/tables', async (req, res) => {
    try {
        const tables = await prisma.table.findMany({
            orderBy: { number: 'asc' },
            include: {
                orders: {
                    where: { status: { in: ['OPEN', 'PENDING_APPROVAL', 'CART'] as any } },
                    include: {
                        user: true,
                        items: {
                            include: { user: true } as any
                        }
                    }
                }
            }
        });

        // Format data for the frontend
        const formattedTables = tables.map((t: any) => {
            const activeOrder = t.orders[0] || null;
            let waiters: string[] = [];
            if (activeOrder) {
                // Primary waiter
                if (activeOrder.user) waiters.push(activeOrder.user.firstName);
                // Contributors
                (activeOrder.items as any[]).forEach(item => {
                    if (item.user && !waiters.includes(item.user.firstName)) {
                        waiters.push(item.user.firstName);
                    }
                });
            }

            return {
                id: t.id,
                number: t.number,
                status: t.status,
                activeOrder: activeOrder ? {
                    total: activeOrder.total,
                    waiters: waiters,
                    items: activeOrder.items.map((i: any) => ({
                        name: i.name,
                        quantity: i.quantity,
                        price: i.price
                    }))
                } : null
            };
        });

        res.json(formattedTables);
    } catch (e) {
        console.error('API /api/tables error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/tables', async (req, res) => {
    try {
        const lastTable = await prisma.table.findFirst({
            orderBy: { number: 'desc' }
        });
        const nextNumber = lastTable ? lastTable.number + 1 : 1;

        const newTable = await prisma.table.create({
            data: { number: nextNumber }
        });

        res.status(201).json(newTable);
    } catch (e) {
        console.error('API POST /api/tables error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/tables/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const table = await prisma.table.findUnique({
            where: { id },
            include: { orders: { where: { status: { in: ['OPEN', 'PENDING_APPROVAL'] as any } } } }
        });
        if (!table) return res.status(404).json({ error: 'Table not found' });

        let newStatus: string;
        if ((table.status as string) === 'BLOCKED') {
            // When unblocking, check if it should be OCCUPIED or AVAILABLE
            newStatus = table.orders.length > 0 ? 'OCCUPIED' : 'AVAILABLE';
        } else {
            // When blocking from any state (AVAILABLE or OCCUPIED)
            newStatus = 'BLOCKED';
        }

        const updatedTable = await prisma.table.update({
            where: { id },
            data: { status: newStatus as any }
        });

        notifyDashboard('table_updated');

        res.json(updatedTable);
    } catch (e) {
        console.error('API PATCH /api/tables status error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/tables/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Dissociate from orders first if needed, but usually we don't delete tables with active orders
        const activeOrder = await prisma.order.findFirst({
            where: { tableId: id, status: { in: ['OPEN', 'PENDING_APPROVAL'] as any } }
        });

        if (activeOrder) {
            return res.status(400).json({ error: 'No se puede eliminar una mesa con órdenes activas.' });
        }

        await prisma.table.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        console.error('API DELETE /api/tables error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/sales', async (req, res) => {
    try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        const where = { status: 'CLOSED' as any, closedAt: { gte: start, lte: end } };

        const summary = await prisma.order.aggregate({
            _sum: { total: true },
            where
        });

        const history = await prisma.order.findMany({
            where,
            include: {
                table: true,
                user: true, // Waiter who opened
                closedBy: true, // Who closed it
            },
            orderBy: { closedAt: 'desc' }
        });

        res.json({
            total: summary._sum.total || 0,
            count: history.length,
            history: (history as any[]).map(o => ({
                id: o.id,
                location: o.table ? `Mesa ${o.table.number}` : 'App',
                waiter: o.user ? o.user.firstName : 'N/A',
                closer: o.closedBy ? o.closedBy.firstName : 'N/A',
                total: o.total,
                method: o.paymentMethod,
                time: o.closedAt
            }))
        });
    } catch (e) {
        console.error('API /api/sales error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' }
        });
        // BigInt needs to be converted to string for JSON
        const sanitizedUsers = users.map(u => ({
            ...u,
            telegramId: u.telegramId.toString()
        }));
        res.json(sanitizedUsers);
    } catch (e) {
        console.error('API /api/users error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/roles', (req, res) => {
    // Return available roles from enum
    res.json(['ADMIN', 'MESERO', 'CONTADOR', 'CLIENTE', 'PENDING', 'REJECTED']);
});

app.patch('/api/users/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        const updatedUser = await prisma.user.update({
            where: { id },
            data: { role: role as any }
        });

        res.json({
            success: true,
            user: {
                ...updatedUser,
                telegramId: updatedUser.telegramId.toString()
            }
        });
    } catch (e) {
        console.error('API PATCH /api/users role error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Nullify references in orders to preserve history before deleting the user
        await prisma.$transaction([
            prisma.order.updateMany({
                where: { OR: [{ userId: id }, { clientId: id }, { closedById: id }] },
                data: { userId: null, clientId: null, closedById: null }
            }),
            prisma.orderItem.updateMany({
                where: { userId: id } as any,
                data: { userId: null } as any
            }),
            prisma.user.delete({
                where: { id }
            })
        ]);

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (e) {
        console.error('API DELETE /api/users error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/broadcast', async (req, res) => {
    try {
        const { message, imageUrl } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });

        const clients = await prisma.user.findMany({
            where: { role: 'CLIENTE' }
        });

        console.log(`Starting broadcast to ${clients.length} clients${imageUrl ? ' with image' : ''}`);

        let successCount = 0;
        let failCount = 0;

        for (const client of clients) {
            try {
                if (imageUrl) {
                    let photoSource: any = imageUrl;
                    // If it's a local path (starts with /uploads), use the absolute path for telegraf
                    if (imageUrl.startsWith('/uploads/')) {
                        photoSource = { source: path.join(__dirname, '../public', imageUrl) };
                    }

                    await bot.telegram.sendPhoto(client.telegramId.toString(), photoSource, {
                        caption: message
                    });
                } else {
                    await bot.telegram.sendMessage(client.telegramId.toString(), message);
                }
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (err) {
                console.error(`Failed to send broadcast to ${client.firstName} (${client.telegramId}):`, err);
                failCount++;
            }
        }

        res.json({
            success: true,
            total: clients.length,
            sent: successCount,
            failed: failCount
        });
    } catch (e) {
        console.error('API /api/broadcast error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/ticket/:orderId', async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const [order, config] = await Promise.all([
            prisma.order.findUnique({
                where: { id: orderId },
                include: {
                    table: true,
                    items: true,
                    user: true,
                    client: true
                }
            }),
            prisma.restaurantConfig.findFirst()
        ]);

        if (!order) return res.status(404).json({ error: 'Order not found' });

        console.log(`Generating ticket image for dashboard, order: ${orderId}`);
        const imageBuffer = await generateTicketImage(order, config || {});

        res.set('Content-Type', 'image/png');
        res.send(imageBuffer);
    } catch (e) {
        console.error('API /api/ticket error:', e);
        res.status(500).json({ error: 'Server error generating ticket' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Web Admin Dashboard running on port ${PORT} `);
});

// Start bot
console.log('Bot is starting [v1.0.5]...');
bot.launch({
    dropPendingUpdates: true
}).then(async () => {
    console.log('Bot is polling [v1.0.5]...');
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Abrir el bot' },
            { command: 'help', description: 'Ver comandos disponibles' },
            { command: 'admin_panel', description: '⚙️ Panel de Administración' },
            { command: 'new_order', description: '📝 Crear nueva orden (Meseros)' },
            { command: 'sales_report', description: '📊 Reporte de ventas (Contadores)' }
        ]);
        console.log('Commands menu set up successfully');
    } catch (e) {
        console.error('Failed to set my commands', e);
    }
}).catch(err => {
    console.error('CRITICAL: Bot failed to launch!', err);
    process.exit(1);
});

// Enable graceful stop
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
});
