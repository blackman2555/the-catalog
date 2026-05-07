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
const refreshBtn = document.getElementById("refreshBtn");

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
          limitSec <= basePreview
            ? "Preview ended — collect this OBJKT for full playback."
            : "Playback limit reached — collect more editions to hear the rest.";
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
    const title = document.createElement("h2");
    title.className = "catalog-more-title";
    title.textContent = "More in catalog (ranks 4–" + items.length + " by sales)";
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
    catalogMoreEl.appendChild(title);
    catalogMoreEl.appendChild(row);
    requestAnimationFrame(updateCatalogNav);
    setTimeout(updateCatalogNav, 400);
  }

  const fallbackNote = items.length < 3 ? " (showing all available)" : "";
  const catalogNote =
    items.length > topItems.length ? " Scroll below the mosaic for ranks 4+." : "";
  const viewer = String(CONFIG.viewerWallet || "").trim();
  let suffix = "";
  if (!viewer.startsWith("tz")) {
    suffix = " 10s previews until CONFIG.viewerWallet is set (holders unlock full audio).";
  }
  const mockHint = CONFIG.useMockData
    ? "Mock mode — use viewerWallet + mockCollectedTokenIds to test unlock. "
    : "";
  setStatus(
    mockHint +
      "Showing top " +
      topItems.length +
      " most-bought tagged tracks by sales count" +
      fallbackNote +
      "." +
      catalogNote +
      suffix
  );
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
    await enrichOwnershipForTopItems(state.items, forceRefresh);
    renderGrid(mockItems);
    return;
  }

  if (!CONFIG.minterWallet.startsWith("tz")) {
    setStatus("Please set CONFIG.minterWallet before minting this OBJKT.", true);
    return;
  }

  try {
    clearPlayback();
    state.focusedTokenId = null;
    if (!forceRefresh) {
      const cached = loadCache();
      if (cached && cached.length) {
        state.items = cached;
        await enrichOwnershipForTopItems(state.items, false);
        renderGrid(state.items);
        return;
      }
    }

    setStatus("Fetching your tagged music NFTs...");
    const items = await fetchFromTeztok();
    state.items = items;
    saveCache(items);
    await enrichOwnershipForTopItems(state.items, forceRefresh);
    renderGrid(items);
  } catch (error) {
    const message = error && error.message ? error.message : "Unknown error";
    setStatus("Could not load NFTs: " + message, true);
  }
}

refreshBtn.addEventListener("click", () => {
  loadAndRender(true);
});

loadAndRender(false);
