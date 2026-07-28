import argon2 from "argon2";

const parameters = {
  type: argon2.argon2id as 2,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

export async function hashPassword(password: string) {
  return argon2.hash(password, parameters);
}

export async function verifyPassword(hash: string, password: string) {
  if (!hash.startsWith("$argon2id$")) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(hash: string) {
  return argon2.needsRehash(hash, parameters);
}
