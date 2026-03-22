import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";

export const ticketTypeRoutes = new Elysia({ prefix: "/api/events/:eventId/ticket-types" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET || "dev-secret" }))
  .get("/", async ({ params }) => {
    return prisma.ticketType.findMany({ where: { eventId: params.eventId } });
  })
  .post("/", async ({ params, body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const event = await prisma.event.findUnique({ where: { id: params.eventId } });
    if (!event) { set.status = 404; return { error: "Event not found" }; }
    if (event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "Not authorized" };
    }
    return prisma.ticketType.create({
      data: {
        ...body,
        eventId: params.eventId,
        salesStart: body.salesStart ? new Date(body.salesStart) : null,
        salesEnd: body.salesEnd ? new Date(body.salesEnd) : null,
      },
    });
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      price: t.Number({ minimum: 0 }),
      quantity: t.Number({ minimum: 1 }),
      description: t.Optional(t.String()),
      salesStart: t.Optional(t.String()),
      salesEnd: t.Optional(t.String()),
    }),
  })
  .patch("/:id", async ({ params, body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const tt = await prisma.ticketType.findUnique({ where: { id: params.id }, include: { event: true } });
    if (!tt) { set.status = 404; return { error: "Ticket type not found" }; }
    if (tt.event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "Not authorized" };
    }
    const data: any = { ...body };
    if (body.salesStart) data.salesStart = new Date(body.salesStart);
    if (body.salesEnd) data.salesEnd = new Date(body.salesEnd);
    return prisma.ticketType.update({ where: { id: params.id }, data });
  });
