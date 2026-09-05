export type ProviderQuote = {
  symbol: string;
  price: number;
  prevClose: number;
  /** Exchange timestamp in ms. Not the time we received it. */
  asOf: number;
  volume?: number;
};

export interface QuoteProvider {
  readonly name: string;
  /** Lower number wins a reconciliation tie. */
  readonly priority: number;
  fetch(symbols: string[]): Promise<ProviderQuote[]>;
}
