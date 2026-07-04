import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

const SECTORS = ["IT", "Banking", "FMCG", "Pharma", "Auto", "Energy"];
const SYMBOLS = [
  "TCS", "INFY", "WIPRO", "HCLTECH", "TECHM",
  "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK",
  "HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR",
  "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN",
  "MARUTI", "TATAMOTORS", "M&M", "BAJAJ-AUTO", "EICHERMOT",
  "RELIANCE", "ONGC", "NTPC", "POWERGRID", "COALINDIA",
];

async function main() {
  console.log("Seeding stock universe...");
  for (let i = 0; i < SYMBOLS.length; i++) {
    await prisma.stock.upsert({
      where: { symbol: SYMBOLS[i] },
      create: {
        id: randomUUID(),
        symbol: SYMBOLS[i],
        exchange: "NSE",
        name: `${SYMBOLS[i]} Ltd.`,
        sector: SECTORS[i % SECTORS.length],
        isActive: true,
      },
      update: {},
    });
  }
  console.log(`Seeded ${SYMBOLS.length} stocks.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
