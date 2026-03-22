import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

/**
 * NOTE: Para el MVP, todos los pagos se reciben en la cuenta de LaJarana.
 * La liquidación a organizadores se hace manualmente.
 * Cuando implementemos MercadoPago Marketplace (split payments),
 * usaremos el mpAccessToken del organizador para crear pagos divididos.
 */

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_LAJARANA_ACCESS_TOKEN || "",
});

const preferenceClient = new Preference(mpClient);
const paymentClient = new Payment(mpClient);

export const paymentRoutes = new Elysia({ prefix: "/api/payments" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET || "dev-secret" }))

  // Create preference for ticket purchase
  .post("/create-preference", async ({ body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    const { eventId, items } = body;

    // Validate event
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { ticketTypes: true },
    });
    if (!event || event.status !== "PUBLISHED") {
      set.status = 404;
      return { error: "Evento no encontrado o no publicado" };
    }

    // Validate items and calculate total
    let total = 0;
    const orderItems: { ticketTypeId: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
    const mpItems: any[] = [];

    for (const item of items) {
      const tt = event.ticketTypes.find(t => t.id === item.ticketTypeId);
      if (!tt) { set.status = 400; return { error: `Tipo de entrada no encontrado: ${item.ticketTypeId}` }; }
      const available = tt.quantity - tt.sold;
      if (item.quantity > available) {
        set.status = 400;
        return { error: `Solo quedan ${available} entradas de "${tt.name}"` };
      }
      if (item.quantity <= 0) continue;

      const unitPrice = Number(tt.price);
      const subtotal = unitPrice * item.quantity;
      total += subtotal;

      orderItems.push({
        ticketTypeId: tt.id,
        quantity: item.quantity,
        unitPrice,
        subtotal,
      });

      mpItems.push({
        id: tt.id,
        title: `${event.title} - ${tt.name}`,
        quantity: item.quantity,
        unit_price: unitPrice,
        currency_id: "PEN",
      });
    }

    if (orderItems.length === 0) {
      set.status = 400;
      return { error: "No hay entradas seleccionadas" };
    }

    // Handle free tickets (total = 0)
    if (total === 0) {
      const order = await prisma.order.create({
        data: {
          buyerId: user.id,
          eventId,
          total: 0,
          status: "PAID",
          paymentMethod: "FREE",
          items: { create: orderItems },
        },
        include: { items: true },
      });

      // Generate tickets for free order
      await generateTickets(order.id, user.id, eventId);

      return {
        orderId: order.id,
        status: "PAID",
        free: true,
      };
    }

    // Create order in DB
    const order = await prisma.order.create({
      data: {
        buyerId: user.id,
        eventId,
        total,
        status: "PENDING",
        paymentMethod: "MERCADOPAGO",
        items: { create: orderItems },
      },
    });

    // Create MercadoPago preference
    const preference = await preferenceClient.create({
      body: {
        items: mpItems,
        back_urls: {
          success: `https://dev-lajarana.luminari.agency/checkout/success?order=${order.id}`,
          failure: `https://dev-lajarana.luminari.agency/checkout/failure?order=${order.id}`,
          pending: `https://dev-lajarana.luminari.agency/checkout/pending?order=${order.id}`,
        },
        auto_return: "approved",
        notification_url: "https://lajarana-api.luminari.agency/api/payments/webhook",
        external_reference: order.id,
        payer: {
          email: user.email,
          name: user.name,
        },
      },
    });

    // Save preference ID
    await prisma.order.update({
      where: { id: order.id },
      data: { mpPreferenceId: preference.id },
    });

    return {
      orderId: order.id,
      preferenceId: preference.id,
      initPoint: preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point,
    };
  }, {
    body: t.Object({
      eventId: t.String(),
      items: t.Array(t.Object({
        ticketTypeId: t.String(),
        quantity: t.Number(),
      })),
    }),
  })

  // MercadoPago webhook (no auth - MP sends notifications here)
  .post("/webhook", async ({ body, query, set }) => {
    try {
      // MP sends type=payment and data.id or via query params
      const topic = query.topic || query.type || (body as any)?.type;
      const paymentId = query["data.id"] || (body as any)?.data?.id;

      if (topic === "payment" && paymentId) {
        const payment = await paymentClient.get({ id: Number(paymentId) });

        if (!payment || !payment.external_reference) {
          return { ok: true };
        }

        const orderId = payment.external_reference;
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return { ok: true };

        if (payment.status === "approved") {
          if (order.status !== "PAID") {
            await prisma.order.update({
              where: { id: orderId },
              data: {
                status: "PAID",
                mpPaymentId: String(paymentId),
                paymentReference: String(paymentId),
              },
            });
            await generateTickets(orderId, order.buyerId, order.eventId);
          }
        } else if (payment.status === "rejected" || payment.status === "cancelled") {
          await prisma.order.update({
            where: { id: orderId },
            data: { status: "FAILED", mpPaymentId: String(paymentId) },
          });
        }
        // pending status - leave as PENDING
      }

      return { ok: true };
    } catch (err) {
      console.error("Webhook error:", err);
      return { ok: true }; // Always return 200 to MP
    }
  })

  // Check order/payment status
  .get("/status/:orderId", async ({ params, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        items: { include: { ticketType: true } },
        event: { select: { title: true, slug: true } },
      },
    });

    if (!order || order.buyerId !== user.id) {
      set.status = 404;
      return { error: "Orden no encontrada" };
    }

    // If pending, check with MP
    if (order.status === "PENDING" && order.mpPaymentId) {
      try {
        const payment = await paymentClient.get({ id: Number(order.mpPaymentId) });
        if (payment.status === "approved" && order.status !== "PAID") {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: "PAID" },
          });
          await generateTickets(order.id, order.buyerId, order.eventId);
          order.status = "PAID";
        }
      } catch {}
    }

    const tickets = order.status === "PAID"
      ? await prisma.ticket.findMany({
          where: { buyerId: user.id, eventId: order.eventId },
          select: { id: true, qrCode: true, status: true, ticketType: { select: { name: true } } },
        })
      : [];

    return { order, tickets };
  });


async function generateTickets(orderId: string, buyerId: string, eventId: string) {
  const orderItems = await prisma.orderItem.findMany({
    where: { orderId },
    include: { ticketType: true },
  });

  for (const item of orderItems) {
    // Create individual tickets
    const ticketData = Array.from({ length: item.quantity }, () => ({
      ticketTypeId: item.ticketTypeId,
      eventId,
      buyerId,
      qrCode: crypto.randomUUID(),
    }));

    await prisma.ticket.createMany({ data: ticketData });

    // Update sold count
    await prisma.ticketType.update({
      where: { id: item.ticketTypeId },
      data: { sold: { increment: item.quantity } },
    });
  }
}
