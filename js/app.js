const state = {
  items: [],
  topTokenIds: [],
  focusedTokenId: null,
  currentTokenId: null,
  currentAudio: null,
  ownershipCache: new Map()
};

const statusEl = document.getElementById("status");
const gridEl = document.getElementById("grid");
const catalogMoreEl = document.getElementById("catalogMore");
const creditsEl = document.getElementById("collectorCredits");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function normalizeIpfs(uri) {
  if (!uri || typeof uri !== "string") return "";
  if (uri.startsWith("ipfs://")) return CONFIG.ipfsGateway + uri.slice("ipfs://".length);
  return uri;
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((entry) => String(entry && entry.tag ? entry.tag : "").trim().toLowerCase())
    .filter(Boolean);
}

function hasAllowedTag(tags) {
  const allowed = new Set(CONFIG.allowedTags.map((t) => t.toLowerCase()));
  return tags.some((t) => allowed.has(t));
}

function hasAudioMime(token) {
  return typeof token.mime_type === "string" && token.mime_type.toLowerCase().startsWith("audio/");
}

function resolveFa2Address(item) {
  const raw = (item && item.fa2Address) || CONFIG.fa2ContractDefault;
  return typeof raw === "string" && raw.startsWith("KT1") ? raw : "";
}

function ownershipCacheKey(fa2Address, tokenId) {
  return fa2Address + "|" + String(tokenId);
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function formatCheapestListingTz(mutez) {
  if (mutez == null) return null;
  const n = Number(mutez);
  if (!Number.isFinite(n) || n <= 0) return null;
  const xtz = n / 1e6;
  if (!Number.isFinite(xtz)) return null;
  const rounded = Math.round(xtz * 1000) / 1000;
  const s = rounded.toFixed(3).replace(/\.?0+$/, "");
  return s + " XTZ";
}

function teiaObjktUrl(item) {
  const base = String(CONFIG.teiaObjktBase || "https://teia.art/objkt").replace(/\/$/, "");
  return base + "/" + encodeURIComponent(String(item.tokenId));
}

async function fetchObjktListingsChunk(endpoint, fa2, tokenIds) {
  const query = `
    query ListingsForTokens($fa: String!, $ids: [String!]!) {
      listing(where: {
        fa_contract: {_eq: $fa},
        token: {token_id: {_in: $ids}},
        status: {_eq: "active"}
      }) {
        price_xtz
        token { token_id }
        currency { symbol }
      }
    }
  `;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { fa: fa2, ids: tokenIds } })
  });
  if (!response.ok) return [];
  const payload = await response.json();
  if (payload.errors && payload.errors.length) return [];
  const listing = payload.data && payload.data.listing;
  return Array.isArray(listing) ? listing : [];
}

async function attachCheapestListings(items) {
  for (const item of items) {
    delete item.cheapestListingMutez;
  }
  const endpoint = CONFIG.objktGraphqlEndpoint || "https://data.objkt.com/v3/graphql";
  const chunkSize = Math.max(20, Math.min(120, Number(CONFIG.objktListingChunkSize) || 90));
  const byFa = new Map();

  for (const item of items) {
    const fa = resolveFa2Address(item);
    if (!fa) continue;
    const tid = String(item.tokenId);
    if (!byFa.has(fa)) byFa.set(fa, new Set());
    byFa.get(fa).add(tid);
  }

  const priceByKey = new Map();

  try {
    for (const [fa, idSet] of byFa) {
      const unique = Array.from(idSet);
      const chunks = chunkArray(unique, chunkSize);
      for (const ids of chunks) {
        const rows = await fetchObjktListingsChunk(endpoint, fa, ids);
        for (const row of rows) {
          const sym = row.currency && row.currency.symbol ? String(row.currency.symbol) : "";
          if (sym !== "XTZ") continue;
          const tid = row.token && row.token.token_id != null ? String(row.token.token_id) : "";
          const p = row.price_xtz;
          if (!tid || p == null) continue;
          const key = ownershipCacheKey(fa, tid);
          const prev = priceByKey.get(key);
          const num = Number(p);
          if (!Number.isFinite(num)) continue;
          if (prev == null || num < prev) priceByKey.set(key, num);
        }
      }
    }
  } catch (_) {
    // OBJKT marketplace optional — tiles still render without price chips.
  }

  for (const item of items) {
    const fa = resolveFa2Address(item);
    if (!fa) {
      item.cheapestListingMutez = null;
      continue;
    }
    const key = ownershipCacheKey(fa, item.tokenId);
    item.cheapestListingMutez = priceByKey.has(key) ? priceByKey.get(key) : null;
  }
}

