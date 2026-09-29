import type { IndicatorDefinition } from "./types";

export class DuplicateIndicatorError extends Error {
  constructor(id: string) {
    super(`Indicator "${id}" is already registered.`);
    this.name = "DuplicateIndicatorError";
  }
}

export class IndicatorRegistry {
  private readonly indicators = new Map<string, IndicatorDefinition>();

  register(indicator: IndicatorDefinition): void {
    if (this.indicators.has(indicator.id)) {
      throw new DuplicateIndicatorError(indicator.id);
    }
    this.indicators.set(indicator.id, indicator);
  }

  get(id: string): IndicatorDefinition | undefined {
    return this.indicators.get(id);
  }

  has(id: string): boolean {
    return this.indicators.has(id);
  }

  list(): readonly IndicatorDefinition[] {
    return Array.from(this.indicators.values());
  }
}