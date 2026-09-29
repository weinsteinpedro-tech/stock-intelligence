import { IndicatorRegistry } from "./registry";
import type {
  IndicatorCalculation,
  IndicatorContext,
  IndicatorDefinition,
  IndicatorResult,
} from "./types";

export class IndicatorCycleError extends Error {
  constructor(id: string) {
    super(`Circular indicator dependency detected at "${id}".`);
    this.name = "IndicatorCycleError";
  }
}

export class UnknownIndicatorError extends Error {
  constructor(id: string) {
    super(`Unknown indicator "${id}".`);
    this.name = "UnknownIndicatorError";
  }
}

export interface CalculateRequest {
  indicators: readonly string[];
  context: IndicatorContext;
}

const NON_FINITE_WARNING = "Indicator returned a non-finite value; result rejected.";

function isNonFinite(value: unknown): boolean {
  return typeof value === "number" && !Number.isFinite(value);
}

export class AnalyticsEngine {
  constructor(private readonly registry: IndicatorRegistry) {}

  calculate<T = number>(
    request: CalculateRequest,
  ): ReadonlyMap<string, IndicatorResult<T>> {
    const cache = new Map<string, IndicatorResult>();
    const state = new Map<string, "visiting" | "done">();
    const compute = (id: string): IndicatorResult => {
      const hit = cache.get(id);
      if (hit) return hit;
      if (state.get(id) === "visiting") {
        throw new IndicatorCycleError(id);
      }
      const definition = this.registry.get(id);
      if (!definition) {
        throw new UnknownIndicatorError(id);
      }
      state.set(id, "visiting");

      const missingData = (definition.dependencies?.data ?? []).filter(
        (dependency) => !(dependency in request.context.data),
      );
      if (missingData.length > 0) {
        const result = this.engineResult(definition, request.context, {
          value: null,
          status: "insufficient_data",
          warnings: [`Missing data input: ${missingData.join(", ")}.`],
        });
        cache.set(id, result);
        state.set(id, "done");
        return result;
      }

      const dependencyResults = new Map<string, IndicatorResult>();
      for (const dependencyId of definition.dependencies?.indicators ?? []) {
        dependencyResults.set(dependencyId, compute(dependencyId));
      }

      const insufficientDependencies = Array.from(
        dependencyResults.values(),
      ).filter((result) => result.status === "insufficient_data");
      if (insufficientDependencies.length > 0) {
        const result = this.engineResult(definition, request.context, {
          value: null,
          status: "insufficient_data",
          warnings: [
            `Depends on insufficient indicator(s): ${insufficientDependencies
              .map((dependency) => dependency.id)
              .join(", ")}.`,
          ],
        });
        cache.set(id, result);
        state.set(id, "done");
        return result;
      }

      const resolvedContext: IndicatorContext = {
        data: request.context.data,
        indicators: new Map<string, IndicatorResult<unknown>>([
          ...request.context.indicators,
          ...cache,
          ...dependencyResults,
        ]),
        asOf: request.context.asOf,
      };

      let calculation: IndicatorCalculation;
      try {
        calculation = definition.calculate(resolvedContext);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        const result = this.engineResult(definition, request.context, {
          value: null,
          status: "error",
          warnings: [`Indicator threw during calculation: ${message}`],
        });
        cache.set(id, result);
        state.set(id, "done");
        return result;
      }

      if (isNonFinite(calculation.value)) {
        const result = this.engineResult(definition, request.context, {
          value: null,
          status: "error",
          warnings: [NON_FINITE_WARNING],
        });
        cache.set(id, result);
        state.set(id, "done");
        return result;
      }

      const result = this.engineResult(
        definition,
        request.context,
        calculation,
        calculation.value,
      );
      cache.set(id, result);
      state.set(id, "done");
      return result;
    };

    for (const id of request.indicators) {
      compute(id);
    }
    return cache as unknown as ReadonlyMap<string, IndicatorResult<T>>;
  }

  private engineResult(
    definition: IndicatorDefinition,
    context: IndicatorContext,
    calculation: IndicatorCalculation,
    value: number | null = null,
  ): IndicatorResult {
    return {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      value,
      status: calculation.status,
      asOf: calculation.asOf ?? context.asOf,
      methodology: {
        description: definition.metadata.methodology,
        ...(definition.metadata.formula
          ? { formula: definition.metadata.formula }
          : {}),
      },
      sources: calculation.sources ?? [],
      warnings: calculation.warnings ?? [],
      ...(calculation.dataWindow
        ? { dataWindow: calculation.dataWindow }
        : {}),
    };
  }
}