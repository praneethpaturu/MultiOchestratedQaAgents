import { test as base, expect } from "@playwright/test";

/**
 * Extended Playwright fixtures for QA Agent generated tests.
 * Custom fixtures can be added here for auth, test data, etc.
 */
export const test = base.extend<{
  authenticatedPage: ReturnType<typeof base.extend>;
}>({
  // Example: shared auth fixture
  // authenticatedPage: async ({ page }, use) => {
  //   await page.goto("/login");
  //   await page.fill('[data-testid="email"]', "test@example.com");
  //   await page.fill('[data-testid="password"]', "password");
  //   await page.click('[data-testid="submit"]');
  //   await page.waitForURL("/dashboard");
  //   await use(page);
  // },
});

export { expect };
