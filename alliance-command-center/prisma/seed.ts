import bcrypt from "bcrypt";
import "dotenv/config";
import { prisma } from "@/app/src/lib/prisma";

const createUser = async (email: string, password: string) => {
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: {
      email,
    },
    update: {},
    create: {
      email,
      displayName: "AB",
      passwordHash,
    },
  });
};

async function main() {
  await createUser("ab@example.com", "Password123");
  const alliance = await prisma.alliance.upsert({
    where: {
      name_server: {
        name: "DAY1",
        server: "999",
      },
    },
    update: {},
    create: {
      name: "DAY1",
      server: "999",
    },
  });

  await prisma.member.createMany({
    data: [
      {
        playerName: "Dragon",
        allianceId: alliance.id,
        thp: 210000000,
        squadPower: 350000000,
      },
      {
        playerName: "Val",
        allianceId: alliance.id,
        thp: 180000000,
        squadPower: 300000000,
      },
      {
        playerName: "BF",
        allianceId: alliance.id,
        thp: 175000000,
        squadPower: 290000000,
      },
      {
        playerName: "Inosuke",
        allianceId: alliance.id,
        thp: 165000000,
        squadPower: 280000000,
      },
      {
        playerName: "Mando",
        allianceId: alliance.id,
        thp: 261000000,
        squadPower: 80000000,
      },
    ],
    skipDuplicates: true,
  });

  console.log("🌱 Seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