function appendListingChip(coverWrap, item) {
  const a = document.createElement("a");
  a.className = "cover-listing";
  const formatted = formatCheapestListingTz(item.cheapestListingMutez);
  if (formatted) {
    a.textContent = formatted;
    a.setAttribute("aria-label", "Cheapest listing " + formatted + ", open on Teia");
  } else {
    a.classList.add("cover-listing--no-price");
    a.textContent = "\u2014";
    a.setAttribute("aria-label", "No active listing — view OBJKT on Teia");
  }
  a.href = teiaObjktUrl(item);
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.addEventListener("click", (e) => e.stopPropagation());
  coverWrap.appendChild(a);
}

function formatShortAddress(addr) {
  if (!addr || addr.length < 12) return addr || "?";
  return addr.slice(0, 5) + "…" + addr.slice(-4);
}

function clearCollectorCreditsLayer() {
  if (!creditsEl) return;
  creditsEl.innerHTML = "";
  creditsEl.hidden = true;
}

function populateCollectorCreditsDom(labels) {
  if (!creditsEl) return;
  const minL = Math.max(8, Number(CONFIG.collectorCreditsMinLines) || 28);
  const maxL = Math.max(minL, Number(CONFIG.collectorCreditsMaxLines) || 72);
  const lines = labels.slice();
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = lines[i];
    lines[i] = lines[j];
    lines[j] = t;
  }
  const target = Math.min(maxL, Math.max(minL, Math.round(labels.length * 2.2)));
  const out = [];
  let k = 0;
  while (out.length < target && lines.length) {
    out.push(lines[k % lines.length]);
    k++;
  }
  const frag = document.createDocumentFragment();
  for (const text of out) {
    const span = document.createElement("span");
    span.className = "collector-credits__line";
    span.textContent = text;
    const leftPct = 4 + Math.random() * 88;
    const durSec = 68 + Math.random() * 72;
    const delaySec = -(Math.random() * durSec);
    span.style.setProperty("--cc-left", leftPct + "%");
    span.style.setProperty("--cc-dur", durSec.toFixed(2) + "s");
    span.style.setProperty("--cc-delay", delaySec.toFixed(2) + "s");
    frag.appendChild(span);
  }
  creditsEl.appendChild(frag);
}

async function fetchHolderLabelsForToken(fa2, tokenId) {
  const params = new URLSearchParams({
    "token.contract": fa2,
    "token.tokenId": String(tokenId),
    "balance.gt": "0",
    limit: "10000"
  });
  const url = CONFIG.tzktApiBase + "/tokens/balances?" + params.toString();
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const row of rows) {
      const address = row.account && row.account.address ? String(row.account.address) : "";
      if (!address.startsWith("tz")) continue;
      const alias = row.account && row.account.alias ? String(row.account.alias).trim() : "";
      const label = alias || formatShortAddress(address);
      out.push({ address, label });
    }
    return out;
  } catch (_) {
    return [];
  }
}

async function refreshCollectorCredits(items) {
  if (!CONFIG.collectorCreditsEnabled || !creditsEl) return;
  creditsEl.innerHTML = "";
  creditsEl.hidden = true;
  if (!items || !items.length) return;

  const maxTok = Number(CONFIG.collectorCreditsMaxTokens) || 80;
  const concurrency = Math.max(1, Number(CONFIG.collectorCreditsConcurrency) || 6);
  const excludeMinter = CONFIG.collectorCreditsExcludeMinter !== false;
  const minter = String(CONFIG.minterWallet || "").trim().toLowerCase();

  const slice = items.slice(0, maxTok);
  const byAddress = new Map();

  for (let i = 0; i < slice.length; i += concurrency) {
    const batch = slice.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (item) => {
        const fa2 = resolveFa2Address(item);
        if (!fa2) return;
        const holders = await fetchHolderLabelsForToken(fa2, item.tokenId);
        for (const { address, label } of holders) {
          const a = address.toLowerCase();
          if (excludeMinter && minter && a === minter) continue;
          if (!byAddress.has(a)) byAddress.set(a, label);
        }
      })
    );
  }

  const uniqLabels = Array.from(byAddress.values());
  if (!uniqLabels.length) return;
  populateCollectorCreditsDom(uniqLabels);
  creditsEl.hidden = false;
}

