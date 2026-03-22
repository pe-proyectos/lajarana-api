import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword, getUserFromToken } from "../lib/auth";

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET! }))
  .post("/register", async ({ body, jwt, set }) => {
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) { set.status = 409; return { error: "Email already registered" }; }
    const user = await prisma.user.create({
      data: {
        email: body.email,
        password: await hashPassword(body.password),
        name: body.name,
        phone: body.phone,
        role: body.role || "ATTENDEE",
        company: body.company,
      },
    });
    const token = await jwt.sign({ id: user.id, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }, {
    body: t.Object({
      email: t.String({ format: "email" }),
      password: t.String({ minLength: 6 }),
      name: t.String({ minLength: 1 }),
      phone: t.Optional(t.String()),
      role: t.Optional(t.Union([t.Literal("ORGANIZER"), t.Literal("ATTENDEE")])),
      company: t.Optional(t.String()),
    }),
  })
  .post("/login", async ({ body, jwt, set }) => {
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.password))) {
      set.status = 401; return { error: "Invalid credentials" };
    }
    const token = await jwt.sign({ id: user.id, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }, {
    body: t.Object({
      email: t.String({ format: "email" }),
      password: t.String(),
    }),
  })
  .get("/me", async ({ headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    return { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone, company: user.company, plan: user.plan, planStartedAt: user.planStartedAt, planExpiresAt: user.planExpiresAt };
  })
  .post("/forgot-password", async ({ body, set }) => {
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return { message: "Si el email existe, se envió un código de recuperación" };

    // Generate random 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const hashedCode = await hashPassword(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: { resetCode: hashedCode, resetCodeExpiresAt: expiresAt },
    });

    // TODO: Enviar código por email cuando se configure el servicio de correo.
    // Por ahora se retorna en la respuesta para testing.
    return { message: "Si el email existe, se envió un código de recuperación", code };
  }, { body: t.Object({ email: t.String({ format: "email" }) }) })
  .post("/reset-password", async ({ body, set }) => {
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.resetCode || !user.resetCodeExpiresAt) {
      set.status = 400; return { error: "Código inválido o expirado" };
    }

    if (user.resetCodeExpiresAt < new Date()) {
      set.status = 400; return { error: "Código expirado" };
    }

    const validCode = await verifyPassword(body.code, user.resetCode);
    if (!validCode) {
      set.status = 400; return { error: "Código inválido" };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await hashPassword(body.newPassword),
        resetCode: null,
        resetCodeExpiresAt: null,
      },
    });

    return { message: "Contraseña actualizada correctamente" };
  }, {
    body: t.Object({
      email: t.String({ format: "email" }),
      code: t.String({ minLength: 6, maxLength: 6 }),
      newPassword: t.String({ minLength: 6 }),
    }),
  });
