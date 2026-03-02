"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const db_1 = require("./db");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN);
// Basic Error Handling
bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username ?? null;
    const firstName = ctx.from.first_name;
    try {
        let user = await db_1.prisma.user.findUnique({ where: { telegramId } });
        if (!user) {
            // Check if it's the first user ever
            const totalUsers = await db_1.prisma.user.count();
            const isFirst = totalUsers === 0;
            user = await db_1.prisma.user.create({
                data: {
                    telegramId,
                    username,
                    firstName,
                    role: isFirst ? 'ADMIN' : 'PENDING'
                }
            });
            if (isFirst) {
                await ctx.reply(`¡Hola ${firstName}! Has sido registrado como ADMIN del sistema. Usa /help para ver tus comandos.`);
            }
            else {
                await ctx.reply(`¡Hola ${firstName}! Tu cuenta está en estado PENDIENTE. Un administrador debe aprobarte.`);
                // Notify Admins
                const admins = await db_1.prisma.user.findMany({ where: { role: 'ADMIN' } });
                const adminKeyboard = telegraf_1.Markup.inlineKeyboard([
                    [telegraf_1.Markup.button.callback('Aprobar como Mesero', `approve_mesero_${user.id}`)],
                    [telegraf_1.Markup.button.callback('Aprobar como Contador', `approve_contador_${user.id}`)],
                    [telegraf_1.Markup.button.callback('Rechazar', `reject_${user.id}`)]
                ]);
                for (const admin of admins) {
                    try {
                        await ctx.telegram.sendMessage(Number(admin.telegramId), `Nuevo usuario registrado:\nNombre: ${firstName}\nUsername: @${username || 'N/A'}\nTelegram ID: ${telegramId}\n\n¿Qué rol deseas asignarle?`, adminKeyboard);
                    }
                    catch (e) {
                        console.error(`Could not notify admin ${admin.telegramId}`);
                    }
                }
            }
        }
        else {
            await ctx.reply(`¡Hola de nuevo, ${firstName}! Tu rol actual es: ${user.role}`);
        }
    }
    catch (error) {
        console.error(error);
        await ctx.reply('Ocurrió un error al procesar tu solicitud.');
    }
});
// Action Handlers
bot.action(/approve_mesero_(.+)/, async (ctx) => {
    const targetUserId = ctx.match[1];
    try {
        const updatedUser = await db_1.prisma.user.update({
            where: { id: targetUserId },
            data: { role: 'MESERO' }
        });
        await ctx.editMessageText(`Usuario ${updatedUser.firstName} (@${updatedUser.username}) ha sido asignado como MESERO.`);
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), '¡Felicidades! Un administrador te ha asignado el rol de MESERO. Ya puedes usar los comandos correspondientes.');
    }
    catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al asignar el rol.');
    }
});
bot.action(/approve_contador_(.+)/, async (ctx) => {
    const targetUserId = ctx.match[1];
    try {
        const updatedUser = await db_1.prisma.user.update({
            where: { id: targetUserId },
            data: { role: 'CONTADOR' }
        });
        await ctx.editMessageText(`Usuario ${updatedUser.firstName} (@${updatedUser.username}) ha sido asignado como CONTADOR.`);
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), '¡Felicidades! Un administrador te ha asignado el rol de CONTADOR. Ya puedes usar los comandos correspondientes.');
    }
    catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al asignar el rol.');
    }
});
bot.action(/reject_(.+)/, async (ctx) => {
    const targetUserId = ctx.match[1];
    try {
        const updatedUser = await db_1.prisma.user.update({
            where: { id: targetUserId },
            data: { role: 'REJECTED' }
        });
        await ctx.editMessageText(`Usuario ${updatedUser.firstName} (@${updatedUser.username}) ha sido RECHAZADO.`);
        await ctx.telegram.sendMessage(Number(updatedUser.telegramId), 'Lo sentimos, tu solicitud ha sido rechazada por el administrador.');
    }
    catch (err) {
        console.error(err);
        await ctx.answerCbQuery('Error al rechazar usuario.');
    }
});
// Import middleware
const middleware_1 = require("./middleware");
// Restricted commands
bot.command('admin_panel', (0, middleware_1.requireRole)(['ADMIN']), async (ctx) => {
    await ctx.reply('Bienvenido al Panel de Administración.\nAquí podrás ver configuraciones del restaurante (Próximamente).');
});
bot.command('sales_report', (0, middleware_1.requireRole)(['ADMIN', 'CONTADOR']), async (ctx) => {
    await ctx.reply('Generando reporte de ventas...\n(Logica de base de datos de ventas irá aquí).');
});
bot.command('new_order', (0, middleware_1.requireRole)(['ADMIN', 'MESERO']), async (ctx) => {
    await ctx.reply('📝 Nueva orden iniciada.\nPor favor escribe los productos.');
});
// Start bot
bot.launch().then(() => {
    console.log('Bot is running...');
});
// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