async function viewerOwnsToken(viewer, fa2Address, tokenId) {
  const fa2 = fa2Address;
  const key = ownershipCacheKey(fa2, tokenId);
  if (state.ownershipCache.has(key)) return state.ownershipCache.get(key);
  if (!viewer || !viewer.startsWith("tz") || !fa2) {
    state.ownershipCache.set(key, false);
    return false;
  }
  const params = new URLSearchParams({
    account: viewer,
    "token.contract": fa2,
    "token.tokenId": String(tokenId),
    "balance.gt": "0",
    limit: "1"
  });
  const url = CONFIG.tzktApiBase + "/tokens/balances?" + params.toString();
  try {
    const response = await fetch(url);
    if (!response.ok) {
      state.ownershipCache.set(key, false);
      return false;
    }
    const rows = await response.json();
    const owns = Array.isArray(rows) && rows.length > 0;
    state.ownershipCache.set(key, owns);
    return owns;
  } catch (_) {
    state.ownershipCache.set(key, false);
    return false;
  }
}

async function computePlaybackAccess(item) {
  const basePreview = Number(CONFIG.previewSeconds) || 10;
  const primaryId = String(item.tokenId);
  const stacks = CONFIG.editionStacks && CONFIG.editionStacks[primaryId];
  const viewer = String(CONFIG.viewerWallet || "").trim();

  if (Array.isArray(stacks) && stacks.length > 0) {
    const rows = await Promise.all(
      stacks.map(async (ed) => {
        const fa2Raw = ed.fa2Address || resolveFa2Address(item) || CONFIG.fa2ContractDefault;
        const fa2 = typeof fa2Raw === "string" && fa2Raw.startsWith("KT1") ? fa2Raw : "";
        let owns = false;
        if (CONFIG.useMockData) {
          if (viewer.startsWith("tz")) {
            const held = (CONFIG.mockEditionHoldings && CONFIG.mockEditionHoldings[primaryId]) || [];
            owns = held.map(String).includes(String(ed.tokenId));
          }
        } else if (viewer.startsWith("tz") && fa2) {
          owns = await viewerOwnsToken(viewer, fa2, ed.tokenId);
        }
        return { owns, contrib: owns ? Number(ed.seconds) || 0 : 0 };
      })
    );
    const sum = rows.reduce((a, r) => a + r.contrib, 0);
    const ownsAnyEdition = rows.some((r) => r.owns);
    const playLimitSeconds = sum <= 0 ? basePreview : sum;
    return { playLimitSeconds, ownsAnyEdition };
  }

  if (!viewer.startsWith("tz")) {
    return { playLimitSeconds: basePreview, ownsAnyEdition: false };
  }
  if (CONFIG.useMockData) {
    const collected = new Set((CONFIG.mockCollectedTokenIds || []).map(String));
    const has = collected.has(primaryId);
    return { playLimitSeconds: has ? Infinity : basePreview, ownsAnyEdition: has };
  }
  const fa2 = resolveFa2Address(item);
  if (!fa2) {
    return { playLimitSeconds: basePreview, ownsAnyEdition: false };
  }
  const ownsPrimary = await viewerOwnsToken(viewer, fa2, item.tokenId);
  return {
    playLimitSeconds: ownsPrimary ? Infinity : basePreview,
    ownsAnyEdition: ownsPrimary
  };
}

function formatPlaybackAccess(item) {
  const lim = item.playLimitSeconds;
  const base = Number(CONFIG.previewSeconds) || 10;
  if (lim === Infinity) return "Full track";
  if (lim <= base) return "Preview (" + Math.round(lim) + "s)";
  return Math.round(lim) + "s stitch";
}

async function enrichOwnershipForTopItems(items, invalidateCache = false) {
  if (invalidateCache) {
    state.ownershipCache.clear();
  }
  await Promise.all(
    items.map(async (item) => {
      const acc = await computePlaybackAccess(item);
      item.playLimitSeconds = acc.playLimitSeconds;
      item.ownsAnyEdition = acc.ownsAnyEdition;
    })
  );
}

