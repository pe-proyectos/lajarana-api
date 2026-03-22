import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";

export const userRoutes = new Elysia({ prefix: "/api/users" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET! }))
  .get("/me", async ({ headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    const [eventCount, ticketsSold] = await Promise.all([
      prisma.event.count({ where: { organizerId: user.id } }),
      prisma.ticket.count({ where: { event: { organizerId: user.id } } }),
    ]);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      company: user.company,
      role: user.role,
      plan: user.plan,
      planStartedAt: user.planStartedAt,
      planExpiresAt: user.planExpiresAt,
      freeEventsUsed: user.freeEventsUsed,
      mpEmail: user.mpEmail,
      stats: { eventsCreated: eventCount, ticketsSold },
    };
  })
  .patch("/me", async ({ body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.company !== undefined && { company: body.company }),
      },
    });

    return {
      id: updated.id, email: updated.email, name: updated.name,
      phone: updated.phone, company: updated.company, role: updated.role,
      plan: updated.plan, planStartedAt: updated.planStartedAt, planExpiresAt: updated.planExpiresAt,
    };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      phone: t.Optional(t.String()),
      company: t.Optional(t.String()),
    }),
  })
  // Payment method endpoint
  .patch("/me/payment-method", async ({ body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    /**
     * NOTE MVP: Por ahora solo guardamos el email de MP del organizador.
     * Cuando implementemos MercadoPago Marketplace (split payments),
     * usaremos OAuth para obtener el access token del organizador.
     */
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.mpEmail !== undefined && { mpEmail: body.mpEmail }),
        ...(body.mpAccessToken !== undefined && { mpAccessToken: body.mpAccessToken }),
      },
    });

    return {
      message: "Método de pago actualizado",
      mpEmail: updated.mpEmail,
    };
  }, {
    body: t.Object({
      mpEmail: t.Optional(t.String()),
      mpAccessToken: t.Optional(t.String()),
    }),
  });
