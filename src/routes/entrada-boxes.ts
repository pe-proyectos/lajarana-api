import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";

export const entradaBoxRoutes = new Elysia({ prefix: "/api/entrada-boxes" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET! }))

  // List boxes for an event (public)
  .get("/event/:eventId", async ({ params }) => {
    return prisma.entradaBox.findMany({
      where: { eventId: params.eventId, active: true },
      include: { ticketType: { select: { id: true, name: true, price: true, quantity: true, sold: true } } },
      orderBy: { createdAt: "asc" },
    });
  })

  // Create box (ORGANIZER only)
  .post("/", async ({ body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    const event = await prisma.event.findUnique({ where: { id: body.eventId } });
    if (!event) { set.status = 404; return { error: "Evento no encontrado" }; }
    if (event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "No autorizado" };
    }

    const ticketType = await prisma.ticketType.findUnique({ where: { id: body.ticketTypeId } });
    if (!ticketType || ticketType.eventId !== body.eventId) {
      set.status = 400; return { error: "Tipo de entrada no válido para este evento" };
    }

    return prisma.entradaBox.create({
      data: {
        eventId: body.eventId,
        name: body.name,
        description: body.description,
        ticketTypeId: body.ticketTypeId,
        quantity: body.quantity,
        price: body.price,
        maxBoxes: body.maxBoxes,
        active: body.active ?? true,
      },
      include: { ticketType: { select: { id: true, name: true, price: true } } },
    });
  }, {
    body: t.Object({
      eventId: t.String(),
      name: t.String({ minLength: 1 }),
      ticketTypeId: t.String(),
      quantity: t.Number({ minimum: 2 }),
      price: t.Number({ minimum: 0 }),
      description: t.Optional(t.String()),
      maxBoxes: t.Optional(t.Number({ minimum: 1 })),
      active: t.Optional(t.Boolean()),
    }),
  })

  // Update box (ORGANIZER only)
  .put("/:id", async ({ params, body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    const box = await prisma.entradaBox.findUnique({ where: { id: params.id }, include: { event: true } });
    if (!box) { set.status = 404; return { error: "Box no encontrado" }; }
    if (box.event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "No autorizado" };
    }

    return prisma.entradaBox.update({
      where: { id: params.id },
      data: body,
      include: { ticketType: { select: { id: true, name: true, price: true } } },
    });
  }, {
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      description: t.Optional(t.String()),
      price: t.Optional(t.Number({ minimum: 0 })),
      maxBoxes: t.Optional(t.Number({ minimum: 1 })),
      active: t.Optional(t.Boolean()),
    }),
  })

  // Delete box (only if no sales, ORGANIZER only)
  .delete("/:id", async ({ params, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    const box = await prisma.entradaBox.findUnique({ where: { id: params.id }, include: { event: true } });
    if (!box) { set.status = 404; return { error: "Box no encontrado" }; }
    if (box.event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "No autorizado" };
    }
    if (box.soldBoxes > 0) {
      set.status = 400; return { error: "No se puede eliminar un box con ventas" };
    }

    await prisma.entradaBox.delete({ where: { id: params.id } });
    return { message: "Box eliminado" };
  });
