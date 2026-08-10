/**
 * Demo seed. Runs entirely through the public REST API, so it works against
 * any environment (local dev or the deployed URL) and exercises the same
 * code paths as real users:
 *
 *   node scripts/seed.mjs                       # local (http://localhost:3000)
 *   SEED_BASE_URL=https://<app>.vercel.app node scripts/seed.mjs
 *
 * Creates demo@example.com / demo-password-123 with orders in every status
 * (pending, partially paid, paid, overdue) across USD and AED, including a
 * refund. Re-running against an already-seeded account is a no-op.
 */

const BASE_URL = process.env.SEED_BASE_URL || "http://localhost:3000";
const EMAIL = process.env.SEED_EMAIL || "demo@example.com";
const PASSWORD = process.env.SEED_PASSWORD || "demo-password-123";

let cookie = "";

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error?.code ?? res.status;
    const err = new Error(`${method} ${path} failed: ${code} ${json?.error?.message ?? ""}`);
    err.code = json?.error?.code;
    throw err;
  }
  return json;
}

function daysFromNow(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`Seeding ${BASE_URL} as ${EMAIL}...`);
  try {
    await api("POST", "/api/auth/signup", { email: EMAIL, password: PASSWORD });
    console.log("Demo user created.");
  } catch (err) {
    if (err.code !== "EMAIL_TAKEN") throw err;
    await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
    console.log("Demo user already exists, signed in.");
  }

  const { orders } = await api("GET", "/api/orders");
  if (orders.length > 0) {
    console.log(`Account already has ${orders.length} orders, skipping seed.`);
    return;
  }

  // pending: no payments, due in the future.
  await api("POST", "/api/orders", {
    customer: "Falcon Trading LLC",
    currency: "AED",
    dueDate: daysFromNow(14),
    lineItems: [
      { description: "Monthly bookkeeping retainer", quantity: 1, unitPrice: "3500" },
      { description: "VAT return filing", quantity: 2, unitPrice: "450.50" },
    ],
  });

  // partially_paid: one payment below the total.
  const partial = await api("POST", "/api/orders", {
    customer: "Oasis Ventures FZ-LLC",
    currency: "USD",
    dueDate: daysFromNow(7),
    lineItems: [
      { description: "Implementation services", quantity: 2, unitPrice: "500" },
    ],
  });
  await api("POST", `/api/orders/${partial.order.id}/payments`, {
    amount: "400",
    date: daysFromNow(-2),
    note: "First installment (bank transfer)",
  });

  // paid: settled in two installments.
  const paid = await api("POST", "/api/orders", {
    customer: "Dune Analytics DMCC",
    currency: "USD",
    dueDate: daysFromNow(3),
    lineItems: [
      { description: "Annual license", quantity: 1, unitPrice: "1200" },
      { description: "Onboarding", quantity: 4, unitPrice: "200" },
    ],
  });
  await api("POST", `/api/orders/${paid.order.id}/payments`, {
    amount: "1000",
    date: daysFromNow(-5),
  });
  await api("POST", `/api/orders/${paid.order.id}/payments`, {
    amount: "1000",
    date: daysFromNow(-1),
    note: "Final settlement",
  });

  // overdue: due date in the past, partially paid, with a refund in history.
  const overdue = await api("POST", "/api/orders", {
    customer: "Mirage Hospitality Group",
    currency: "AED",
    dueDate: daysFromNow(-10),
    lineItems: [
      { description: "POS integration", quantity: 1, unitPrice: "8000" },
    ],
  });
  await api("POST", `/api/orders/${overdue.order.id}/payments`, {
    amount: "3000",
    date: daysFromNow(-12),
  });
  await api("POST", `/api/orders/${overdue.order.id}/refunds`, {
    amount: "500",
    date: daysFromNow(-11),
    note: "Scope reduction agreed with client",
  });

  console.log("Seed complete: 4 orders (pending, partially_paid, paid, overdue).");
  console.log(`Sign in at ${BASE_URL}/login with ${EMAIL} / ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
