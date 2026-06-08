import { PrismaClient } from '../app/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
console.log(process.env.DATABASE_URL)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const alliance = await prisma.alliance.create({
    data: {
      name: 'DAY1',
      server: '999',
    },
  })

  await prisma.member.createMany({
    data: [
      {
        playerName: 'Dragon',
        allianceId: alliance.id,
        thp: 210000000,
        squadPower: 350000000,
      },
      {
        playerName: 'Val',
        allianceId: alliance.id,
        thp: 180000000,
        squadPower: 300000000,
      },
      {
        playerName: 'BF',
        allianceId: alliance.id,
        thp: 175000000,
        squadPower: 290000000,
      },
      {
        playerName: 'Inosuke',
        allianceId: alliance.id,
        thp: 165000000,
        squadPower: 280000000,
      },
      {
        playerName: 'Mando',
        allianceId: alliance.id,
        thp: 261000000,
        squadPower: 80000000,
      },
    ],
  })

  console.log('🌱 Seed completed')
}



main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })