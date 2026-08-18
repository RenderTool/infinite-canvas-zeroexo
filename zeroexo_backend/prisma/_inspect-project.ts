import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const envFile = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m) process.env[m[1]] = m[2];
}

const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
  for (const p of projects) {
    const scene = Array.isArray(p.scene) ? p.scene : [];
    console.log(`${p.id} | v${p.version} | ${scene.length} nodes | ${p.title} | updated=${p.updatedAt}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());