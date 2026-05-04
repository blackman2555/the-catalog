# Teia Music Mosaic OBJKT

Interactive OBJKT that:
- fetches NFTs minted by one wallet from Teia's Teztok indexer
- filters by tags `single`, `album`, `ep`
- selects top 3 most-bought tracks by `sales_count`
- renders album art in a responsive collage layout
- plays **previews** (`previewSeconds` default 10s), optional **stacked edition unlocks** (`editionStacks`: owning listed OBJKT editions adds seconds from the start of the same audio), or **legacy full unlock** when there is no stack and the viewer holds the primary token (TzKT)

## Files

- `index.html`: standalone OBJKT app (HTML/CSS/JS, no build step)

## Configure Before Minting

Open `index.html` and update `CONFIG`:

- `minterWallet`: your Tezos wallet address (required for live mode)
- `viewerWallet`: optional; when set to a valid `tz1`… address, the app uses [TzKT](https://api.tzkt.io/) token balances. With **`editionStacks`** per primary `tokenId`, each owned edition row adds `seconds` of playback (summed, capped by file length). Without an `editionStacks` entry for a tile, **legacy** behavior applies: full playback if this wallet holds that tile's FA2 token, otherwise preview. If `viewerWallet` is empty, everyone gets preview-length playback only.
- `previewSeconds`: preview length in seconds (default `10`)
- `fa2ContractDefault`: optional fallback FA2 contract if a Teztok row omits `fa2_address`
- `tzktApiBase`: default `https://api.tzkt.io/v1`
- `mockCollectedTokenIds`: when `useMockData` is `true`, token ids that count as “collected” if `viewerWallet` is set (for testing unlock without chain calls)
- `editionStacks`: map primary tile `tokenId` → array of `{ tokenId, fa2Address, seconds }` for extra OBJKT editions of the same song; owned rows **sum** into a playback budget from time 0
- `mockEditionHoldings`: when `useMockData` is `true`, map primary `tokenId` → edition `tokenId`s the viewer mock-owns (requires `viewerWallet` set to a `tz1` address)
- `allowedTags`: keep `["single", "album", "ep"]` or adjust
- `graphqlEndpoint`: default `https://teztok.teia.rocks/v1/graphql`
- `ipfsGateway`: default `https://ipfs.io/ipfs/`
- `useMockData`: set `true` to test mosaic/player without minted NFTs

## Mock Mode (Test Before Minting)

If you have no album covers minted yet:

1. Set `CONFIG.useMockData = true`.
2. Open `index.html` in browser.
3. Test mosaic layout, click play/pause, keyboard controls, and refresh behavior.
4. Set `CONFIG.useMockData = false` when ready for live Teztok data.

`MOCK_ITEMS` in `index.html` contains sample cover/audio URLs and can be edited.

## How It Works

1. Calls Teztok GraphQL `tokens` query filtered by `artist_address`.
2. Normalizes IPFS URIs for image/audio loading in browser.
3. Keeps only tokens that:
   - include at least one allowed tag
   - have both image and audio URIs
   - have `mime_type` starting with `audio/`
4. Ranks by `sales_count` descending.
5. Breaks ties by newest `minted_at`, then token id.
6. Selects up to 3 tokens for the collage.
7. Renders a clickable layered collage (left/center/right roles with overlap).
8. Enforces one active track at a time.
9. Resolves `fa2_address` per token from Teztok; if `viewerWallet` is set, queries TzKT and computes **`playLimitSeconds`** per visible tile (edition stack sum, legacy full unlock, or base preview).

## Collector Experience

- Click/tap cover: move it to center and play selected NFT audio (preview or full, depending on holdings vs `viewerWallet`)
- Click same cover again: pause
- Click another cover: it becomes new center, previous track stops, and new one plays
- Keyboard: focus tile and press Enter/Space
- Refresh button: force re-fetch and re-rank latest mints
- Responsive collage keeps overlap/rotation across desktop, tablet, and mobile
- Center selection is sticky until another cover is selected

## Collage Ranking and Fallbacks

- Primary ranking metric: `sales_count` (most bought first).
- Secondary sort: newer mint date first.
- Tertiary sort: higher token id first.
- If fewer than 3 qualified items exist, collage renders available items without breaking layout.

## Teia Minting Checklist

1. Put your real wallet address in `CONFIG.minterWallet`.
2. Test locally by opening `index.html` in browser.
3. Confirm tagged NFTs (`single`, `album`, `ep`) appear.
4. Upload/mint this HTML as an interactive OBJKT on Teia.
5. Mint new tagged singles/albums/EPs from same wallet.
6. Reload the interactive OBJKT to show new entries.

