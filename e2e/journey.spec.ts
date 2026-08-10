import { expect, test } from "@playwright/test";

/**
 * Full browser journey against a real server + in-memory Mongo:
 * sign up, create an order, record a partial payment, hit the over-payment
 * guard, settle the order, refund, filter the dashboard, switch language.
 */

const email = `e2e-${Date.now()}@test.dev`;
const password = "password-e2e-123";

test.describe.configure({ mode: "serial" });

test("signup, create order and settle it end to end", async ({ page }) => {
  // Sign up.
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(page.getByText("No orders yet")).toBeVisible();

  // Create an order: 2 x 500 USD = 1000, due next week.
  await page.getByRole("link", { name: "New order" }).first().click();
  await page.getByLabel("Customer").fill("Acme LLC");
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  await page.getByLabel("Due date").fill(dueDate);
  await page.getByLabel("Description").fill("Consulting");
  await page.getByLabel("Qty").fill("2");
  await page.getByLabel("Unit price").fill("500");
  await expect(page.getByText("$1,000.00")).toBeVisible();
  await page.getByRole("button", { name: "Create order" }).click();

  // Detail page: pending, 1000 due. Nothing paid yet, so no refund option.
  await expect(page.getByRole("heading", { name: "Acme LLC" })).toBeVisible();
  await expect(page.locator("[data-status=pending]")).toBeVisible();
  await expect(page.locator("[data-field=amountDue]")).toHaveText("$1,000.00");
  await expect(page.getByRole("button", { name: "Record refund" })).toHaveCount(0);

  // Partial payment of 400.
  await page.getByLabel(/Amount \(/).fill("400");
  await page.getByRole("button", { name: "Record payment" }).last().click();
  await expect(page.locator("[data-status=partially_paid]")).toBeVisible();
  await expect(page.locator("[data-field=amountDue]")).toHaveText("$600.00");
  await expect(page.getByText("This order has payments recorded")).toBeVisible();

  // Over-payment rejected with the maximum in the message.
  await page.getByLabel(/Amount \(/).fill("700");
  await page.getByRole("button", { name: "Record payment" }).last().click();
  await expect(page.getByText("Maximum allowed")).toContainText("600.00");
  await expect(page.locator("[data-field=amountDue]")).toHaveText("$600.00");

  // Settle the remaining 600. Fully paid: the payment option disappears.
  await page.getByLabel(/Amount \(/).fill("600");
  await page.getByRole("button", { name: "Record payment" }).last().click();
  await expect(page.locator("[data-status=paid]")).toBeVisible();
  await expect(page.locator("[data-field=amountDue]")).toHaveText("$0.00");
  await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

  // Refund 100: status regresses to partially paid.
  await page.getByRole("button", { name: "Record refund" }).first().click();
  await page.getByLabel(/Amount \(/).fill("100");
  await page.getByRole("button", { name: "Record refund" }).last().click();
  await expect(page.locator("[data-status=partially_paid]")).toBeVisible();
  await expect(page.locator("[data-field=amountPaid]")).toHaveText("$900.00");

  // Audit log recorded the lifecycle.
  await expect(page.getByText("Order created")).toBeVisible();
  await expect(page.getByText("Refund recorded")).toBeVisible();
});

test("dashboard filters by status", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();

  // The order from the previous test is partially paid.
  await expect(page.locator("[data-status=partially_paid]")).toBeVisible();
  await page.getByLabel("Status").selectOption("paid");
  await expect(page.getByText("No orders with this status.")).toBeVisible();
  await page.getByLabel("Status").selectOption("partially_paid");
  await expect(page.getByRole("link", { name: "Acme LLC" })).toBeVisible();
});

test("language switcher renders the UI in Spanish", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();

  await page.getByLabel("Language").selectOption("es-ES");
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
  await expect(page.locator("[data-status=partially_paid]")).toHaveText(
    "Pago parcial",
  );

  await page.getByLabel("Language").selectOption("en-US");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
});
