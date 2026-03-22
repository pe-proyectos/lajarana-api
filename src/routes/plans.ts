import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";

const PLANS = {
  free: {
    id: "free",
    name: "Primeros Eventos Gratis",
    description: "10 eventos gratis de por vida",
    price: 0,
    maxTicketsPerEvent: 50,
    maxActiveEvents: 1,
    lifetimeLimit: 10,
    commission: 0,
  },
  packages: [
    { id: "package-100", name: "Hasta 100 entradas", price: 300, maxTickets: 100 },
    { id: "package-1000", name: "Hasta 1,000 entradas", price: 500, maxTickets: 1000 },
    { id: "package-10000", name: "Hasta 10,000+ entradas", price: 1000, maxTickets: 10000 },
  ],
  perTicket: {
    id: "per-ticket",
    name: "Por ticket",
    pricePerTicket: 3,
    description: "S/3 por ticket — elige la cantidad exacta",
  },
  unlimited: {
    id: "unlimited",
    name: "Plan Ilimitado",
    price: 799,
    period: "mes",
    description: "Eventos y entradas ilimitadas",
    features: [
      "Eventos ilimitados",
      "Entradas ilimitadas",
      "0% comisión",
      "Analytics avanzados",
      "Soporte prioritario",
    ],
  },
};

export const planRoutes = new Elysia({ prefix: "/api/plans" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET || "dev-secret" }))
  .get("/", () => PLANS)

  // Activate a plan for a specific event
  .post("/events/:eventId/activate", async ({ params, body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }

    const event = await prisma.event.findUnique({ where: { id: params.eventId } });
    if (!event) { set.status = 404; return { error: "Evento no encontrado" }; }
    if (event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "No autorizado" };
    }

    const { planType, ticketCount } = body;
    let amount = 0;
    let ticketLimit: number | null = null;

    switch (planType) {
      case "free": {
        if (user.freeEventsUsed >= 10) {
          set.status = 400;
          return { error: "Ya usaste tus 10 eventos gratis. Elige un paquete." };
        }
        // Check max 1 active free event
        const activeFreeEvents = await prisma.event.count({
          where: {
            organizerId: user.id,
            eventPlanType: "free",
            status: { in: ["DRAFT", "PUBLISHED"] },
            id: { not: event.id },
          },
        });
        if (activeFreeEvents >= 1) {
          set.status = 400;
          return { error: "Solo puedes tener 1 evento gratuito activo a la vez" };
        }
        ticketLimit = 50;
        break;
      }
      case "package-100": { amount = 300; ticketLimit = 100; break; }
      case "package-1000": { amount = 500; ticketLimit = 1000; break; }
      case "package-10000": { amount = 1000; ticketLimit = 10000; break; }
      case "per-ticket": {
        if (!ticketCount || ticketCount < 1) {
          set.status = 400;
          return { error: "Indica la cantidad de tickets" };
        }
        amount = ticketCount * 3;
        ticketLimit = ticketCount;
        break;
      }
      case "unlimited": {
        if (user.plan !== "UNLIMITED") {
          set.status = 400;
          return { error: "Necesitas tener el Plan Ilimitado activo" };
        }
        ticketLimit = null; // unlimited
        break;
      }
      default:
        set.status = 400;
        return { error: "Tipo de plan inválido" };
    }

    // Update event with plan info
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        eventPlanType: planType,
        eventPlanAmount: amount,
        eventPlanTicketLimit: ticketLimit,
      },
    });

    // Increment free events used counter
    if (planType === "free") {
      await prisma.user.update({
        where: { id: user.id },
        data: { freeEventsUsed: { increment: 1 } },
      });
    }

    return {
      message: "Plan activado para el evento",
      event: updated,
      planType,
      amount,
      ticketLimit,
      // NOTE: Para paquetes de pago, por ahora se activa inmediatamente.
      // Cuando integremos pagos de organizer, se creará una preferencia de MP aquí.
    };
  }, {
    body: t.Object({
      planType: t.String(),
      ticketCount: t.Optional(t.Number()),
    }),
  })

  // Upgrade to Unlimited plan
  .post("/upgrade-unlimited", async ({ headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    if (user.plan === "UNLIMITED") { set.status = 400; return { error: "Ya tienes el Plan Ilimitado" }; }

    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);

    const [updatedUser, subscription] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { plan: "UNLIMITED", planStartedAt: now, planExpiresAt: endDate },
      }),
      prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "UNLIMITED",
          status: "ACTIVE",
          startDate: now,
          endDate,
          amount: 799,
        },
      }),
    ]);

    return {
      message: "¡Bienvenido al Plan Ilimitado!",
      plan: "UNLIMITED",
      planStartedAt: updatedUser.planStartedAt,
      planExpiresAt: updatedUser.planExpiresAt,
    };
  })

  // Cancel unlimited plan
  .post("/cancel", async ({ headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    if (user.plan === "FREE") { set.status = 400; return { error: "Ya estás en el plan gratuito" }; }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { plan: "FREE", planStartedAt: null, planExpiresAt: null },
      }),
      prisma.subscription.updateMany({
        where: { userId: user.id, status: "ACTIVE" },
        data: { status: "CANCELLED" },
      }),
    ]);

    return { message: "Plan cancelado", plan: "FREE" };
  });
