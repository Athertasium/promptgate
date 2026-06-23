import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

let _client: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (!_client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    const adapter = new PrismaPg(url);
    _client = new PrismaClient({ adapter });
  }
  return _client;
}
