/**
 * Display names for common assets. Binance's public market-data API returns tickers only, so
 * names are static reference data. Unknown assets simply show their ticker; nothing is guessed.
 */
export const ASSET_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  BNB: "BNB",
  SOL: "Solana",
  XRP: "XRP",
  ADA: "Cardano",
  DOGE: "Dogecoin",
  TRX: "TRON",
  TON: "Toncoin",
  AVAX: "Avalanche",
  DOT: "Polkadot",
  LINK: "Chainlink",
  MATIC: "Polygon (MATIC)",
  POL: "Polygon",
  SHIB: "Shiba Inu",
  LTC: "Litecoin",
  BCH: "Bitcoin Cash",
  UNI: "Uniswap",
  XLM: "Stellar",
  ATOM: "Cosmos",
  ETC: "Ethereum Classic",
  NEAR: "NEAR Protocol",
  APT: "Aptos",
  ARB: "Arbitrum",
  OP: "Optimism",
  FIL: "Filecoin",
  ICP: "Internet Computer",
  HBAR: "Hedera",
  VET: "VeChain",
  INJ: "Injective",
  SUI: "Sui",
  SEI: "Sei",
  TIA: "Celestia",
  RNDR: "Render",
  RENDER: "Render",
  FET: "Artificial Superintelligence Alliance",
  GRT: "The Graph",
  AAVE: "Aave",
  MKR: "Maker",
  ALGO: "Algorand",
  EGLD: "MultiversX",
  SAND: "The Sandbox",
  MANA: "Decentraland",
  AXS: "Axie Infinity",
  THETA: "Theta Network",
  XTZ: "Tezos",
  EOS: "EOS",
  FLOW: "Flow",
  CHZ: "Chiliz",
  CRV: "Curve DAO",
  LDO: "Lido DAO",
  RUNE: "THORChain",
  KAVA: "Kava",
  PEPE: "Pepe",
  FLOKI: "FLOKI",
  BONK: "Bonk",
  WIF: "dogwifhat",
  JUP: "Jupiter",
  PYTH: "Pyth Network",
  STX: "Stacks",
  IMX: "Immutable",
  ENS: "Ethereum Name Service",
  COMP: "Compound",
  SNX: "Synthetix",
  ZEC: "Zcash",
  DASH: "Dash",
  NEO: "NEO",
  IOTA: "IOTA",
  QNT: "Quant",
  GALA: "Gala",
  ENA: "Ethena",
  WLD: "Worldcoin",
  ORDI: "ORDI",
  TRUMP: "Official Trump",
  PENGU: "Pudgy Penguins",
  ONDO: "Ondo",
  CAKE: "PancakeSwap",
  "1INCH": "1inch",
  USDC: "USD Coin",
  FDUSD: "First Digital USD",
  TUSD: "TrueUSD",
  DAI: "Dai",
  EUR: "Euro",
  PAXG: "PAX Gold",
};

export function assetName(baseAsset: string): string | null {
  return ASSET_NAMES[baseAsset] ?? null;
}

/**
 * Binance lists tokenized stocks and ETFs as "<TICKER>B" (AAPLB, NVDAB, SOXSB…). There is no
 * flag for them in exchangeInfo, so this is a heuristic: 4+ letters ending in B and not a known
 * crypto asset. Used to keep equities out of crypto buy suggestions.
 */
export function isLikelyTokenizedStock(baseAsset: string): boolean {
  return baseAsset.length >= 4 && /^[A-Z]+B$/.test(baseAsset) && !ASSET_NAMES[baseAsset];
}

const NAME_INDEX: Array<[RegExp, string]> = Object.entries(ASSET_NAMES)
  .filter(([sym, name]) => name.length > 3 && name.toUpperCase() !== sym)
  .map(([sym, name]) => [new RegExp(`\\b${name.split(" ")[0]!.replace(/[^A-Za-z0-9]/g, "")}\\b`, "i"), sym]);

/** Finds assets mentioned by full name ("bitcoin", "solana") in free text. */
export function assetsMentionedByName(text: string): string[] {
  const found = new Set<string>();
  for (const [re, sym] of NAME_INDEX) if (re.test(text)) found.add(sym);
  return [...found];
}
