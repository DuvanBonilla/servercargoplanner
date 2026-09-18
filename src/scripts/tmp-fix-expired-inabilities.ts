import { PrismaService } from '../prisma/prisma.service';
import { UpdateInabilityService } from '../inability/service/update-inability.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const service = new UpdateInabilityService(prisma);
  await service.updateWorkersWithExpiredInabilities();

  await prisma.onModuleDestroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
