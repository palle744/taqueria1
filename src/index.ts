import { Telegraf, Markup } from 'telegraf';
import { prisma } from './db';
import * as dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

// Basic Error Handling
// Basic Error Handling
const productAddState = new Set<number>(); // For tracking admin adding products
const orderAddState = new Map<number, { orderId: string, tableNumber: number }>(); // For tracking active order

// Utility function to escape MarkdownV2
function escapeMarkdownV2(text: string | number): string {
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
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
        [Markup.button.callback('🍔 Gestión de Menú', 'admin_menu')],
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
    productAddState.delete(ctx.from.id);
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Gestión de Roles', 'admin_roles')],
        [Markup.button.callback('🪑 Gestión de Mesas', 'admin_mesas')],
        [Markup.button.callback('🍔 Gestión de Menú', 'admin_menu')],
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

bot.action(/view_order_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true, table: true, user: true }
        });

        if (!order) return ctx.answerCbQuery('Cuenta no encontrada');

        let msg = `🧾 *Cuenta Mesa ${escapeMarkdownV2(order.table.number)}*\nAbierta por: ${escapeMarkdownV2(order.user.firstName)}\n\n*Productos:*\n`;

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
                [Markup.button.callback('✏️ Editar Cuenta (Eliminar)', `edit_order_${order.id}`)],
                [Markup.button.callback('❌ Cerrar Cuenta (Cobrar)', `close_order_${order.id}`)],
                [Markup.button.callback('⬅️ Volver a Admin', `admin_cuentas`)]
            ])
        });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cargar la cuenta');
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

            await ctx.editMessageText(`✅ Cuenta abierta en *Mesa ${escapeMarkdownV2(table.number)}* por ${escapeMarkdownV2(user.firstName)}\\.\nUsa el botón abajo para agregar productos\\.`, {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard([[Markup.button.callback('➕ Agregar Productos', `add_items_${newOrder.id}`)]])
            });
        } else {
            // Already has open order
            const order = table.orders[0];
            let msg = `🧾 *Cuenta Mesa ${escapeMarkdownV2(table.number)}*\nAbierta por: ${escapeMarkdownV2(order.user.firstName)}\n\n*Productos:*\n`;

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
                    [Markup.button.callback('✏️ Editar Cuenta (Eliminar)', `edit_order_${order.id}`)],
                    [Markup.button.callback('❌ Cerrar Cuenta (Cobrar)', `close_order_${order.id}`)]
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
        if (!order || order.status !== 'OPEN') return ctx.answerCbQuery('La cuenta no está abierta o no existe');

        let msg = `✏️ *Editando Cuenta Mesa ${escapeMarkdownV2(order.table.number)}*\nSelecciona un producto para eliminarlo:\n\n`;
        const buttons: any[] = [];

        if (order.items.length === 0) {
            msg += '\\- Ninguno aún\n';
        } else {
            for (const item of order.items) {
                const itemName = item.name.length > 20 ? item.name.substring(0, 20) + '...' : item.name;
                buttons.push([Markup.button.callback(`❌ Eliminar ${itemName} ($${item.price.toFixed(2)})`, `rm_itm_${item.id}`)]);
            }
        }

        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', `select_table_${order.table.id}`)]);

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard(buttons)
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

        // Delete item
        await prisma.orderItem.delete({ where: { id: itemId } });

        // Update order total
        const updatedOrder = await prisma.order.update({
            where: { id: item.orderId },
            data: { total: { decrement: item.price } },
            include: { items: { orderBy: { createdAt: 'asc' } }, table: true }
        });

        await ctx.answerCbQuery(`🗑️ ${item.name} eliminado.`);

        // Rerender edit order menu
        let msg = `✏️ *Editando Cuenta Mesa ${escapeMarkdownV2(updatedOrder.table.number)}*\n✅ Eliminado: ${escapeMarkdownV2(item.name)}\nSelecciona otro producto para eliminarlo:\n\n`;
        const buttons: any[] = [];

        if (updatedOrder.items.length === 0) {
            msg += '\\- Ninguno aún\n';
        } else {
            for (const currentItem of updatedOrder.items) {
                const itemName = currentItem.name.length > 20 ? currentItem.name.substring(0, 20) + '...' : currentItem.name;
                buttons.push([Markup.button.callback(`❌ Eliminar ${itemName} ($${currentItem.price.toFixed(2)})`, `rm_itm_${currentItem.id}`)]);
            }
        }

        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', `select_table_${updatedOrder.table.id}`)]);

        await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard(buttons)
        });

    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al eliminar el producto');
    }
});

bot.action(/add_items_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    const telegramId = ctx.from.id;
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
        if (!order || order.status !== 'OPEN') return ctx.answerCbQuery('La cuenta no está abierta o no existe');

        // Store active order ID in session state to avoid 64-byte callback limit on Telegram
        orderAddState.set(telegramId, { orderId, tableNumber: order.table.number });

        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        if (products.length === 0) {
            return ctx.answerCbQuery('El menú está vacío. Añade productos desde el panel de admin.', { show_alert: true });
        }

        const buttons = products.map(p => [Markup.button.callback(`➕ ${p.name} ($${p.price.toFixed(2)})`, `add_prod_${p.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', `select_table_${order.table.id}`)]);

        await ctx.editMessageText(`📖 *Menú*\nSelecciona productos para la Mesa ${escapeMarkdownV2(order.table.number)}:`, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(buttons) });
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

        await prisma.orderItem.create({
            data: {
                orderId: order.id,
                name: product.name,
                price: product.price,
                quantity: 1
            }
        });

        await prisma.order.update({
            where: { id: order.id },
            data: { total: { increment: product.price } }
        });

        await ctx.answerCbQuery(`✅ Añadido: ${product.name}`);

        // Rerender the menu to show the updated status
        const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
        const buttons = products.map(p => [Markup.button.callback(`➕ ${p.name} ($${p.price.toFixed(2)})`, `add_prod_${p.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Volver a la cuenta', `select_table_${order.table.id}`)]);

        // Replace special characters for MarkdownV2, except the ones we use for formatting
        const safeProductName = escapeMarkdownV2(product.name);

        await ctx.editMessageText(`📖 *Menú*\n✅ Añadido: ${safeProductName}\nSigue seleccionando productos para la Mesa ${escapeMarkdownV2(order.table.number)}:`, {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard(buttons)
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

        await prisma.order.update({ where: { id: orderId }, data: { status: 'CLOSED' } });
        await prisma.table.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } });

        await ctx.editMessageText(`✅ *Cuenta de Mesa ${escapeMarkdownV2(order.table.number)} CERRADA*\n*Total cobrado:* \\$${escapeMarkdownV2(order.total.toFixed(2))}`, { parse_mode: 'MarkdownV2' });
    } catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al cerrar la cuenta');
    }
});

bot.on('message', async (ctx, next) => {
    const telegramId = ctx.from.id;

    if (ctx.message && 'text' in ctx.message) {
        const text = ctx.message.text.trim();

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
