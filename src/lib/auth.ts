import { prisma } from "./prisma";

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function generateToken(): string {
  return crypto.randomUUID();
}

export async function getUserFromToken(jwt: any, authorization?: string) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const payload = await jwt.verify(token);
  if (!payload?.id) return null;
  return prisma.user.findUnique({ where: { id: payload.id } });
}
