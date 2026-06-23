import Fastify from "fastify";
import Redis from "ioredis";
import { CircuitBreaker } from "./circuit-breaker.js";
import { ExactMatchCache } from "./cache.js";
import { ingestRoute } from "./routes/ingest.js";

const PORT = Number(process.env.PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const app = Fastify({ logger: true });

const redis = new Redis(REDIS_URL);
const breaker = new CircuitBreaker(redis);
const cache = new ExactMatchCache(redis);

app.register(ingestRoute, { breaker, cache });

app.get("/health", async () => ({ status: "ok" }));

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
