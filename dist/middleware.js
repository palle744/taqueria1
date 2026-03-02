"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = void 0;
const db_1 = require("./db");
// Extender el contexto de Telegraf para incluir el usuario si se desea (opcional)
// Por ahora, leeremos de la base de datos en cada request, 
// o podemos usar un middleware para inyectar el user.
const requireRole = (roles) => {
    return async (ctx, next) => {
        if (!ctx.from)
            return;
        try {
            const user = await db_1.prisma.user.findUnique({
                where: { telegramId: ctx.from.id }
            });
            if (!user) {
                await ctx.reply('No estás registrado. Escribe /start para comenzar.');
                return;
            }
            if (!roles.includes(user.role)) {
                await ctx.reply(`Acceso denegado. Este comando requiere uno de los siguientes roles: ${roles.join(', ')}`);
                return;
            }
            // Si todo está bien, pasamos al siguiente middleware/handler
            return next();
        }
        catch (error) {
            console.error(error);
            await ctx.reply('Ocurrió un error al verificar tus permisos.');
        }
    };
};
exports.requireRole = requireRole;