async function fetchFromTeztok() {
  const query = `
        query MusicTokens($wallet: String!) {
          tokens(
            where: {
              artist_address: { _eq: $wallet }
              minted_at: { _is_null: false }
              artifact_uri: { _is_null: false }
              display_uri: { _is_null: false }
            }
            order_by: { minted_at: desc }
            limit: 200
          ) {
            token_id
            name
            minted_at
            sales_count
            mime_type
            fa2_address
            artifact_uri
            display_uri
            thumbnail_uri
            tags {
              tag
            }
          }
        }
      `;

  const response = await fetch(CONFIG.graphqlEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { wallet: CONFIG.minterWallet } })
  });

  if (!response.ok) {
    throw new Error("Teztok request failed with status " + response.status);
  }

  const payload = await response.json();
  if (payload.errors && payload.errors.length) {
    throw new Error(payload.errors[0].message || "Teztok GraphQL error");
  }

  const rows = Array.isArray(payload.data && payload.data.tokens) ? payload.data.tokens : [];

  return rows
    .map((row) => {
      const tags = sanitizeTags(row.tags);
      const imageUri = row.display_uri || row.thumbnail_uri || "";
      const audioUri = row.artifact_uri || "";
      return {
        tokenId: row.token_id,
        name: row.name || "Untitled",
        mintedAt: row.minted_at || "",
        salesCount: Number(row.sales_count || 0),
        tags,
        fa2Address: row.fa2_address || "",
        imageUrl: normalizeIpfs(imageUri),
        audioUrl: normalizeIpfs(audioUri),
        mimeType: row.mime_type || ""
      };
    })
    .filter((item) => item.imageUrl && item.audioUrl)
    .filter((item) => hasAllowedTag(item.tags))
    .filter((item) => hasAudioMime({ mime_type: item.mimeType }))
    .sort((a, b) => {
      if (b.salesCount !== a.salesCount) return b.salesCount - a.salesCount;
      const mintedDiff = String(b.mintedAt).localeCompare(String(a.mintedAt));
      if (mintedDiff !== 0) return mintedDiff;
      return String(b.tokenId).localeCompare(String(a.tokenId));
    });
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CONFIG.cacheKey);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.items) || typeof cached.timestamp !== "number") return null;
    if (Date.now() - cached.timestamp > CONFIG.cacheTtlMs) return null;
    return cached.items;
  } catch (_) {
    return null;
  }
}

function saveCache(items) {
  try {
    localStorage.setItem(CONFIG.cacheKey, JSON.stringify({ timestamp: Date.now(), items }));
  } catch (_) {
    // Ignore localStorage write failures.
  }
}

function clearPlayback() {
  const audio = state.currentAudio;
  if (audio) {
    if (audio._teiaOnPreviewTimeUpdate) {
      audio.removeEventListener("timeupdate", audio._teiaOnPreviewTimeUpdate);
    }
    if (audio._teiaOnLoadedMeta) {
      audio.removeEventListener("loadedmetadata", audio._teiaOnLoadedMeta);
    }
    if (audio._teiaOnEnded) {
      audio.removeEventListener("ended", audio._teiaOnEnded);
    }
    if (audio._teiaOnError) {
      audio.removeEventListener("error", audio._teiaOnError);
    }
    audio.volume = 1;
    audio.pause();
    audio.currentTime = 0;
  }
  state.currentAudio = null;
  state.currentTokenId = null;
  document.querySelectorAll(".tile.playing").forEach((el) => el.classList.remove("playing"));
}

