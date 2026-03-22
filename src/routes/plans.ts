import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";

const PLANS = [
  {
    id: "FREE",
    name: "Plan Comisión",
    price: 0,
    currency: "PEN",
    commission: 5,
    maxEvents: 3,
    features: [
      "0 costo mensual",
      "3-5% comisión por entrada vendida",
      "Hasta 3 eventos activos",
      "Todas las features incluidas",
      "Soporte por chat",
    ],
  },
  {
    id: "PRO",
    name: "Plan Pro",
    price: 149,
    currency: "PEN",
    commission: 1,
    maxEvents: -1,
    features: [
      "Comisión reducida (1%)",
      "Eventos ilimitados",
      "Analytics avanzados",
      "Soporte prioritario",
      "API access",
      "Badge verificado",
    ],
  },
];

export const planRoutes = new Elysia({ prefix: "/api/plans" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET || "dev-secret" }))
  .get("/", () => PLANS)
  .post("/upgrade", async ({ headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    if (user.plan === "PRO") { set.status = 400; return { error: "Ya tienes el Plan Pro" }; }

    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);

    const [updatedUser, subscription] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { plan: "PRO", planStartedAt: now, planExpiresAt: endDate },
      }),
      prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "PRO",
          status: "ACTIVE",
          startDate: now,
          endDate,
          amount: 149,
        },
      }),
    ]);

    return {
      message: "Actualizado a Plan Pro",
      plan: "PRO",
      planStartedAt: updatedUser.planStartedAt,
      planExpiresAt: updatedUser.planExpiresAt,
      subscription: { id: subscription.id, status: subscription.status },
    };
  })
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

    return { message: "Plan cancelado. Volviste al Plan Comisión", plan: "FREE" };
  });
