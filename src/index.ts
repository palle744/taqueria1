import { Telegraf, Markup } from 'telegraf';
import { prisma } from './db';
import * as dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

// Basic Error Handling
const orderAddState = new Map<number, { orderId: string, tableNumber: number }>();

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

            user = await prisma.user.create({
                data: {
                    telegramId,
                    username,
                    firstName,
                    role: isFirst ? 'ADMIN' : 'PENDING'
                }
            });

            if (isFirst) {
                await ctx.reply(`¡Hola ${firstName}! Has sido registrado como ADMIN del sistema. Usa /help para ver tus comandos.`);
            } else {
                await ctx.reply(`¡Hola ${firstName}! Tu cuenta está en estado PENDIENTE. Un administrador debe aprobarte.`);
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
                            `Nuevo usuario registrado:\nNombre: ${firstName}\nUsername: @${username || 'N/A'}\nTelegram ID: ${telegramId}\n\n¿Qué rol deseas asignarle?`,
                            adminKeyboard
                        );
                    } catch (e) {
                        console.error(`Could not notify admin ${admin.telegramId}`);
                    }
                }
            }
        } else {
            await ctx.reply(`¡Hola de nuevo, ${firstName}! Tu rol actual es: ${user.role}`);
        }
    } catch (error) {
        console.error(error);
        await ctx.reply('Ocurrió un error al procesar tu solicitud.');
    }
});

// Action Handlers
bot.action(/approve_mesero_(.+)/, async (ctx) => {
    const targetUserId = ctx.match[1];
    try {
        const updatedUser = await prisma.user.update({
            where: { id: targetUserId },
            data: { role: 'MESERO' }
        });
        await ctx.editMessageText(`Usuario ${updatedUser.firstName} (@${updatedUser.username}) ha sido asignado como MESERO.`);
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), '¡Felicidades! Un administrador te ha asignado el rol de MESERO. Ya puedes usar los comandos correspondientes.');
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
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), '¡Felicidades! Un administrador te ha asignado el rol de CONTADOR. Ya puedes usar los comandos correspondientes.');
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
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), 'Lo sentimos, tu solicitud ha sido rechazada por el administrador.');
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al rechazar usuario.');
    }
});

// Import middleware
import { requireRole } from './middleware';

// Restricted commands
bot.command('admin_panel', requireRole(['ADMIN']), async (ctx) => {
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Gestión de Roles', 'admin_roles')],
        [Markup.button.callback('🪑 Gestión de Mesas', 'admin_mesas')],
        [Markup.button.callback('🧾 Cuentas Abiertas', 'admin_cuentas')]
    ]);
    await ctx.reply('⚙️ *Panel de Administración*\nSelecciona una opción:', { parse_mode: 'MarkdownV2', ...adminMenu });
});

// Admin Panel Callbacks
bot.action('admin_roles', async (ctx) => {
    try {
        const users = await prisma.user.findMany({ where: { role: { not: 'ADMIN' } } });
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
        const users = await prisma.user.findMany({ where: { role: { not: 'ADMIN' } } });
        const buttons = users.map(u => [Markup.button.callback(`${u.firstName} - ${u.role}`, `manage_user_${u.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);

        await ctx.editMessageText('Rol actualizado. Selecciona un usuario para gestionar:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al actualizar el rol');
    }
});

bot.action('admin_panel_back', async (ctx) => {
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Gestión de Roles', 'admin_roles')],
        [Markup.button.callback('🪑 Gestión de Mesas', 'admin_mesas')],
        [Markup.button.callback('🧾 Cuentas Abiertas', 'admin_cuentas')]
    ]);
    await ctx.editMessageText('⚙️ *Panel de Administración*\nSelecciona una opción:', { parse_mode: 'MarkdownV2', ...adminMenu });
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
            include: { table: true, user: true }
        });

        if (openOrders.length === 0) {
            await ctx.editMessageText('No hay cuentas abiertas actualmente.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'admin_panel_back')]]));
            return;
        }

        const buttons = openOrders.map(o => [Markup.button.callback(`Mesa ${o.table.number} - Atendida por ${o.user.firstName}`, `view_order_${o.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver', 'admin_panel_back')]);
        await ctx.editMessageText('Cuentas Abiertas:', Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar cuentas');
    }
});

bot.command('sales_report', requireRole(['ADMIN', 'CONTADOR']), async (ctx) => {
    await ctx.reply('Generando reporte de ventas...\n(Logica de base de datos de ventas irá aquí).');
});

bot.command('new_order', requireRole(['ADMIN', 'MESERO']), async (ctx) => {
    try {
        const tables = await prisma.table.findMany({ orderBy: { number: 'asc' } });
        if (tables.length === 0) {
            return ctx.reply('No hay mesas configuradas en el sistema. Usa /admin_panel para agregar mesas primero.');
        }

        const buttons = tables.map(t => [Markup.button.callback(`Mesa ${t.number} - ${t.status === 'AVAILABLE' ? 'Libre' : 'Ocupada'}`, `select_table_${t.id}`)]);
        await ctx.reply('🍽️ *Nueva Orden / Ver Cuenta*\nSelecciona una mesa:', { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(buttons) });
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al cargar mesas.');
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
                    include: { items: true, user: true }
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

            await ctx.editMessageText(`✅ Cuenta abierta en *Mesa ${table.number}* por ${user.firstName}\\.\nUsa el botón abajo para agregar productos\\.`, {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard([[Markup.button.callback('➕ Agregar Productos', `add_items_${newOrder.id}`)]])
            });
        } else {
            // Already has open order
            const order = table.orders[0];
            let msg = `🧾 *Cuenta Mesa ${table.number}*\nAbierta por: ${order.user.firstName}\n\n*Productos:*\n`;

            if (order.items.length === 0) {
                msg += '\\- Ninguno aún\n';
            } else {
                order.items.forEach(item => {
                    const itemName = item.name.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
                    msg += `\\- ${itemName} x${item.quantity} \\(\\$${item.price.toFixed(2)}\\)\n`;
                });
            }
            msg += `\n*TOTAL:* \\$${order.total.toFixed(2)}`;

            await ctx.editMessageText(msg, {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('➕ Agregar Productos', `add_items_${order.id}`)],
                    [Markup.button.callback('❌ Cerrar Cuenta (Cobrar)', `close_order_${order.id}`)]
                ])
            });
        }
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al procesar la mesa');
    }
});

bot.action(/add_items_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    const telegramId = ctx.from.id;
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
        if (!order || order.status !== 'OPEN') return ctx.answerCbQuery('La cuenta no está abierta o no existe');

        orderAddState.set(telegramId, { orderId, tableNumber: order.table.number });
        await ctx.answerCbQuery();
        await ctx.reply(`✍️ Escribe el nombre del producto y el precio para la Mesa ${order.table.number}.\nFormato sugerido: Nombre - Precio\nEjemplo: 3 Tacos al pastor - 60\n(Envía la palabra "fin" cuando termines)`);
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al preparar adición');
    }
});

