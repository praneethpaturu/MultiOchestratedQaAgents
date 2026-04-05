import { Page, Locator } from "@playwright/test";

/**
 * Base Page Object that all page objects extend.
 * Provides common utilities for navigation, waiting, and element interaction.
 */
export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  abstract get url(): string;

  async navigate(): Promise<void> {
    await this.page.goto(this.url);
    await this.page.waitForLoadState("networkidle");
  }

  async waitForPageReady(): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded");
  }

  async getByTestId(testId: string): Promise<Locator> {
    return this.page.getByTestId(testId);
  }

  async scrollToElement(locator: Locator): Promise<void> {
    await locator.scrollIntoViewIfNeeded();
  }

  async waitForNetworkIdle(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
  }

  async takeScreenshot(name: string): Promise<Buffer> {
    return this.page.screenshot({
      path: `reports/screenshots/${name}.png`,
      fullPage: true,
    });
  }
}