function togglePlay(item, tileEl) {
  const isCurrent = state.currentTokenId === item.tokenId;
  if (isCurrent && state.currentAudio) {
    if (state.currentAudio.paused) {
      state.currentAudio.volume = 1;
      state.currentAudio.play().catch(() => setStatus("Playback was blocked by the browser.", true));
      tileEl.classList.add("playing");
      return;
    }
    state.currentAudio.pause();
    tileEl.classList.remove("playing");
    return;
  }

  clearPlayback();

  const basePreview = Number(CONFIG.previewSeconds) || 10;
  const limitSec = item.playLimitSeconds;
  const fullPlayback = limitSec === Infinity;

  const audio = new Audio(item.audioUrl);
  audio.preload = "none";
  audio.volume = 1;

  const onEnded = () => {
    if (audio._teiaOnPreviewTimeUpdate) {
      audio.removeEventListener("timeupdate", audio._teiaOnPreviewTimeUpdate);
    }
    if (audio._teiaOnLoadedMeta) {
      audio.removeEventListener("loadedmetadata", audio._teiaOnLoadedMeta);
    }
    tileEl.classList.remove("playing");
    state.currentTokenId = null;
    state.currentAudio = null;
  };
  audio._teiaOnEnded = onEnded;
  audio.addEventListener("ended", onEnded);

  const onError = () => {
    if (audio._teiaOnPreviewTimeUpdate) {
      audio.removeEventListener("timeupdate", audio._teiaOnPreviewTimeUpdate);
    }
    if (audio._teiaOnLoadedMeta) {
      audio.removeEventListener("loadedmetadata", audio._teiaOnLoadedMeta);
    }
    setStatus("Failed to load audio for token #" + item.tokenId, true);
    tileEl.classList.remove("playing");
    state.currentTokenId = null;
    state.currentAudio = null;
  };
  audio._teiaOnError = onError;
  audio.addEventListener("error", onError);

  if (!fullPlayback) {
    const onPreviewTimeUpdate = () => {
      if (state.currentAudio !== audio) return;
      const dur = audio.duration;
      let cap = limitSec;
      if (isFinite(dur) && dur > 0) {
        if (limitSec >= dur) {
          return;
        }
        cap = Math.min(limitSec, dur);
      }
      const finishPreviewCut = () => {
        audio.removeEventListener("timeupdate", onPreviewTimeUpdate);
        if (audio._teiaOnLoadedMeta) {
          audio.removeEventListener("loadedmetadata", audio._teiaOnLoadedMeta);
        }
        audio.volume = 0;
        audio.pause();
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        tileEl.classList.remove("playing");
        state.currentTokenId = null;
        state.currentAudio = null;
        const msg =
          limitSec <= basePreview ? "" : "Playback limit reached — collect more editions to hear the rest.";
        setStatus(msg);
      };
      const fadeCfg = Number(CONFIG.previewFadeOutSeconds) || 0;
      const fadeSec = fadeCfg > 0 ? Math.min(fadeCfg, cap * 0.4) : 0;
      const fadeStart = fadeSec > 0 ? cap - fadeSec : cap;
      if (audio.currentTime >= cap) {
        finishPreviewCut();
        return;
      }
      if (fadeSec > 0 && audio.currentTime >= fadeStart) {
        const p = (audio.currentTime - fadeStart) / fadeSec;
        audio.volume = Math.max(0, 1 - p);
      }
    };
    const onMeta = () => {
      if (!isFinite(audio.duration) || audio.duration <= 0) return;
      if (limitSec >= audio.duration) {
        audio.removeEventListener("timeupdate", onPreviewTimeUpdate);
        audio.removeEventListener("loadedmetadata", onMeta);
      }
    };
    audio._teiaOnPreviewTimeUpdate = onPreviewTimeUpdate;
    audio._teiaOnLoadedMeta = onMeta;
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onPreviewTimeUpdate);
  }

  audio
    .play()
    .then(() => {
      state.currentAudio = audio;
      state.currentTokenId = item.tokenId;
      tileEl.classList.add("playing");
      const modeLabel = formatPlaybackAccess(item);
      setStatus(modeLabel + ": " + item.name + " (#" + item.tokenId + ")");
    })
    .catch(() => {
      setStatus("Playback was blocked by the browser.", true);
      tileEl.classList.remove("playing");
    });
}

function getTopItems(items) {
  return items.slice(0, 3);
}

function getDefaultFocusedTokenId(topItems) {
  if (!topItems.length) return null;
  const centerIndex = Math.min(1, topItems.length - 1);
  return topItems[centerIndex].tokenId;
}

function computeLayoutRoleMap(topItems) {
  if (!topItems.length) return new Map();

  const focusedExists = topItems.some((item) => item.tokenId === state.focusedTokenId);
  const focusedTokenId = focusedExists ? state.focusedTokenId : getDefaultFocusedTokenId(topItems);
  state.focusedTokenId = focusedTokenId;

  const roleMap = new Map();
  const centerItem = topItems.find((item) => item.tokenId === focusedTokenId);
  if (centerItem) {
    roleMap.set(centerItem.tokenId, "collage-center");
  }

  const remaining = topItems.filter((item) => item.tokenId !== focusedTokenId);
  if (remaining[0]) roleMap.set(remaining[0].tokenId, "collage-left");
  if (remaining[1]) roleMap.set(remaining[1].tokenId, "collage-right");
  return roleMap;
}

