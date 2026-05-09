// Script to add credits to a user
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.user.update({
    where: { email: 'tk.lunartech@gmail.com' },
    data: { credits: { increment: 600 } },
  });
  console.log('Updated user:', result.email, 'Credits:', result.credits);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
