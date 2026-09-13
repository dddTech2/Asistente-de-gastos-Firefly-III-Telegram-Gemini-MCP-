import { Redis } from "ioredis";
import { env } from "../config/env.js";

/**
 * Un solo cliente compartido por proceso — mismo patrón que `src/db/pool.ts`
 * para Postgres. Lo consume `historyStore.ts` (historia 5.1), cableado al
 * webhook real en la historia 5.13.
 */
export const redis = new Redis(env.redisUrl);
