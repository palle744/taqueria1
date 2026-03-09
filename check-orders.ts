import 'dotenv/config';
import { prisma } from './src/db';

async function checkOrders() {
    const orders = await prisma.order.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { items: true, table: true, client: true }
    });

    console.log(JSON.stringify(orders, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2));

    const config = await prisma.restaurantConfig.findFirst();
    console.log('Restaurant Config:', config);
}

checkOrders();
