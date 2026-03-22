import { Elysia } from "elysia";
import { prisma } from "../lib/prisma";

export const publicRoutes = new Elysia({ prefix: "/api/public" })
  .get("/events", async ({ query }) => {
    const where: any = { status: "PUBLISHED" };
    if (query.city) where.city = { contains: query.city, mode: "insensitive" };
    if (query.from) where.startDate = { gte: new Date(query.from as string) };
    return prisma.event.findMany({
      where,
      include: {
        organizer: { select: { id: true, name: true, company: true } },
        ticketTypes: { select: { id: true, name: true, price: true, quantity: true, sold: true } },
      },
      orderBy: { startDate: "asc" },
      take: Number(query.limit) || 20,
      skip: Number(query.offset) || 0,
    });
  })
  .get("/events/:slug", async ({ params, set }) => {
    const event = await prisma.event.findUnique({
      where: { slug: params.slug },
      include: {
        organizer: { select: { id: true, name: true, company: true } },
        ticketTypes: true,
      },
    });
    if (!event || event.status === "DRAFT") { set.status = 404; return { error: "Event not found" }; }
    return event;
  });
