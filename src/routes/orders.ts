import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";

export const orderRoutes = new Elysia({ prefix: "/api/orders" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET! }))
  .get("/my", async ({ headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    return prisma.order.findMany({
      where: { buyerId: user.id },
      include: { items: { include: { ticketType: true } }, event: true },
      orderBy: { createdAt: "desc" },
    });
  })
  .get("/:id", async ({ params, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const order = await prisma.order.findUnique({
      where: { id: params.id },
      include: { items: { include: { ticketType: true } }, event: true },
    });
    if (!order || order.buyerId !== user.id) { set.status = 404; return { error: "Order not found" }; }
    return order;
  });
