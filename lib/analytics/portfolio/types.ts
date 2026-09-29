/**
 * Portfolio (Phase 2) of the Analytics subsystem.
 *
 * Everything here is provider-agnostic and pure: no network, no Next/React,
 * no app layers. Series are passed in already normalized by the caller.
 */

export interface PricePoint {
  date: string;
  value: number;
}

export interface ReturnPoint {
  date: string;
  value: number;
}

export interface PriceSeries {
  assetId: string;
  points: readonly PricePoint[];
}

export interface ReturnSeries {
  assetId: string;
  points: readonly ReturnPoint[];
}

export interface AlignedReturnSeries {
  dates: string[];
  left: number[];
  right: number[];
}

export interface MultipleAlignedReturnSeries {
  dates: string[];
  series: Map<string, number[]>;
}

export interface PortfolioPosition {
  assetId: string;
  weight: number;
}

export interface PortfolioDefinition {
  id: string;
  positions: readonly PortfolioPosition[];
}

export interface PortfolioWeightValidation {
  valid: boolean;
  errors: string[];
  sum: number;
}

export interface PortfolioReturnsRequest {
  portfolio: PortfolioDefinition;
  assetReturns: ReadonlyMap<string, ReturnSeries>;
}

export class InvalidPriceSeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPriceSeriesError";
  }
}

export class DuplicateDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateDateError";
  }
}

export class DuplicateAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateAssetError";
  }
}

export class InvalidPortfolioWeightsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPortfolioWeightsError";
  }
}

export class InvalidReturnSeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReturnSeriesError";
  }
}

export class InvalidPortfolioDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPortfolioDefinitionError";
  }
}

export class AssetSeriesKeyMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetSeriesKeyMismatchError";
  }
}

export class MissingAssetReturnSeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingAssetReturnSeriesError";
  }
}

export class NonFiniteReturnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonFiniteReturnError";
  }
}