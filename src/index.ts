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
    await ctx.reply('Bienvenido al Panel de Administración.\nAquí podrás ver configuraciones del restaurante (Próximamente).');
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
        helpMessage += '/start - Iniciar el bot\n';

        if (user.role === 'ADMIN') {
            helpMessage += '/admin\\_panel - Panel de Administración\n';
            helpMessage += '/sales\\_report - Reporte de ventas\n';
            helpMessage += '/new\\_order - Crear nueva orden\n';
        } else if (user.role === 'CONTADOR') {
            helpMessage += '/sales\\_report - Reporte de ventas\n';
        } else if (user.role === 'MESERO') {
            helpMessage += '/new\\_order - Crear nueva orden\n';
        } else if (user.role === 'PENDING') {
            helpMessage += '\nTu cuenta está pendiente de aprobación. No tienes comandos adicionales aún.';
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
