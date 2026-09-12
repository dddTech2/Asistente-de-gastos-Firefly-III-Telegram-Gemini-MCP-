import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM elegido por ser cifrado autenticado (detecta manipulacion del
 * ciphertext, no solo lo descifra) con soporte nativo en el modulo `crypto`
 * de Node -- sin dependencias extra. No hay una eleccion fijada por la
 * arquitectura para esto [Inference, ver Dev Notes de la historia 1.4].
 */
const ALGORITMO = "aes-256-gcm";
const LARGO_IV_BYTES = 12; // recomendado por NIST para GCM
const LARGO_CLAVE_BYTES = 32; // AES-256

export class PatCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatCryptoError";
  }
}

/**
 * Decodifica y valida la clave de cifrado desde su representacion hex en
 * variable de entorno (AC #4). Se llama una sola vez, al construir `env`, para
 * que el proceso falle en el arranque si la clave falta o tiene el largo
 * incorrecto -- nunca en medio de un cifrado/descifrado ya en curso.
 */
export function decodificarClaveCifrado(claveHex: string): Buffer {
  const clave = Buffer.from(claveHex, "hex");
  if (clave.length !== LARGO_CLAVE_BYTES) {
    throw new PatCryptoError(
      `PAT_ENCRYPTION_KEY debe decodificar a ${LARGO_CLAVE_BYTES} bytes ` +
        `(${LARGO_CLAVE_BYTES * 2} caracteres hex) para AES-256-GCM`,
    );
  }
  return clave;
}

/**
 * Cifra un PAT en texto plano. El nonce (IV) es aleatorio por llamada, asi
 * que cifrar el mismo PAT dos veces produce ciphertexts distintos.
 */
export function cifrarPat(pat: string, clave: Buffer): string {
  const iv = randomBytes(LARGO_IV_BYTES);
  const cipher = createCipheriv(ALGORITMO, clave, iv);
  const ciphertext = Buffer.concat([cipher.update(pat, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

/**
 * Descifra un PAT previamente cifrado con `cifrarPat`. Si la clave es
 * incorrecta o el ciphertext fue manipulado, GCM rechaza el tag de
 * autenticacion y esta funcion falla explicitamente (`PatCryptoError`) en vez
 * de devolver datos corruptos en silencio.
 */
export function descifrarPat(patCifrado: string, clave: Buffer): string {
  const partes = patCifrado.split(".");
  if (partes.length !== 3) {
    throw new PatCryptoError("Formato de PAT cifrado invalido");
  }
  const [ivB64, authTagB64, ciphertextB64] = partes;

  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = createDecipheriv(ALGORITMO, clave, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new PatCryptoError("No se pudo descifrar el PAT: clave incorrecta o dato corrupto");
  }
}
