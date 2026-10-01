import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Compared against when the user does not exist, so timing does not reveal which emails are registered.
let dummyHash: Promise<string> | undefined;
export const burnPasswordCheck = async (plain: string) => {
  dummyHash ??= bcrypt.hash("not-a-real-password", COST);
  return bcrypt.compare(plain, await dummyHash);
};

/** bcrypt ignores everything past 72 bytes, so cap the input there. */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Password needs at least one letter and one number");
