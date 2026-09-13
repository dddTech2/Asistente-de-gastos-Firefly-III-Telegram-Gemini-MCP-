import type { Redis } from "ioredis";
import { logger } from "../lib/logger.js";

export type RolMensaje = "user" | "model";

export interface HistorialMensaje {
  rol: RolMensaje;
  contenido: string;
  timestamp: string;
}

export interface HistoryStore {
  getRecentMessages(chatId: number): Promise<HistorialMensaje[]>;
  appendMessage(chatId: number, mensaje: HistorialMensaje): Promise<void>;
}

export interface HistoryStoreOpciones {
  /** Cuántos mensajes recientes conservar por chat. El ajuste fino de continuidad multi-turno es de la historia 5.5. */
  maxMensajes?: number;
  /** TTL de la clave en Redis -- mismo criterio de purga (~24h) que el modelo original en SQLite. */
  ttlSegundos?: number;
}

const MAX_MENSAJES_DEFAULT = 20;
const TTL_SEGUNDOS_DEFAULT = 60 * 60 * 24;

function claveHistorial(chatId: number): string {
  return `historial:${chatId}`;
}

/**
 * AC #6 (historia 5.1): lectura/escritura básica de los últimos N mensajes por
 * `chat_id`, respaldada en Redis (una lista por chat, recortada a `maxMensajes`
 * en cada escritura, con TTL corto). Si Redis no responde, no debe tirar abajo
 * el resto del orquestador (edge case de Testing) -- por eso quien use este
 * store (`messageOrchestrator.ts`) debe tratar sus rechazos como "sin
 * historial disponible", no dejar que se propaguen sin control.
 */
export function createHistoryStore(redis: Redis, opciones: HistoryStoreOpciones = {}): HistoryStore {
  const maxMensajes = opciones.maxMensajes ?? MAX_MENSAJES_DEFAULT;
  const ttlSegundos = opciones.ttlSegundos ?? TTL_SEGUNDOS_DEFAULT;

  return {
    async getRecentMessages(chatId) {
      const clave = claveHistorial(chatId);
      const items = await redis.lrange(clave, -maxMensajes, -1);
      return items.flatMap((item) => {
        try {
          return [JSON.parse(item) as HistorialMensaje];
        } catch (error) {
          logger.warn(
            { chat_id: chatId, err: error instanceof Error ? error : new Error(String(error)) },
            "Entrada de historial corrupta en Redis, se descarta",
          );
          return [];
        }
      });
    },

    async appendMessage(chatId, mensaje) {
      const clave = claveHistorial(chatId);
      await redis.rpush(clave, JSON.stringify(mensaje));
      await redis.ltrim(clave, -maxMensajes, -1);
      await redis.expire(clave, ttlSegundos);
    },
  };
}
