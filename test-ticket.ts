import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import nodeHtmlToImage from 'node-html-to-image';
dotenv.config();

const prisma = new PrismaClient();

async function test() {
    console.log("Creating dummy order...");
    const config = await prisma.restaurantConfig.upsert({ where: { id: 1 }, update: {}, create: {} });
    
    // Construct fake order
    const order = {
        id: "TEST-ID",
        table: null,
        client: { firstName: "Alan", telegramId: 899877484n },
        pickupCode: "1234",
        total: 100.50,
        paymentMethod: "CASH",
        items: [
            { quantity: 2, name: "Tacos al Pastor", price: 25.0 }
        ]
    };

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
                    body { font-family: 'Courier New', Courier, monospace; width: 320px; padding: 20px; background: white; color: black; margin: 0; }
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
                <div style="margin-bottom: 5px;">Mesa: ${order.table ? order.table : 'App'}</div>
                <div style="margin-bottom: 10px;">ID Orden: ${order.client.firstName.toUpperCase()}-${order.pickupCode}</div>
                
                <div class="divider"></div>
                <div style="font-size: 0.9em;">
                    ${itemsHtml}
                </div>
                
                <div class="divider"></div>
                <div style="display: flex; justify-content: space-between; font-size: 1.1em;" class="font-bold">
                    <span>TOTAL:</span>
                    <span>$${order.total.toFixed(2)}</span>
                </div>
                <div style="font-size: 0.9em; margin-top: 5px;">Pago: Efectivo</div>
                
                <div class="divider"></div>
                <div class="text-center" style="font-size: 0.9em; margin-top: 15px;">
                    ${config.thankYouMessage || '¡Gracias por su compra!'}
                </div>
            </body>
        </html>
    `;

    try {
        console.log("Calling nodeHtmlToImage...");
        const buffer = await nodeHtmlToImage({
            html: html,
            puppeteerArgs: {
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            }
        });
        console.log("Success! Buffer size:", buffer.length);
    } catch (e) {
        console.error("Error generating image:", e);
    }
}
test().then(() => prisma.$disconnect());
