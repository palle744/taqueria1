import { Telegraf, Markup } from 'telegraf';
import { prisma } from './db';
import * as dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

// Basic Error Handling
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
    await ctx.reply('📝 Nueva orden iniciada.\nPor favor escribe los productos.');
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
bot.launch().then(() => {
    console.log('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
