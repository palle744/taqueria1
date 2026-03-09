import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenv.config();

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN as string);

async function test() {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) return console.log("No admin found");

    try {
        console.log("Sending text...");
        await bot.telegram.sendMessage(Number(admin.telegramId), "Test message from debug script");
        console.log("Text sent successfully");

        console.log("Sending photo...");
        const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await bot.telegram.sendPhoto(Number(admin.telegramId), { source: buf }, { caption: "Test Photo" });
        console.log("Photo sent successfully");
    } catch (e) {
        console.error("Error sending:", e);
    }
}
test().then(() => prisma.$disconnect());
