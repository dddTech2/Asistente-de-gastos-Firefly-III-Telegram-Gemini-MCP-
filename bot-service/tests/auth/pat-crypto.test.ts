import { describe, expect, it } from "vitest";
import {
  PatCryptoError,
  cifrarPat,
  decodificarClaveCifrado,
  descifrarPat,
} from "../../src/auth/pat-crypto.js";

const CLAVE = decodificarClaveCifrado("11".repeat(32));
const OTRA_CLAVE = decodificarClaveCifrado("22".repeat(32));

describe("decodificarClaveCifrado", () => {
  it("acepta una clave hex de 32 bytes (64 caracteres)", () => {
    expect(decodificarClaveCifrado("aa".repeat(32))).toHaveLength(32);
  });

  it("rechaza una clave con largo incorrecto (AC #4, edge case)", () => {
    expect(() => decodificarClaveCifrado("aa".repeat(16))).toThrow(PatCryptoError);
  });

  it("rechaza una clave vacía", () => {
    expect(() => decodificarClaveCifrado("")).toThrow(PatCryptoError);
  });
});

describe("cifrarPat / descifrarPat", () => {
  it("un round-trip devuelve exactamente el PAT original", () => {
    const pat = "pat_de_prueba_1234567890abcdef";

    const cifrado = cifrarPat(pat, CLAVE);

    expect(descifrarPat(cifrado, CLAVE)).toBe(pat);
  });

  it("el valor cifrado nunca contiene el PAT en texto plano como substring (AC #2)", () => {
    const pat = "pat_super_secreto_no_debe_aparecer";

    const cifrado = cifrarPat(pat, CLAVE);

    expect(cifrado).not.toContain(pat);
  });

  it("cifrar el mismo PAT dos veces produce ciphertexts distintos (nonce aleatorio)", () => {
    const pat = "mismo-pat";

    expect(cifrarPat(pat, CLAVE)).not.toBe(cifrarPat(pat, CLAVE));
  });

  it("maneja un PAT vacío (edge case)", () => {
    const cifrado = cifrarPat("", CLAVE);

    expect(descifrarPat(cifrado, CLAVE)).toBe("");
  });

  it("maneja un PAT con caracteres especiales y unicode (edge case)", () => {
    const pat = "pat-con-.puntos.-y-ñ-emoji-🔒-y espacios";

    const cifrado = cifrarPat(pat, CLAVE);

    expect(descifrarPat(cifrado, CLAVE)).toBe(pat);
  });

  it("descifrar con la clave equivocada falla de forma segura, no devuelve basura (edge case)", () => {
    const cifrado = cifrarPat("pat-de-prueba", CLAVE);

    expect(() => descifrarPat(cifrado, OTRA_CLAVE)).toThrow(PatCryptoError);
  });

  it("descifrar un ciphertext manipulado falla (autenticación GCM)", () => {
    const cifrado = cifrarPat("pat-de-prueba", CLAVE);
    const [iv, authTag, ciphertext] = cifrado.split(".");
    const ciphertextManipulado = Buffer.from(ciphertext, "base64");
    ciphertextManipulado[0] ^= 0xff;
    const cifradoManipulado = [iv, authTag, ciphertextManipulado.toString("base64")].join(".");

    expect(() => descifrarPat(cifradoManipulado, CLAVE)).toThrow(PatCryptoError);
  });

  it("descifrar un formato inválido (sin las 3 partes) falla", () => {
    expect(() => descifrarPat("no-es-un-pat-cifrado-valido", CLAVE)).toThrow(PatCryptoError);
  });
});
