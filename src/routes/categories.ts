import { Elysia } from "elysia";

const CATEGORIES = ["Concierto", "Festival", "Fiesta", "Teatro", "Deportes", "Conferencia", "Otro"];

export const categoryRoutes = new Elysia({ prefix: "/api" })
  .get("/categories", () => CATEGORIES);
