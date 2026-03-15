require('dotenv').config({ path: '/home/agent-swarm/domains/jobradius.agent-swarm.net/public_html/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const jobs = await prisma.jobResult.findMany({
        take: 30,
        orderBy: { createdAt: 'desc' },
        select: { title: true, location: true, lat: true, lng: true }
    });
    console.log(JSON.stringify(jobs, null, 2));
    process.exit(0);
}
check();
