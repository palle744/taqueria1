import { Context } from 'telegraf';
import { prisma } from './db';

// Extender el contexto de Telegraf para incluir el usuario si se desea (opcional)
// Por ahora, leeremos de la base de datos en cada request, 
// o podemos usar un middleware para inyectar el user.

export const requireRole = (roles: string[]) => {
    return async (ctx: Context, next: () => Promise<void>) => {
        if (!ctx.from) return;

        try {
            const user = await prisma.user.findUnique({
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
        } catch (error) {
            console.error(error);
            await ctx.reply('Ocurrió un error al verificar tus permisos.');
        }
    };
};