function applyFocusRolesToDom() {
  const topItems = getTopItems(state.items);
  const roleMap = computeLayoutRoleMap(topItems);
  const tiles = gridEl.querySelectorAll(".tile");
  tiles.forEach((tile) => {
    tile.classList.remove("collage-left", "collage-center", "collage-right");
    const tokenId = tile.dataset.tokenId;
    tile.classList.add(roleMap.get(tokenId) || "collage-center");
  });
}

function activateTile(item) {
  state.focusedTokenId = item.tokenId;
  applyFocusRolesToDom();
  const tileEl =
    gridEl.querySelector('[data-token-id="' + item.tokenId + '"]') ||
    catalogMoreEl.querySelector('[data-token-id="' + item.tokenId + '"]');
  if (tileEl) {
    togglePlay(item, tileEl);
  }
}

function renderGrid(items) {
  gridEl.innerHTML = "";
  catalogMoreEl.innerHTML = "";
  catalogMoreEl.hidden = true;

  if (!items.length) {
    setStatus("No tagged audio NFTs found for this wallet.");
    return;
  }

  const topItems = getTopItems(items);
  const restItems = items.length > 3 ? items.slice(3) : [];
  state.topTokenIds = topItems.map((item) => item.tokenId);
  const roleMap = computeLayoutRoleMap(topItems);
  const fragment = document.createDocumentFragment();
  topItems.forEach((item) => {
    const tile = document.createElement("article");
    tile.className = "tile " + (roleMap.get(item.tokenId) || "collage-center");
    if (!item.ownsAnyEdition) {
      tile.classList.add("tile--no-edition");
    }
    tile.dataset.tokenId = item.tokenId;
    tile.setAttribute("tabindex", "0");
    tile.setAttribute("role", "button");
    tile.setAttribute("aria-label", "Focus and toggle playback for " + item.name);

    const coverWrap = document.createElement("div");
    coverWrap.className = "cover-wrap";
    const cover = document.createElement("img");
    cover.className = "cover";
    cover.src = item.imageUrl;
    cover.alt = item.name;
    cover.loading = "lazy";
    coverWrap.appendChild(cover);
    appendListingChip(coverWrap, item);

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("p");
    name.className = "name";
    name.textContent = item.name;
    const token = document.createElement("p");
    token.className = "token";
    const accessLabel = formatPlaybackAccess(item);
    token.textContent =
      accessLabel + " \u00b7 #" + item.tokenId + " \u00b7 Sales " + item.salesCount;
    meta.appendChild(name);
    meta.appendChild(token);

    tile.appendChild(coverWrap);
    tile.appendChild(meta);

    if (state.currentTokenId === item.tokenId && state.currentAudio && !state.currentAudio.paused) {
      tile.classList.add("playing");
    }

    tile.addEventListener("click", () => activateTile(item));
    tile.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateTile(item);
      }
    });
    fragment.appendChild(tile);
  });
  gridEl.appendChild(fragment);

  if (restItems.length) {
    catalogMoreEl.hidden = false;
    const row = document.createElement("div");
    row.className = "catalog-more-row";
    const btnPrev = document.createElement("button");
    btnPrev.type = "button";
    btnPrev.className = "catalog-more-nav catalog-more-nav--prev";
    btnPrev.setAttribute("aria-label", "Scroll catalog left");
    btnPrev.appendChild(document.createTextNode("\u2039"));

    const scroll = document.createElement("div");
    scroll.className = "catalog-more-scroll";

    const btnNext = document.createElement("button");
    btnNext.type = "button";
    btnNext.className = "catalog-more-nav catalog-more-nav--next";
    btnNext.setAttribute("aria-label", "Scroll catalog right");
    btnNext.appendChild(document.createTextNode("\u203A"));

    restItems.forEach((item, idx) => {
      const tile = document.createElement("article");
      tile.className = "tile tile--catalog";
      if (!item.ownsAnyEdition) {
        tile.classList.add("tile--no-edition");
      }
      tile.dataset.tokenId = item.tokenId;
      tile.setAttribute("tabindex", "0");
      tile.setAttribute("role", "button");
      tile.setAttribute(
        "aria-label",
        "Focus and toggle playback for " + item.name + " (rank " + (idx + 4) + ")"
      );

      const coverWrap = document.createElement("div");
      coverWrap.className = "cover-wrap";
      const cover = document.createElement("img");
      cover.className = "cover";
      cover.src = item.imageUrl;
      cover.alt = item.name;
      cover.loading = "lazy";
      coverWrap.appendChild(cover);
      appendListingChip(coverWrap, item);

      const meta = document.createElement("div");
      meta.className = "meta";
      const name = document.createElement("p");
      name.className = "name";
      name.textContent = item.name;
      const token = document.createElement("p");
      token.className = "token";
      const accessLabel = formatPlaybackAccess(item);
      token.textContent =
        "#" +
        (idx + 4) +
        " · " +
        accessLabel +
        " · #" +
        item.tokenId +
        " · Sales " +
        item.salesCount;
      meta.appendChild(name);
      meta.appendChild(token);

      tile.appendChild(coverWrap);
      tile.appendChild(meta);

      if (state.currentTokenId === item.tokenId && state.currentAudio && !state.currentAudio.paused) {
        tile.classList.add("playing");
      }

      tile.addEventListener("click", () => activateTile(item));
      tile.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activateTile(item);
        }
      });
      scroll.appendChild(tile);
    });

    const scrollStep = () => Math.max(180, Math.floor(scroll.clientWidth * 0.88));
    const updateCatalogNav = () => {
      const maxScroll = scroll.scrollWidth - scroll.clientWidth;
      if (maxScroll <= 0) {
        btnPrev.disabled = true;
        btnNext.disabled = true;
        return;
      }
      btnPrev.disabled = scroll.scrollLeft <= 1;
      btnNext.disabled = scroll.scrollLeft >= maxScroll - 1;
    };
    btnPrev.addEventListener("click", () => {
      scroll.scrollBy({ left: -scrollStep(), behavior: "smooth" });
    });
    btnNext.addEventListener("click", () => {
      scroll.scrollBy({ left: scrollStep(), behavior: "smooth" });
    });
    scroll.addEventListener("scroll", updateCatalogNav, { passive: true });

    row.appendChild(btnPrev);
    row.appendChild(scroll);
    row.appendChild(btnNext);
    catalogMoreEl.appendChild(row);
    requestAnimationFrame(updateCatalogNav);
    setTimeout(updateCatalogNav, 400);
  }

  const viewer = String(CONFIG.viewerWallet || "").trim();
  let suffix = "";
  if (!viewer.startsWith("tz")) {
    suffix = "10s previews until CONFIG.viewerWallet is set (holders unlock full audio).";
  }
  const mockHint = CONFIG.useMockData
    ? "Mock mode — use viewerWallet + mockCollectedTokenIds to test unlock. "
    : "";
  const tail = (mockHint + suffix).trim();
  setStatus(tail);
}

