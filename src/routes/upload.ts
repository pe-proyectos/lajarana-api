import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { getUserFromToken } from "../lib/auth";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

// NOTE: In production (Coolify), configure a Docker volume mount for /app/uploads
// to persist uploaded files across container restarts.
const UPLOAD_DIR = "/app/uploads";
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const BASE_URL = process.env.UPLOAD_BASE_URL || "https://lajarana-api.luminari.agency";

// Ensure upload directory exists
await mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});

export const uploadRoutes = new Elysia()
  .use(jwt({ name: "jwt", secret: process.env.JWT_SECRET! }))

  .post("/api/upload", async ({ body, headers, jwt, set }) => {
    const user = await getUserFromToken(jwt, headers.authorization);
    if (!user) { set.status = 401; return { error: "No autorizado" }; }

    const file = body.file;
    if (!file) { set.status = 400; return { error: "No se envió ningún archivo" }; }

    if (!ALLOWED_TYPES.includes(file.type)) {
      set.status = 400;
      return { error: "Tipo de archivo no permitido. Solo: JPG, PNG, WebP, GIF" };
    }

    if (file.size > MAX_SIZE) {
      set.status = 400;
      return { error: "El archivo excede el límite de 5MB" };
    }

    const ext = file.name?.split(".").pop()?.toLowerCase() || "jpg";
    const filename = `${crypto.randomUUID()}.${ext}`;
    const filepath = join(UPLOAD_DIR, filename);

    const buffer = await file.arrayBuffer();
    await writeFile(filepath, Buffer.from(buffer));

    return {
      url: `${BASE_URL}/uploads/${filename}`,
      filename,
    };
  }, {
    body: t.Object({
      file: t.File(),
    }),
  })

  // Serve uploaded files
  .get("/uploads/:filename", async ({ params, set }) => {
    const filepath = join(UPLOAD_DIR, params.filename);
    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      set.status = 404;
      return { error: "Archivo no encontrado" };
    }
    set.headers["cache-control"] = "public, max-age=31536000";
    return file;
  });
