export class UnsupportedFrequencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFrequencyError";
  }
}