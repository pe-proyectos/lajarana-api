import { Elysia } from "elysia";
import { prisma } from "../lib/prisma";

const CATEGORIES = ["Concierto", "Festival", "Fiesta", "Teatro", "Deportes", "Conferencia", "Otro"];

export const publicRoutes = new Elysia({ prefix: "/api/public" })
  .get("/events", async ({ query }) => {
    const where: any = { status: "PUBLISHED" };
    if (query.city) where.city = { contains: query.city, mode: "insensitive" };
    if (query.from) where.startDate = { gte: new Date(query.from as string) };
    if (query.category) where.category = query.category as string;

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 12));
    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          organizer: { select: { id: true, name: true, company: true } },
          ticketTypes: { select: { id: true, name: true, price: true, quantity: true, sold: true, isBox: true, boxQuantity: true, description: true } },
          entradaBoxes: { where: { active: true }, select: { id: true, name: true, description: true, quantity: true, price: true, maxBoxes: true, soldBoxes: true, ticketType: { select: { id: true, name: true } } } },
        },
        orderBy: { startDate: "asc" },
        take: limit,
        skip,
      }),
      prisma.event.count({ where }),
    ]);

    return { events, total, page, totalPages: Math.ceil(total / limit) };
  })
  .get("/events/:slug", async ({ params, set }) => {
    const event = await prisma.event.findUnique({
      where: { slug: params.slug },
      include: {
        organizer: { select: { id: true, name: true, company: true } },
        ticketTypes: true,
        entradaBoxes: { where: { active: true }, include: { ticketType: { select: { id: true, name: true, price: true } } } },
      },
    });
    if (!event || event.status === "DRAFT") { set.status = 404; return { error: "Event not found" }; }
    return event;
  });
