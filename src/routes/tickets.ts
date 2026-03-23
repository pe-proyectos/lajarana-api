import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";
import QRCode from "qrcode";

function generateQrToken() {
  return { token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 30_000) };
}

export const ticketRoutes = new Elysia({ prefix: "/api/tickets" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET! }))
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
  // FIX 4: QR code image generation
  .get("/:id/qr", async ({ params, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const ticket = await prisma.ticket.findUnique({ where: { id: params.id } });
    if (!ticket || ticket.buyerId !== user.id) { set.status = 404; return { error: "Ticket not found" }; }

    const qrData = JSON.stringify({
      ticketId: ticket.id,
      qrCode: ticket.qrCode,
      qrToken: ticket.qrToken || "",
    });

    const pngBuffer = await QRCode.toBuffer(qrData, { type: "png", width: 300, margin: 2 });
    set.headers["content-type"] = "image/png";
    set.headers["cache-control"] = "no-cache";
    return pngBuffer;
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
    if (!ticket) { set.status = 404; return { error: "Ticket no encontrado" }; }
    if (ticket.event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "Este ticket no es de tu evento" };
    }
    if (ticket.status === "USED") { set.status = 400; return { error: "Ticket ya usado", ticket }; }
    if (ticket.status !== "VALID") { set.status = 400; return { error: `Ticket no válido (estado: ${ticket.status})` }; }
    // Validate QR
    if (ticket.qrCode !== body.qrCode || ticket.qrToken !== body.qrToken) {
      set.status = 400; return { error: "Código QR no válido" };
    }
    if (ticket.qrTokenExpiresAt && ticket.qrTokenExpiresAt < new Date()) {
      set.status = 400; return { error: "QR expirado — el asistente debe actualizar su QR" };
    }
    const updated = await prisma.ticket.update({
      where: { id: params.id },
      data: { status: "USED", usedAt: new Date() },
      include: { event: { select: { title: true } }, ticketType: true, buyer: { select: { name: true, email: true } } },
    });
    return { valid: true, ticket: updated };
  }, {
    body: t.Object({
      qrCode: t.String(),
      qrToken: t.String(),
    }),
  });
