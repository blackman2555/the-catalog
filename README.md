# Teia Music Mosaic OBJKT

Interactive OBJKT that:
- fetches NFTs minted by one wallet from Teia's Teztok indexer
- filters by tags `single`, `album`, `ep`
- renders album art in a responsive mosaic
- plays/pauses the full MP3 when a cover is clicked

## Files

- `index.html`: standalone OBJKT app (HTML/CSS/JS, no build step)

## Configure Before Minting

Open `index.html` and update `CONFIG`:

- `minterWallet`: your Tezos wallet address (required)
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
4. Sorts newest-first by `minted_at`.
5. Renders a clickable album-cover mosaic.
6. Enforces one active track at a time.

## Collector Experience

- Click cover: play selected NFT audio
- Click same cover again: pause
- Click another cover: previous track stops, new one plays
- Keyboard: focus tile and press Enter/Space
- Refresh button: force re-fetch latest mints

## Teia Minting Checklist

1. Put your real wallet address in `CONFIG.minterWallet`.
2. Test locally by opening `index.html` in browser.
3. Confirm tagged NFTs (`single`, `album`, `ep`) appear.
4. Upload/mint this HTML as an interactive OBJKT on Teia.
5. Mint new tagged singles/albums/EPs from same wallet.
6. Reload the interactive OBJKT to show new entries.