bot.action(/close_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
        if (!order) return ctx.answerCbQuery('No se encontró la orden');

        await prisma.order.update({ where: { id: orderId }, data: { status: 'CLOSED' } });
        await prisma.table.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } });

        await ctx.editMessageText(`✅ *Cuenta de Mesa ${order.table.number} CERRADA*\n*Total cobrado:* \\$${order.total.toFixed(2)}`, { parse_mode: 'MarkdownV2' });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cerrar la cuenta');
    }
});

bot.on('message', async (ctx, next) => {
    const telegramId = ctx.from.id;

    if (orderAddState.has(telegramId) && ctx.message && 'text' in ctx.message) {
        const text = ctx.message.text.trim();
        const state = orderAddState.get(telegramId)!;

        if (text.toLowerCase() === 'fin') {
            orderAddState.delete(telegramId);
            return ctx.reply(`✅ Terminaste de agregar productos a la Mesa ${state.tableNumber}. Usa /new_order para ver la cuenta u otra mesa.`);
        }

        // Try to parse basic item string: "Name - Price"
        let price = 0;
        let name = text;
        const lastDashMatch = text.match(/(.+)(?:-|\$)\s*([\d.]+)$/);
        if (lastDashMatch) {
            name = lastDashMatch[1].trim();
            price = parseFloat(lastDashMatch[2]);
        } else {
            // default to 0 if not parsed
            price = 0;
        }

        if (isNaN(price)) price = 0;

        try {
            await prisma.orderItem.create({
                data: {
                    orderId: state.orderId,
                    name: name,
                    price: price,
                    quantity: 1 // default for now
                }
            });

            // Update order total
            await prisma.order.update({
                where: { id: state.orderId },
                data: { total: { increment: price } }
            });

            await ctx.reply(`Añadido: ${name} ($${price}). Escribe otro o escribe "fin".`);
        } catch (err) {
            console.error(err);
            await ctx.reply('Error al guardar el producto.');
        }
    } else {
        return next();
    }
});

bot.command('help', async (ctx) => {
    const telegramId = ctx.from.id;
    try {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) {
            return ctx.reply('No estás registrado. Escribe /start para comenzar.');
        }

        let helpMessage = '📋 *Comandos Disponibles*\n\n';
        helpMessage += '/start \\- Iniciar el bot\n';

        if (user.role === 'ADMIN') {
            helpMessage += '/admin\\_panel \\- Panel de Administración\n';
            helpMessage += '/sales\\_report \\- Reporte de ventas\n';
            helpMessage += '/new\\_order \\- Crear nueva orden\n';
        } else if (user.role === 'CONTADOR') {
            helpMessage += '/sales\\_report \\- Reporte de ventas\n';
        } else if (user.role === 'MESERO') {
            helpMessage += '/new\\_order \\- Crear nueva orden\n';
        } else if (user.role === 'PENDING') {
            helpMessage += '\nTu cuenta está pendiente de aprobación\\. No tienes comandos adicionales aún\\.';
        }

        await ctx.replyWithMarkdownV2(helpMessage);
    } catch (err) {
        console.error(err);
        await ctx.reply('Error al obtener la ayuda.');
    }
});

// Start bot
bot.launch().then(async () => {
    console.log('Bot is running...');
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
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
