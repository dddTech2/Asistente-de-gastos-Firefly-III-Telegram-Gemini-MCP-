import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it } from "vitest";
import { createHistoryStore, type HistorialMensaje } from "../../src/conversation/historyStore.js";

describe("historyStore (AC #6)", () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
  });

  it("un chat nuevo no tiene mensajes", async () => {
    const store = createHistoryStore(redis);
    await expect(store.getRecentMessages(111)).resolves.toEqual([]);
  });

  it("appendMessage seguido de getRecentMessages devuelve el mensaje guardado", async () => {
    const store = createHistoryStore(redis);
    const mensaje: HistorialMensaje = { rol: "user", contenido: "hola", timestamp: "2026-09-13T10:00:00.000Z" };

    await store.appendMessage(222, mensaje);

    await expect(store.getRecentMessages(222)).resolves.toEqual([mensaje]);
  });

  it("conserva el orden de inserción de varios mensajes", async () => {
    const store = createHistoryStore(redis);
    await store.appendMessage(333, { rol: "user", contenido: "uno", timestamp: "t1" });
    await store.appendMessage(333, { rol: "model", contenido: "dos", timestamp: "t2" });
    await store.appendMessage(333, { rol: "user", contenido: "tres", timestamp: "t3" });

    const resultado = await store.getRecentMessages(333);
    expect(resultado.map((m) => m.contenido)).toEqual(["uno", "dos", "tres"]);
  });

  it("recorta al máximo configurado, quedándose con los más recientes", async () => {
    const store = createHistoryStore(redis, { maxMensajes: 2 });
    await store.appendMessage(444, { rol: "user", contenido: "uno", timestamp: "t1" });
    await store.appendMessage(444, { rol: "model", contenido: "dos", timestamp: "t2" });
    await store.appendMessage(444, { rol: "user", contenido: "tres", timestamp: "t3" });

    const resultado = await store.getRecentMessages(444);
    expect(resultado.map((m) => m.contenido)).toEqual(["dos", "tres"]);
  });

  it("fija un TTL en la clave después de escribir", async () => {
    const store = createHistoryStore(redis, { ttlSegundos: 3600 });
    await store.appendMessage(555, { rol: "user", contenido: "hola", timestamp: "t1" });

    const ttl = await redis.ttl("historial:555");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it("no cruza el historial de chats distintos", async () => {
    const store = createHistoryStore(redis);
    await store.appendMessage(666, { rol: "user", contenido: "de 666", timestamp: "t1" });
    await store.appendMessage(777, { rol: "user", contenido: "de 777", timestamp: "t1" });

    await expect(store.getRecentMessages(666)).resolves.toEqual([
      { rol: "user", contenido: "de 666", timestamp: "t1" },
    ]);
    await expect(store.getRecentMessages(777)).resolves.toEqual([
      { rol: "user", contenido: "de 777", timestamp: "t1" },
    ]);
  });

  it("descarta silenciosamente una entrada corrupta en vez de romper la lectura", async () => {
    await redis.rpush("historial:888", "esto no es JSON válido");
    const store = createHistoryStore(redis);

    await expect(store.getRecentMessages(888)).resolves.toEqual([]);
  });
});
