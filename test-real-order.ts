import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import nodeHtmlToImage from 'node-html-to-image';
dotenv.config();

const prisma = new PrismaClient();

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
                <div style="margin-bottom: 5px;">Mesa: ${order.table ? order.table.number : 'App'}</div>
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

async function test() {
    const closedOrder = await prisma.order.findFirst({
        where: { tableId: null, status: 'CLOSED' },
        include: { items: true, client: true, table: true, user: true },
        orderBy: { closedAt: 'desc' }
    });

    if (!closedOrder) {
        console.log("No closed app orders found.");
        return;
    }

    console.log(`Found closed app order ID: ${closedOrder.id}. Generating ticket...`);
    const config = await prisma.restaurantConfig.upsert({ where: { id: 1 }, update: {}, create: {} });
    
    try {
        const buffer = await generateTicketImage(closedOrder, config);
        console.log("Successfully generated image buffer of size:", buffer.length);
    } catch (e) {
        console.error("Error generating image:", e);
    }
}
test().finally(() => prisma.$disconnect());