async function loadAndRender(forceRefresh = false) {
  if (CONFIG.useMockData) {
    clearPlayback();
    state.focusedTokenId = null;
    const mockItems = MOCK_ITEMS.filter((item) => hasAllowedTag(item.tags)).sort((a, b) => {
      if (b.salesCount !== a.salesCount) return b.salesCount - a.salesCount;
      return String(b.mintedAt).localeCompare(String(a.mintedAt));
    });
    state.items = mockItems;
    await Promise.all([
      enrichOwnershipForTopItems(state.items, forceRefresh),
      attachCheapestListings(state.items)
    ]);
    renderGrid(mockItems);
    void refreshCollectorCredits(mockItems);
    return;
  }

  if (!CONFIG.minterWallet.startsWith("tz")) {
    setStatus("Please set CONFIG.minterWallet before minting this OBJKT.", true);
    clearCollectorCreditsLayer();
    return;
  }

  try {
    clearPlayback();
    state.focusedTokenId = null;
    if (!forceRefresh) {
      const cached = loadCache();
      if (cached && cached.length) {
        state.items = cached;
        await Promise.all([
          enrichOwnershipForTopItems(state.items, false),
          attachCheapestListings(state.items)
        ]);
        renderGrid(state.items);
        void refreshCollectorCredits(state.items);
        return;
      }
    }

    setStatus("Fetching your tagged music NFTs...");
    const items = await fetchFromTeztok();
    state.items = items;
    saveCache(items);
    await Promise.all([
      enrichOwnershipForTopItems(state.items, forceRefresh),
      attachCheapestListings(state.items)
    ]);
    renderGrid(items);
    void refreshCollectorCredits(items);
  } catch (error) {
    const message = error && error.message ? error.message : "Unknown error";
    setStatus("Could not load NFTs: " + message, true);
    clearCollectorCreditsLayer();
  }
}

loadAndRender(false);
