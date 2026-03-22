import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { getUserFromToken } from "../lib/auth";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export const eventRoutes = new Elysia({ prefix: "/api/events" })
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET || "dev-secret" }))
  .get("/", async ({ query }) => {
    const where: any = { status: "PUBLISHED" };
    if (query.city) where.city = { contains: query.city, mode: "insensitive" };
    if (query.status) where.status = query.status;
    if (query.from) where.startDate = { gte: new Date(query.from) };
    return prisma.event.findMany({
      where,
      include: { organizer: { select: { id: true, name: true, company: true } }, ticketTypes: true },
      orderBy: { startDate: "asc" },
      take: Number(query.limit) || 20,
      skip: Number(query.offset) || 0,
    });
  })
  .get("/:id", async ({ params, set }) => {
    // Try by slug first, then by id
    let event = await prisma.event.findUnique({
      where: { slug: params.id },
      include: { organizer: { select: { id: true, name: true, company: true } }, ticketTypes: true },
    });
    if (!event) {
      event = await prisma.event.findUnique({
        where: { id: params.id },
        include: { organizer: { select: { id: true, name: true, company: true } }, ticketTypes: true },
      });
    }
    if (!event) { set.status = 404; return { error: "Event not found" }; }
    return event;
  })
  .post("/", async ({ body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user || (user.role !== "ORGANIZER" && user.role !== "ADMIN")) {
      set.status = 403; return { error: "Only organizers can create events" };
    }
    // Plan limit check
    if (user.plan !== "PRO") {
      const activeEvents = await prisma.event.count({
        where: { organizerId: user.id, status: { in: ["DRAFT", "PUBLISHED"] } },
      });
      if (activeEvents >= 3) {
        set.status = 403;
        return { error: "Has alcanzado el límite de 3 eventos del Plan Comisión. Actualiza a Pro para eventos ilimitados." };
      }
    }
    let slug = slugify(body.title);
    const existing = await prisma.event.findUnique({ where: { slug } });
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;
    return prisma.event.create({
      data: { ...body, slug, organizerId: user.id, startDate: new Date(body.startDate), endDate: new Date(body.endDate) },
    });
  }, {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      venue: t.String({ minLength: 1 }),
      address: t.Optional(t.String()),
      city: t.String({ minLength: 1 }),
      startDate: t.String(),
      endDate: t.String(),
      coverImage: t.Optional(t.String()),
      status: t.Optional(t.Union([t.Literal("DRAFT"), t.Literal("PUBLISHED")])),
      maxCapacity: t.Optional(t.Number()),
    }),
  })
  .patch("/:id", async ({ params, body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const event = await prisma.event.findUnique({ where: { id: params.id } });
    if (!event) { set.status = 404; return { error: "Event not found" }; }
    if (event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "Not authorized" };
    }
    const data: any = { ...body };
    if (body.startDate) data.startDate = new Date(body.startDate);
    if (body.endDate) data.endDate = new Date(body.endDate);
    return prisma.event.update({ where: { id: params.id }, data });
  })
  .delete("/:id", async ({ params, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const event = await prisma.event.findUnique({ where: { id: params.id } });
    if (!event) { set.status = 404; return { error: "Event not found" }; }
    if (event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "Not authorized" };
    }
    return prisma.event.update({ where: { id: params.id }, data: { status: "CANCELLED" } });
  })
  .get("/:id/stats", async ({ params, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "Unauthorized" }; }
    const event = await prisma.event.findUnique({ where: { id: params.id }, include: { ticketTypes: true } });
    if (!event) { set.status = 404; return { error: "Event not found" }; }
    if (event.organizerId !== user.id && user.role !== "ADMIN") {
      set.status = 403; return { error: "Not authorized" };
    }
    const [ticketCount, orderCount, revenue] = await Promise.all([
      prisma.ticket.count({ where: { eventId: params.id } }),
      prisma.order.count({ where: { eventId: params.id, status: "PAID" } }),
      prisma.order.aggregate({ where: { eventId: params.id, status: "PAID" }, _sum: { total: true } }),
    ]);
    return {
      totalTicketsSold: ticketCount,
      totalOrders: orderCount,
      totalRevenue: revenue._sum.total || 0,
      ticketTypes: event.ticketTypes.map(tt => ({ name: tt.name, sold: tt.sold, quantity: tt.quantity })),
    };
  });
