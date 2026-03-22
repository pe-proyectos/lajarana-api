import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken, generateToken } from "../lib/auth";

function generateQrToken() {
  return { token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 30_000) };
}

export const ticketRoutes = new Elysia({ prefix: "/api/tickets" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET || "dev-secret" }))
  .post("/purchase", async ({ body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    // Validate all ticket types and availability
    const items = body.items;
    let total = 0;
    const ticketTypes = await Promise.all(
      items.map(i => prisma.ticketType.findUnique({ where: { id: i.ticketTypeId } }))
    );
    for (let i = 0; i < items.length; i++) {
      const tt = ticketTypes[i];
      if (!tt) { set.status = 404; return { error: `Ticket type not found: ${items[i].ticketTypeId}` }; }
      if (tt.sold + items[i].quantity > tt.quantity) {
        set.status = 400; return { error: `Not enough tickets available for ${tt.name}` };
      }
      total += Number(tt.price) * items[i].quantity;
    }

    const eventId = ticketTypes[0]!.eventId;

    // Create order + tickets in transaction
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          buyerId: user.id,
          eventId,
          total,
          status: "PAID",
          paymentMethod: body.paymentMethod || "card",
          items: {
            create: items.map((item, i) => ({
              ticketTypeId: item.ticketTypeId,
              quantity: item.quantity,
              unitPrice: Number(ticketTypes[i]!.price),
              subtotal: Number(ticketTypes[i]!.price) * item.quantity,
            })),
          },
        },
        include: { items: true },
      });

      const tickets = [];
      for (let i = 0; i < items.length; i++) {
        const tt = ticketTypes[i]!;
        for (let j = 0; j < items[i].quantity; j++) {
          const { token, expiresAt } = generateQrToken();
          const ticket = await tx.ticket.create({
            data: {
              ticketTypeId: tt.id,
              eventId,
              buyerId: user.id,
              qrToken: token,
              qrTokenExpiresAt: expiresAt,
            },
          });
          tickets.push(ticket);
        }
        await tx.ticketType.update({ where: { id: tt.id }, data: { sold: { increment: items[i].quantity } } });
      }

      return { order, tickets };
    });

    return result;
  }, {
    body: t.Object({
      items: t.Array(t.Object({
        ticketTypeId: t.String(),
        quantity: t.Number({ minimum: 1 }),
      })),
      paymentMethod: t.Optional(t.String()),
    }),
  })
  .get("/my", async ({ headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    return prisma.ticket.findMany({
      where: { buyerId: user.id },
      include: { event: true, ticketType: true },
      orderBy: { purchasedAt: "desc" },
    });
  })
  .get("/:id", async ({ params, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const ticket = await prisma.ticket.findUnique({
      where: { id: params.id },
      include: { event: true, ticketType: true },
    });
    if (!ticket || ticket.buyerId !== user.id) { set.status = 404; return { error: "Ticket not found" }; }
    return ticket;
  })
  .post("/:id/refresh-qr", async ({ params, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const ticket = await prisma.ticket.findUnique({ where: { id: params.id } });
    if (!ticket || ticket.buyerId !== user.id) { set.status = 404; return { error: "Ticket not found" }; }
    if (ticket.status !== "VALID") { set.status = 400; return { error: "Ticket is not valid" }; }
    const { token, expiresAt } = generateQrToken();
    const updated = await prisma.ticket.update({
      where: { id: params.id },
      data: { qrToken: token, qrTokenExpiresAt: expiresAt },
    });
    return { qrCode: updated.qrCode, qrToken: token, expiresAt };
  })
  .post("/:id/validate", async ({ params, body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user || (user.role !== "ORGANIZER" && user.role !== "ADMIN")) {
      set.status = 403; return { error: "Only organizers can validate tickets" };
    }
    const ticket = await prisma.ticket.findUnique({
      where: { id: params.id },
      include: { event: true, ticketType: true, buyer: { select: { name: true, email: true } } },
    });
    if (!ticket) { set.status = 404; return { error: "Ticket not found" }; }
    if (ticket.event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "Not your event" };
    }
    if (ticket.status === "USED") { set.status = 400; return { error: "Ticket already used", ticket }; }
    if (ticket.status !== "VALID") { set.status = 400; return { error: `Ticket status: ${ticket.status}` }; }
    // Validate QR
    if (ticket.qrCode !== body.qrCode || ticket.qrToken !== body.qrToken) {
      set.status = 400; return { error: "Invalid QR code" };
    }
    if (ticket.qrTokenExpiresAt && ticket.qrTokenExpiresAt < new Date()) {
      set.status = 400; return { error: "QR token expired" };
    }
    const updated = await prisma.ticket.update({
      where: { id: params.id },
      data: { status: "USED", usedAt: new Date() },
      include: { ticketType: true, buyer: { select: { name: true, email: true } } },
    });
    return { valid: true, ticket: updated };
  }, {
    body: t.Object({
      qrCode: t.String(),
      qrToken: t.String(),
    }),
  });
