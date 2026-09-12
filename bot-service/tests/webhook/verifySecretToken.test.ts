import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createVerifySecretToken } from "../../src/webhook/verifySecretToken.js";

const SECRET = "test-secret-token";

function buildApp() {
  const app = express();
  app.post("/webhook/telegram", createVerifySecretToken(SECRET), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("verifySecretToken middleware", () => {
  it("deja pasar el request cuando el header coincide con el secret configurado", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/webhook/telegram")
      .set("X-Telegram-Bot-Api-Secret-Token", SECRET)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("rechaza con 401 cuando el header está ausente", async () => {
    const app = buildApp();

    const response = await request(app).post("/webhook/telegram").send({});

    expect(response.status).toBe(401);
  });

  it("rechaza con 401 cuando el header no coincide con el secret configurado", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/webhook/telegram")
      .set("X-Telegram-Bot-Api-Secret-Token", "valor-incorrecto")
      .send({});

    expect(response.status).toBe(401);
  });
});
