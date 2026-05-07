/**
 * Live demo catalog: OBJKTs minted by zimbabwe3000 (wallet below), loaded from Teztok.
 * Example piece: https://teia.art/objkt/743863 ("Black Moon").
 *
 * For your own mint: set minterWallet to your tz address, tune allowedTags (e.g. single/album/ep),
 * and keep useMockData false — or useMockData true with MOCK_ITEMS for fully offline tests.
 */
const CONFIG = {
  // Demo: zimbabwe3000 — replace with your wallet before shipping your own OBJKT.
  minterWallet: "tz1Rmjn3ga5CvXDSnPTV8k5M2QprJkBPRHBR",
  // Simulate logged-in collector: ktorn — TzKT checks primary FA2 balance → full audio + colour cover when owned.
  viewerWallet: "tz1dd2tmTJFRJh8ycLuZeMpKLquJYkMypu2Q",
  previewSeconds: 10,
  previewFadeOutSeconds: 1.2,
  fa2ContractDefault: "",
  tzktApiBase: "https://api.tzkt.io/v1",
  // Includes common music NFT tags on Teia (zimbabwe3000 uses music / nftmusic / musicnft).
  // Keep single/album/ep when your own drops use those release-type tags.
  allowedTags: ["single", "album", "ep", "music", "nftmusic", "musicnft"],
  graphqlEndpoint: "https://teztok.teia.rocks/v1/graphql",
  ipfsGateway: "https://ipfs.io/ipfs/",
  cacheTtlMs: 2 * 60 * 1000,
  cacheKey: "teia-music-mosaic-cache-v3-zimbabwe3000-demo",
  useMockData: false,
  mockCollectedTokenIds: [],
  editionStacks: {},
  mockEditionHoldings: {}
};

/** Used only when useMockData is true — add static rows here for offline UI tests. */
const MOCK_ITEMS = [];
