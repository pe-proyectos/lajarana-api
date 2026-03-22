import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes } from "./routes/auth";
import { eventRoutes } from "./routes/events";
import { ticketTypeRoutes } from "./routes/ticket-types";
import { ticketRoutes } from "./routes/tickets";
import { orderRoutes } from "./routes/orders";
import { publicRoutes } from "./routes/public";
import { planRoutes } from "./routes/plans";
import { userRoutes } from "./routes/users";
import { paymentRoutes } from "./routes/payments";

const app = new Elysia()
  .use(cors({
    origin: [/\.luminari\.agency$/, /localhost/],
    credentials: true,
  }))
  .onError(({ error, set }) => {
    console.error(error);
    if ('status' in error) set.status = (error as any).status;
    return { error: error.message || "Internal server error" };
  })
  .get("/", () => ({ status: "ok", service: "lajarana-api" }))
  .get("/api/health", () => ({ status: "ok", service: "lajarana-api" }))
  .use(authRoutes)
  .use(eventRoutes)
  .use(ticketTypeRoutes)
  .use(ticketRoutes)
  .use(orderRoutes)
  .use(publicRoutes)
  .use(planRoutes)
  .use(userRoutes)
  .use(paymentRoutes)
  .listen(3000);

console.log(`🎭 LaJarana API running on port ${app.server?.port}`);
