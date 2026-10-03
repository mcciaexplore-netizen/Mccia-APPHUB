import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// scrypt is built into Node, so there is no extra package and it is fast enough for a serverless function.
const N = 16384, R = 8, P = 1, KEY_LEN = 32;

const derive = (password: string, salt: Buffer, n: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, { N: n, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))),
  );

/** `scrypt$<N>$<salt>$<hash>`: everything needed to check the password later. The password itself is never stored. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N);
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [tag, n, salt, hash] = stored.split("$");
  if (tag !== "scrypt" || !n || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await derive(password, Buffer.from(salt, "base64"), Number(n));
  return got.length === want.length && timingSafeEqual(got, want);
}

// Compared against when the person does not exist, so timing does not reveal which emails have accounts.
let dummy: Promise<string> | undefined;
export const burnPasswordCheck = async (password: string) => {
  dummy ??= hashPassword("not-a-real-password-1");
  return verifyPassword(password, await dummy);
};

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Password needs at least one letter and one number");
