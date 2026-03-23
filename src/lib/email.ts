const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "entradas@luminari.agency";
const FROM_NAME = "LaJarana";

interface OrderInfo {
  id: string;
  total: number;
  eventTitle: string;
  eventDate?: string;
  eventVenue?: string;
}

interface TicketInfo {
  name: string;
  quantity: number;
  unitPrice: number;
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY no configurada — email no enviado a", to);
    return null;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [to],
        subject,
        html,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[Email] Error enviando email:", data);
      return null;
    }
    console.log("[Email] Enviado a", to, "id:", data.id);
    return data;
  } catch (err) {
    console.error("[Email] Error:", err);
    return null;
  }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "Por confirmar";
  return new Date(dateStr).toLocaleDateString("es-PE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0A;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<!-- Header -->
<tr><td style="text-align:center;padding:24px 0;">
<h1 style="margin:0;font-size:28px;color:#8B5CF6;">🎭 LaJarana</h1>
</td></tr>
<!-- Content Card -->
<tr><td style="background-color:#1a1a1a;border-radius:16px;padding:32px;">
${content}
</td></tr>
<!-- Footer -->
<tr><td style="text-align:center;padding:24px 0;">
<p style="margin:0;color:#666;font-size:12px;">© 2026 LaJarana by Luminari Agency</p>
<p style="margin:8px 0 0;color:#555;font-size:11px;">
<a href="https://dev-lajarana.luminari.agency" style="color:#8B5CF6;text-decoration:none;">dev-lajarana.luminari.agency</a>
</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export async function sendPurchaseConfirmation(
  order: OrderInfo,
  tickets: TicketInfo[],
  buyerEmail: string,
  buyerName: string,
) {
  const ticketRows = tickets.map(t => `
    <tr>
      <td style="padding:8px 0;color:#fff;border-bottom:1px solid #333;">${t.name}</td>
      <td style="padding:8px 0;color:#ccc;border-bottom:1px solid #333;text-align:center;">${t.quantity}</td>
      <td style="padding:8px 0;color:#ccc;border-bottom:1px solid #333;text-align:right;">S/ ${(t.unitPrice * t.quantity).toFixed(2)}</td>
    </tr>
  `).join("");

  const content = `
<h2 style="margin:0 0 8px;color:#fff;font-size:22px;">🎉 ¡Compra confirmada!</h2>
<p style="color:#ccc;margin:0 0 24px;">Hola <strong style="color:#fff;">${buyerName || "asistente"}</strong>, tus entradas están listas.</p>

<div style="background:#0A0A0A;border-radius:12px;padding:20px;margin-bottom:24px;">
<h3 style="margin:0 0 12px;color:#8B5CF6;font-size:16px;">${order.eventTitle}</h3>
<p style="margin:0 0 4px;color:#ccc;font-size:14px;">📅 ${formatDate(order.eventDate)}</p>
${order.eventVenue ? `<p style="margin:0;color:#ccc;font-size:14px;">📍 ${order.eventVenue}</p>` : ""}
</div>

<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
<td style="padding:8px 0;color:#888;font-size:12px;text-transform:uppercase;border-bottom:1px solid #333;">Entrada</td>
<td style="padding:8px 0;color:#888;font-size:12px;text-transform:uppercase;border-bottom:1px solid #333;text-align:center;">Cant.</td>
<td style="padding:8px 0;color:#888;font-size:12px;text-transform:uppercase;border-bottom:1px solid #333;text-align:right;">Subtotal</td>
</tr>
${ticketRows}
</table>

<div style="text-align:right;padding:12px 0;border-top:2px solid #8B5CF6;">
<span style="color:#888;font-size:14px;">Total pagado: </span>
<strong style="color:#8B5CF6;font-size:20px;">S/ ${Number(order.total).toFixed(2)}</strong>
</div>

<div style="text-align:center;margin-top:24px;">
<a href="https://dev-lajarana.luminari.agency/mi-cuenta/tickets" style="display:inline-block;background:#8B5CF6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;">Ver mis entradas</a>
</div>

<p style="color:#666;font-size:12px;margin-top:24px;text-align:center;">Orden: ${order.id}</p>
`;

  return sendEmail(
    buyerEmail,
    `🎉 Tus entradas para ${order.eventTitle} — LaJarana`,
    emailLayout(content),
  );
}

export async function sendWelcomeEmail(userName: string, userEmail: string) {
  const content = `
<h2 style="margin:0 0 8px;color:#fff;font-size:22px;">¡Bienvenido a LaJarana! 🎭</h2>
<p style="color:#ccc;margin:0 0 24px;">Hola <strong style="color:#fff;">${userName}</strong>, tu cuenta ha sido creada exitosamente.</p>

<p style="color:#ccc;font-size:14px;margin-bottom:24px;">
Ahora puedes comprar entradas para los mejores eventos y fiestas. ¡La juerga te espera!
</p>

<div style="text-align:center;margin-top:24px;">
<a href="https://dev-lajarana.luminari.agency" style="display:inline-block;background:#8B5CF6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;">Explorar eventos</a>
</div>
`;

  return sendEmail(
    userEmail,
    "¡Bienvenido a LaJarana! 🎭",
    emailLayout(content),
  );
}
