// ===== v1.2.38.3 preview mode, real v1.2.5 base =====
const BEE_PREVIEW_MODE_1230 =
  window.BEE_PREVIEW_MODE === true ||
  new URLSearchParams(window.location.search).get("preview") === "1";

const BEE_PREVIEW_STORES_1230 = [{"id": "D001", "name": "咕嚕叫土司（鹽行店）", "category": "食", "discount": "學生證飲品9折", "description": "這是完整正式網頁預覽用資料，使用 v1.2.5 原始 marker。", "extra": "preview.html 與 index.html 共用同一份 app.js / style.css。", "address": "台南市永康區中正路529號", "lat": 23.0387, "lng": 120.2396, "coverImage": "", "gallery": "", "extraImages": "", "openTime": "06:30", "closeTime": "14:00", "status": "active"}, {"id": "D002", "name": "蜂享咖啡", "category": "食", "discount": "學生證飲品9折", "description": "適合讀書與討論報告。", "extra": "可提供插座與內用空間。", "address": "台南市永康區中正路529號", "lat": 23.0396, "lng": 120.2413, "coverImage": "", "gallery": "", "extraImages": "", "openTime": "09:00", "closeTime": "22:00", "status": "active"}];

function autoSelectPreviewMarker1230(){
  if(!BEE_PREVIEW_MODE_1230) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const marker = document.querySelector(".leaflet-marker-icon .marker-wrap");
    if(marker){
      marker.click();
      clearInterval(timer);
    }
    if(tries > 30) clearInterval(timer);
  }, 250);
}


const API_URL = "https://script.google.com/macros/s/AKfycbwXXEh4HRbZ-FxiNlozhsWhG-SrNT2Mgpge0tCWulZY3EC-Yx-W06nHsdxFVhmyQZ-2/exec";
const DEFAULT_CENTER = [23.0384, 120.2399];
const DEFAULT_ZOOM = 16;
const FALLBACK_IMG = "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?q=80&w=1200&auto=format&fit=crop";

const STORAGE_SEARCH = "beeMapSearchHistory";
const STORAGE_STORE = "beeMapStoreHistory";
const STORAGE_REVIEWED = "beeMapReviewedStores";
const STORAGE_FAV = "beeMapFavorites";

let map, userLatLng, userMarker, markerCluster, normalLayer, satelliteLayer;
let currentCategory = "全部";
let stores = [];
let activeStore = null;
let selectedMarkerStoreId = null;
let selectedStoreMarker = null;
let currentLayerMode = "normal";
let activeRating = 10;
let galleryTimer = null;
let viewerImages = [];
let viewerIndex = 0;
let imgScale = 1;
let suppressNextMoveEnd = false;
let renderTimer = null;
let isRendering = false;
let geoWatchId = null;

const el = id => document.getElementById(id);
const searchInput = el("searchInput");
const storeList = el("storeList");
const storeCount = el("storeCount");
const loading = el("loading");
const toastBox = el("toast");
const bottomSheet = el("bottomSheet");
const dropdown = el("searchDropdown");
const clearBtn = el("clearBtn");
const detailOverlay = el("detailOverlay");
const imageViewer = el("imageViewer");
const viewerImg = el("viewerImg");

init();

async function init(){
  try{
    runTests();
    runLoadingIcons();
    setupMap();
    setupEvents();
    await loadStores();
    locateUser(false);
  }catch(error){
    console.error(error);
    stores = demoStores();
    render();
    hideLoading();
    showToast("初始化失敗，已載入示範資料");
  }
}

function setupMap(){
  if(typeof L === "undefined") throw new Error("Leaflet 尚未載入");
  map = L.map("map",{ zoomControl:false, attributionControl:true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  // CARTO Voyager，比 OpenStreetMap 預設好看一點。人類終於停止用紙本地圖色。
  normalLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: "© OpenStreetMap © CARTO"
  });
  satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 20,
    attribution: "© Esri"
  });
  normalLayer.addTo(map);

  let mapMoveTimer = null;
  map.on("moveend", () => {
    if(suppressNextMoveEnd){ suppressNextMoveEnd = false; return; }
    if(detailOverlay.classList.contains("show")) return;
    clearTimeout(mapMoveTimer);
    mapMoveTimer = setTimeout(updateVisibleDistancesOnly, 260);
  });

  map.on("click", () => {
    if(detailOverlay.classList.contains("show")) return;
    selectedMarkerStoreId = null;
    setSheetExpanded(false);
    renderMarkers(getFilteredStores());
    renderList(getFilteredStores());
  });
}

function setupEvents(){
  mountCategoryIcons();
  setupBottomSheetDrag();

  searchInput.addEventListener("input", () => {
    clearBtn.classList.toggle("show", Boolean(searchInput.value.trim()));
    render();
    renderSearchDropdown();
  });
  searchInput.addEventListener("keydown", e => {
    if(e.key === "Enter" && searchInput.value.trim()){
      saveSearch(searchInput.value.trim());
    }
  });
  searchInput.addEventListener("focus", () => {
    setSheetExpanded(false);
    document.querySelector(".app").classList.add("searching");
    renderSearchDropdown();
  });
  searchInput.addEventListener("blur", () => {
    setTimeout(() => {
      dropdown.classList.remove("show");
      document.querySelector(".app").classList.remove("searching");
    }, 180);
  });
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.classList.remove("show");
    render();
    renderSearchDropdown();
  });

  el("homeBtn").addEventListener("click", () => {
    suppressNextMoveEnd = true;
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    detailOverlay.classList.remove("show");
    selectedMarkerStoreId = null;
    setSheetExpanded(false);
    renderMarkers(getFilteredStores());
    renderList(getFilteredStores());
  });

  el("filterRow").addEventListener("click", e => {
    const btn = e.target.closest(".pill");
    if(!btn) return;
    currentCategory = btn.dataset.category;
    document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    selectedMarkerStoreId = null;
    render();
  });

  el("locateBtn").addEventListener("click", () => locateUser(true));
  el("zoomInBtn").addEventListener("click", () => map.zoomIn());
  el("zoomOutBtn").addEventListener("click", () => map.zoomOut());
  el("layerToggleBtn").addEventListener("click", () => switchMapLayer(currentLayerMode === "normal" ? "satellite" : "normal"));
  el("sheetToggle").addEventListener("click", toggleBottomSheet);

  el("closeDetailBtn").addEventListener("click", () => detailOverlay.classList.remove("show"));
  detailOverlay.addEventListener("click", event => {
    if(event.target === detailOverlay) detailOverlay.classList.remove("show");
  });
  el("detailOverlay").querySelector(".store-detail").addEventListener("click", event => {
    event.stopPropagation();
  });
  el("systemNavBtn").addEventListener("click", openSystemNav);
  el("reviewJumpBtn").addEventListener("click", () => scrollToSection("reviewSection"));
  el("submitReviewBtn").addEventListener("click", submitReview);
  el("detailFavBtn").addEventListener("click", () => {
    if(activeStore) toggleFavorite(activeStore.id);
  });

  el("viewerClose").addEventListener("click", closeImageViewer);
  el("viewerPrev").addEventListener("click", () => changeViewerImage(-1));
  el("viewerNext").addEventListener("click", () => changeViewerImage(1));

  setupRatingControl();
  setupImageViewerGestures();
  el("reviewPhotoFile").addEventListener("change", previewUpload);
}

async function loadStores(){
  if(BEE_PREVIEW_MODE_1230){
    stores = BEE_PREVIEW_STORES_1230.map(normalizeStore).filter(s => s.status !== "hidden" && Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if(!stores.length) stores = demoStores();
    render();
    setTimeout(() => {
      autoSelectPreviewMarker1230();
      hideLoading();
    }, 650);
    return;
  }

  try{
    const url = API_URL.includes("?") ? `${API_URL}&action=stores` : `${API_URL}?action=stores`;
    const response = await fetch(url, { cache:"no-store" });
    if(!response.ok) throw new Error("API 回應失敗");
    let data = await response.json();

    if(data && data.success === false) throw new Error(data.message || "API 回傳失敗");
    if(data && Array.isArray(data.stores)) data = data.stores;
    if(data && Array.isArray(data.data)) data = data.data;
    if(!Array.isArray(data)) throw new Error("API 格式不是陣列");

    stores = data.map(normalizeStore).filter(s => s.status !== "hidden" && Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if(!stores.length){
      stores = demoStores();
      showToast("試算表沒有可顯示店家，已載入示範資料");
    }
    render();
  }catch(error){
    console.error(error);
    stores = demoStores();
    render();
    showToast("讀不到試算表，已載入示範資料");
  }finally{
    setTimeout(() => loading.classList.add("hidden"), 650);
  }
}

function normalizeStore(row){
  const get = (...keys) => {
    for(const k of keys){
      if(row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    }
    return "";
  };
  return {
    id: String(get("編號","id","ID") || safeUUID()),
    name: String(get("店名","name") || "未命名店家"),
    category: String(get("分類","category") || "其他"),
    discount: String(get("優惠內容","discount","特約內容") || "尚未填寫特約內容"),
    description: String(get("店家介紹","description","說明") || "尚未新增店家介紹。"),
    extra: String(get("其他介紹","extra") || "尚未新增其他介紹。"),
    address: String(get("地址","address") || ""),
    lat: Number(get("緯度","lat","latitude")),
    lng: Number(get("經度","lng","longitude")),
    coverImage: normalizeImageUrl(String(get("封面照片","coverImage") || "")) || FALLBACK_IMG,
    gallery: splitImages(get("店內照片","gallery","照片")).map(normalizeImageUrl).filter(Boolean),
    extraImages: splitImages(get("其他圖片","extraImages")).map(normalizeImageUrl).filter(Boolean),
    openTime: normalizeTime(get("開始時間","openTime") || "09:00"),
    closeTime: normalizeTime(get("結束時間","closeTime") || "22:00"),
    status: String(get("顯示狀態","status") || "active"),
    phone: String(get("電話","phone") || ""),
    instagram: String(get("Instagram","instagram") || ""),
    website: String(get("網站","website") || ""),
    note: String(get("備註","note") || ""),
    reviews: Array.isArray(row.reviews) ? row.reviews : parseReviews(get("評價","reviews"))
  };
}

function normalizeTime(value){
  if(value instanceof Date){
    return `${String(value.getHours()).padStart(2,"0")}:${String(value.getMinutes()).padStart(2,"0")}`;
  }
  const text = String(value || "").trim();
  if(/^\d{1,2}:\d{2}$/.test(text)){
    const [h,m] = text.split(":").map(Number);
    if(h === 24 && m === 0) return "00:00";
    if(h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }
  return text || "09:00";
}

function normalizeImageUrl(url){
  const text = String(url || "").trim();
  if(!text) return "";
  const driveMatch = text.match(/drive\.google\.com\/file\/d\/([^/]+)/) || text.match(/[?&]id=([^&]+)/);
  if(driveMatch){
    return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
  }
  return text;
}

function splitImages(text){
  return String(text || "")
    .replace(/\r/g,"")
    .split(",")
    .flatMap(p => p.split("，"))
    .flatMap(p => p.split("\n"))
    .map(s => s.trim())
    .filter(Boolean);
}

function parseReviews(text){
  if(Array.isArray(text)) return text;
  try{
    const parsed = JSON.parse(text);
    if(Array.isArray(parsed)) return parsed;
  }catch(e){}
  return String(text || "").split("|").filter(Boolean).map((comment,i) => ({ id:"R"+i, rating:8, comment, photo:"" }));
}

function render(){
  if(!map || isRendering) return;
  isRendering = true;
  try{
    const filtered = getFilteredStores();
    storeCount.textContent = `探索 ${filtered.length} 間校園人氣特約`;
    clearMarkers();
    renderMarkers(filtered);
    renderList(filtered);
    renderSearchDropdown();
  }finally{
    isRendering = false;
  }
}

function getFilteredStores(){
  const keyword = searchInput.value.trim().toLowerCase();
  return stores.filter(store => {
    const text = `${store.name} ${store.category} ${store.discount} ${store.address}`.toLowerCase();
    return (!keyword || text.includes(keyword)) && (currentCategory === "全部" || store.category === currentCategory);
  }).sort((a,b) => getDistance(a) - getDistance(b));
}

function renderMarkers(list){
  if(!map || typeof L.markerClusterGroup !== "function") return;
  if(markerCluster){
    markerCluster.clearLayers();
    if(map.hasLayer(markerCluster)) map.removeLayer(markerCluster);
  }
  markerCluster = L.markerClusterGroup({
    showCoverageOnHover:false,
    maxClusterRadius:45,
    iconCreateFunction:cluster => L.divIcon({
      html:`<div style="width:48px;height:48px;border-radius:50%;background:#F6A800;color:white;display:grid;place-items:center;font-weight:900;border:4px solid white">${cluster.getChildCount()}</div>`,
      className:"",
      iconSize:[48,48]
    })
  });
  list.forEach(store => {
    const marker = L.marker([store.lat, store.lng], {
      icon: L.divIcon({
        className:"",
        html:`<div class="marker-wrap ${selectedMarkerStoreId === store.id ? 'selected' : ''}">
  ${selectedMarkerStoreId === store.id ? `
    <div class="marker-bubble">${escapeHtml(store.name)}</div>
    <svg class="marker-outline-svg" viewBox="0 0 60 60" aria-hidden="true">
      <defs>
        <linearGradient id="markerGradientSelected" x1="-120%" y1="120%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#FF7A00"/>
          <stop offset="45%" stop-color="#FFD000"/>
          <stop offset="70%" stop-color="#FFF06A"/>
          <stop offset="100%" stop-color="#FF7A00"/>
          <animate attributeName="x1" values="-120%;0%;120%" dur="1.6s" repeatCount="indefinite"/>
          <animate attributeName="x2" values="0%;120%;240%" dur="1.6s" repeatCount="indefinite"/>
          <animate attributeName="y1" values="120%;0%;-120%" dur="1.6s" repeatCount="indefinite"/>
          <animate attributeName="y2" values="0%;-120%;-240%" dur="1.6s" repeatCount="indefinite"/>
        </linearGradient>
      </defs>
      <polygon class="marker-outline-path" points="17,6 43,6 55,30 43,54 17,54 5,30" fill="none" stroke="url(#markerGradientSelected)"/>
    </svg>
  ` : ''}
  <div class="marker-pin ${markerClass(store.category)}"><span>${iconFor(store.category)}</span></div>
</div>`,
        iconSize:[46,46],
        iconAnchor:[23,23]
      })
    });
    marker.on("click", e => { if(e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); handleMarkerClick(store); });
    markerCluster.addLayer(marker);
  });
  if(markerCluster.getLayers().length) map.addLayer(markerCluster);
}

function handleMarkerClick(store){
  suppressNextMoveEnd = true;
  map.setView([store.lat, store.lng], Math.max(map.getZoom(),17), { animate:true });

  if(selectedMarkerStoreId === store.id){
    openStore(store);
    return;
  }

  selectedMarkerStoreId = store.id;
  setSheetExpanded(false);
  renderMarkers(getFilteredStores());
  renderList([store]);
}

function renderList(list){
  if(!list.length){
    storeList.innerHTML = `<div style="padding:22px;text-align:center;color:#756247;font-weight:800">附近還沒有符合的特約店家 🐝<br><small>換個關鍵字或分類試試看</small></div>`;
    return;
  }
  const isMobile = window.innerWidth < 768;
  const visibleList = bottomSheet.classList.contains("expanded")
    ? list
    : list.slice(0, isMobile ? 2 : 1);
  storeList.innerHTML = visibleList.map(store => `
    <button class="store-card float-in" data-id="${escapeAttr(store.id)}">
      <div class="store-cover-wrap">
        <img src="${escapeAttr(store.coverImage || FALLBACK_IMG)}" alt="${escapeAttr(store.name)}" onerror="this.src='${FALLBACK_IMG}'">
        ${isFavorite(store.id) ? '<span class="fav-badge">♥</span>' : ''}
      </div>
      <div>
        <div class="store-topline">
          <span class="store-status ${getOpenStatus(store)==='營業中'?'open':'close'}">${getOpenStatus(store)}</span>
          ${getDistance(store)<400?'<span class="hot-badge">熱門</span>':''}
        </div>
        <h3>${escapeHtml(store.name)}</h3>
        <p>${escapeHtml(store.discount)}</p>
        <div class="meta">
          <span class="tag">${escapeHtml(store.category)}</span>
          <span class="distance" data-store-id="${escapeAttr(store.id)}">${formatDistance(getDistance(store))}</span>
          <span class="mini-save">${isFavorite(store.id) ? '已收藏' : '未收藏'}</span>
        </div>
      </div>
    </button>
  `).join("");
  storeList.querySelectorAll(".store-card").forEach(card => {
    card.addEventListener("click", () => {
      const store = stores.find(s => s.id === card.dataset.id);
      if(!store) return;
      if(!bottomSheet.classList.contains("expanded")){
        setSheetExpanded(true);
        renderList(getFilteredStores());
        suppressNextMoveEnd = true;
        map.setView([store.lat,store.lng],Math.max(map.getZoom(),17),{animate:true});
        return;
      }
      openStore(store);
    });
  });
}

function updateVisibleDistancesOnly(){
  document.querySelectorAll(".distance[data-store-id]").forEach(node => {
    const store = stores.find(s => s.id === node.dataset.storeId);
    if(store) node.textContent = formatDistance(getDistance(store));
  });
}

function openStore(store){
  activeStore = store;
  saveStoreHistory(store.name);
  suppressNextMoveEnd = true;
  map.setView([store.lat,store.lng],Math.max(map.getZoom(),17),{animate:true});
  const photos = [store.coverImage, ...store.gallery].filter(Boolean);
  el("galleryTrack").innerHTML = photos.map(src => `<img src="${escapeAttr(src)}" onerror="this.src='${FALLBACK_IMG}'" onclick="openImageViewer(this.src)">`).join("");
  startGalleryAutoplay();
  el("photoGrid").innerHTML = photos.map(src => `<img src="${escapeAttr(src)}" onerror="this.src='${FALLBACK_IMG}'" onclick="openImageViewer(this.src)">`).join("");
  el("extraPhotos").innerHTML = store.extraImages.map(src => `<img src="${escapeAttr(src)}" onerror="this.src='${FALLBACK_IMG}'" onclick="openImageViewer(this.src)">`).join("");
  el("detailThumb").src = store.coverImage || FALLBACK_IMG;
  el("detailName").textContent = store.name;
  el("detailDiscount").textContent = store.discount;
  el("detailIntro").textContent = store.description;
  el("detailExtra").textContent = store.extra;
  el("detailCategory").textContent = store.category;
  el("detailOpen").textContent = getOpenStatus(store);
  el("detailDistance").textContent = formatDistance(getDistance(store));
  renderReviews(store);
  el("detailFavBtn").classList.toggle("active", isFavorite(store.id));
  detailOverlay.classList.add("show");
  setSheetExpanded(false);
}

function startGalleryAutoplay(){
  clearInterval(galleryTimer);
  const track = el("galleryTrack");
  const slides = track.querySelectorAll("img");
  if(slides.length <= 1) return;
  let index = 0;
  galleryTimer = setInterval(() => {
    index = (index + 1) % slides.length;
    track.scrollTo({ left:track.clientWidth*index, behavior:"smooth" });
  }, 2800);
}

function renderReviews(store) {
  const reviews = getLocalReviews(store.id).concat(store.reviews || []);
  const count = reviews.length;
  const avg = count
    ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / count
    : 0;

  el("avgScore").textContent = `${avg.toFixed(1)} / 10`;
  el("avgStars").textContent = toStars(avg);
  el("reviewCount").textContent = `${count} 則評價`;

  if (!count) {
    el("reviewList").innerHTML = `
      <p style="margin-top:12px;color:#756247">
        目前尚無評價，成為第一個評論的人。
      </p>
    `;
    return;
  }

  const avatarColors = [
    "#FFE8A3",
    "#FFD1B8",
    "#D9F2C7",
    "#CDE7FF",
    "#E6D7FF",
    "#FFD6E8"
  ];

  el("reviewList").innerHTML = reviews.map((review, index) => {
    const color = avatarColors[index % avatarColors.length];

    return `
      <div class="review-item">
        <div class="review-avatar" style="background:${color}"></div>
        <div>
          <div class="stars">${toStars(Number(review.rating || 0))}</div>
          <p>${escapeHtml(review.comment || "")}</p>
          ${
            review.photo
              ? `<img class="review-photo" src="${escapeAttr(review.photo)}" onclick="openImageViewer(this.src)">`
              : ""
          }
        </div>
      </div>
    `;
  }).join("");
}

function submitReview(){
  if(!activeStore) return;
  const reviewed = safeJsonParse(localStorage.getItem(STORAGE_REVIEWED), {});
  if(reviewed[activeStore.id]){
    showToast("此裝置已評價過這間店家");
    return;
  }
  const comment = el("reviewText").value.trim();
  const photo = el("uploadPreviewImg").dataset.src || "";
  if(!comment){
    showToast("請先輸入評價內容");
    return;
  }
  const reviews = getLocalReviews(activeStore.id);
  reviews.unshift({ rating:activeRating, comment, photo, createdAt:new Date().toISOString() });
  localStorage.setItem("reviews_"+activeStore.id, JSON.stringify(reviews));
  reviewed[activeStore.id] = true;
  localStorage.setItem(STORAGE_REVIEWED, JSON.stringify(reviewed));
  el("reviewText").value = "";
  el("reviewPhotoFile").value = "";
  el("uploadPreview").classList.remove("show");
  el("uploadPreviewImg").src = "";
  el("uploadPreviewImg").dataset.src = "";
  renderReviews(activeStore);
  showToast("評價已送出，正式版會進入後台審核");
}

function getLocalReviews(storeId){
  return safeJsonParse(localStorage.getItem("reviews_"+storeId), []);
}

function toggleFavorite(id){
  const already = isFavorite(id);
  const arr = getStorageArr(STORAGE_FAV);
  const next = already ? arr.filter(v => v !== id) : uniqueRecent([id, ...arr]);
  localStorage.setItem(STORAGE_FAV, JSON.stringify(next));
  if(activeStore && activeStore.id === id){
    const btn = el("detailFavBtn");
    btn.classList.toggle("active", !already);
    btn.animate([{transform:"scale(1)"},{transform:"scale(1.25)"},{transform:"scale(1.04)"}],{duration:360,easing:"cubic-bezier(.22,1,.36,1)"});
  }
  renderList(bottomSheet.classList.contains("expanded") ? getFilteredStores() : (selectedMarkerStoreId ? [stores.find(s=>s.id===selectedMarkerStoreId)].filter(Boolean) : getFilteredStores()));
  showToast(already ? "已取消收藏" : "已加入收藏");
}
function isFavorite(id){ return getStorageArr(STORAGE_FAV).includes(id); }

function openSystemNav(){
  if(!activeStore) return;
  const useGoogle = confirm("要使用 Google 地圖導航嗎？\n按「取消」則改用 Apple 地圖。");
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${activeStore.lat},${activeStore.lng}`;
  const appleUrl = `https://maps.apple.com/?daddr=${activeStore.lat},${activeStore.lng}`;
  window.open(useGoogle ? googleUrl : appleUrl, "_blank");
}

function locateUser(showMessage){
  if(!navigator.geolocation){
    if(showMessage) showToast("此裝置不支援定位");
    return;
  }
  const applyPosition = pos => {
    userLatLng = [pos.coords.latitude, pos.coords.longitude];
    if(userMarker) userMarker.remove();
    userMarker = L.marker(userLatLng,{icon:L.divIcon({className:"",html:`<div class="user-marker"></div>`,iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);
    updateVisibleDistancesOnly();
    if(showMessage){
      suppressNextMoveEnd = true;
      map.setView(userLatLng,16,{animate:true});
      showToast("已定位目前位置");
    }
  };
  navigator.geolocation.getCurrentPosition(applyPosition, () => {
    if(showMessage) showToast("無法取得定位，請確認瀏覽器權限");
  }, { enableHighAccuracy:true, timeout:8000, maximumAge:10000 });

  if(!geoWatchId){
    geoWatchId = navigator.geolocation.watchPosition(pos => {
      userLatLng = [pos.coords.latitude, pos.coords.longitude];
      if(userMarker) userMarker.setLatLng(userLatLng);
      updateVisibleDistancesOnly();
    }, () => {}, { enableHighAccuracy:false, timeout:12000, maximumAge:30000 });
  }
}

function switchMapLayer(mode){
  if(currentLayerMode === mode) return;
  currentLayerMode = mode;
  if(mode === "satellite"){
    map.removeLayer(normalLayer);
    satelliteLayer.addTo(map);
    document.body.classList.add("satellite-mode");
    el("layerToggleBtn").classList.add("active");
  }else{
    map.removeLayer(satelliteLayer);
    normalLayer.addTo(map);
    document.body.classList.remove("satellite-mode");
    el("layerToggleBtn").classList.remove("active");
  }
}

function clearMarkers(){
  if(markerCluster && map.hasLayer(markerCluster)) map.removeLayer(markerCluster);
}

function getDistance(store){
  return userLatLng ? haversine(userLatLng[0],userLatLng[1],store.lat,store.lng) : haversine(DEFAULT_CENTER[0],DEFAULT_CENTER[1],store.lat,store.lng);
}
function haversine(lat1,lng1,lat2,lng2){
  const R=6371000,toRad=deg=>deg*Math.PI/180,dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function formatDistance(m){
  return !Number.isFinite(m) ? "距離未知" : m>=1000 ? `${(m/1000).toFixed(1)} 公里` : `${Math.round(m)} 公尺`;
}

function getOpenStatus(store){
  const now = new Date();
  const nowMinutes = now.getHours()*60 + now.getMinutes();
  const openMinutes = timeToMinutes(store.openTime || "09:00");
  const closeMinutes = timeToMinutes(store.closeTime || "22:00");
  if(!Number.isFinite(openMinutes) || !Number.isFinite(closeMinutes)) return "營業時間未定";
  if(openMinutes === closeMinutes) return "營業中";
  const isOpen = openMinutes < closeMinutes
    ? nowMinutes >= openMinutes && nowMinutes <= closeMinutes
    : nowMinutes >= openMinutes || nowMinutes <= closeMinutes;
  return isOpen ? "營業中" : "已休息";
}
function timeToMinutes(value){
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!match) return NaN;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if(hour < 0 || hour > 23 || minute < 0 || minute > 59) return NaN;
  return hour*60 + minute;
}

function categorySvg(c){return({"食":`<svg viewBox='0 0 24 24'><path d='M6 3v5'/><path d='M8 3v5'/><path d='M10 3v5'/><path d='M8 8v13'/><path d='M16 3v18'/><path d='M14 3h4'/></svg>`,"衣":`<svg viewBox='0 0 24 24'><path d='M7 6l5-3 5 3 2 4-3 2v8H8v-8L5 10l2-4z'/></svg>`,"住":`<svg viewBox='0 0 24 24'><path d='M3 11l9-7 9 7'/><path d='M7 10v10h10V10'/></svg>`,"行":`<svg viewBox='0 0 24 24'><path d='M5 15h14'/><path d='M7 15l2-5h6l2 5'/><path d='M9 10h6'/><circle cx='8.5' cy='18' r='1.7'/><circle cx='15.5' cy='18' r='1.7'/></svg>`,"育":`<svg viewBox='0 0 24 24'><path d='M4 7l8-3 8 3-8 3-8-3z'/><path d='M7 11v4c0 1.2 2.2 3 5 3s5-1.8 5-3v-4'/></svg>`,"樂":`<svg viewBox='0 0 24 24'><path d='M9 18V6l10-2v12'/><circle cx='7' cy='18' r='2'/><circle cx='17' cy='16' r='2'/></svg>`}[c]||`<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='7'/></svg>`)}
function iconFor(c){return categorySvg(c)}
function mountCategoryIcons(){document.querySelectorAll(".pill-icon").forEach(item => {item.innerHTML = categorySvg(item.dataset.icon)})}
function markerClass(c){return({"食":"marker-food","衣":"marker-cloth","住":"marker-home","行":"marker-move","育":"marker-edu","樂":"marker-fun"}[c]||"marker-other")}
function toStars(score){const stars=Math.max(0,Math.min(5,Math.round(Number(score||0)/2)));return"★".repeat(stars)+"☆".repeat(5-stars)}


function hideLoading(){
  if(!loading) return;
  loading.classList.add("leaving");
  setTimeout(() => {
    hideLoading();
  }, 1650);
}

function showToast(text){toastBox.textContent=text;toastBox.style.display="block";clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>toastBox.style.display="none",2200)}
function setSheetExpanded(expanded){
  bottomSheet.classList.toggle("expanded",expanded);
  document.querySelector(".app").classList.toggle("sheet-expanded",expanded);
  bottomSheet.style.height = expanded ? "68vh" : "185px";
  document.documentElement.style.setProperty("--sheet-h", expanded ? "68vh" : "185px");
}
function toggleBottomSheet(){setSheetExpanded(!bottomSheet.classList.contains("expanded"));setTimeout(()=>renderList(getFilteredStores()),120)}
function setupBottomSheetDrag(){
  let startY=0,startHeight=185,lastY=0,lastTime=0,velocity=0,isDragging=false;
  bottomSheet.addEventListener("touchstart",e=>{
    if(e.target.closest(".store-card")) return;
    isDragging=true;startY=e.touches[0].clientY;lastY=startY;lastTime=Date.now();startHeight=bottomSheet.offsetHeight;bottomSheet.style.transition="none";
  },{passive:true});
  bottomSheet.addEventListener("touchmove",e=>{
    if(!isDragging) return;
    const currentY=e.touches[0].clientY, delta=startY-currentY, now=Date.now();
    velocity=(lastY-currentY)/(now-lastTime+1);lastY=currentY;lastTime=now;
    let next=startHeight+delta, max=window.innerHeight*.68;
    if(next<185) next=185-(185-next)*.18;
    if(next>max) next=max+(next-max)*.12;
    bottomSheet.style.height=next+"px";
  },{passive:true});
  bottomSheet.addEventListener("touchend",()=>{
    if(!isDragging) return;
    isDragging=false;bottomSheet.style.transition="height .42s cubic-bezier(.22,1,.36,1)";
    const expanded=velocity>.45||bottomSheet.offsetHeight>window.innerHeight*.42;
    setSheetExpanded(expanded);renderList(getFilteredStores());
  });
}

function escapeHtml(text){return String(text||"").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"}[ch]))}
function escapeAttr(text){return escapeHtml(text).replaceAll("`","&#096;")}
function scrollToSection(id){el(id).scrollIntoView({behavior:"smooth",block:"start"})}

function saveSearch(text){
  const clean = String(text || "").trim();
  if(!clean) return;
  const arr = uniqueRecent([clean, ...getStorageArr(STORAGE_SEARCH)]);
  localStorage.setItem(STORAGE_SEARCH, JSON.stringify(arr.slice(0,8)));
  renderSearchDropdown();
}
function saveStoreHistory(name){
  const arr = uniqueRecent([name, ...getStorageArr(STORAGE_STORE)]);
  localStorage.setItem(STORAGE_STORE, JSON.stringify(arr.slice(0,8)));
}
function removeHistoryItem(type,label){
  const key = type === "search" ? STORAGE_SEARCH : STORAGE_STORE;
  const arr = getStorageArr(key).filter(item => item !== label);
  localStorage.setItem(key, JSON.stringify(arr));
  renderSearchDropdown();
}
function getStorageArr(key){return safeJsonParse(localStorage.getItem(key),[])}
function uniqueRecent(arr){
  const seen = new Set();
  return arr.map(v => String(v || "").trim()).filter(v => {
    const key = v.toLowerCase();
    if(!v || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderSearchDropdown(){
  const focused = document.activeElement === searchInput;
  const keyword = searchInput.value.trim().toLowerCase();
  let items = [];
  if(keyword){
    items = getFilteredStores().slice(0,6).map(store=>({type:"store",label:store.name,note:`${store.category} · ${formatDistance(getDistance(store))}`,id:store.id}));
  }else if(focused){
    items = [
      ...getStorageArr(STORAGE_SEARCH).map(label=>({type:"search",label,note:"搜尋紀錄"})),
      ...getStorageArr(STORAGE_STORE).map(label=>({type:"historyStore",label,note:"看過的店家"}))
    ].slice(0,8);
  }
  dropdown.classList.toggle("show",items.length>0&&focused);
  document.querySelector(".app").classList.toggle("searching",items.length>0&&focused);
  dropdown.innerHTML = items.map(item => {
    const deletable = item.type === "search" || item.type === "historyStore";
    return `<button class="dropdown-item ${deletable?'has-delete':''}" data-type="${escapeAttr(item.type)}" data-id="${escapeAttr(item.id||"")}" data-label="${escapeAttr(item.label)}"><span class="dropdown-text">${escapeHtml(item.label)}<small>${escapeHtml(item.note)}</small></span>${deletable?`<span class="history-delete" data-delete="1">×</span>`:""}</button>`;
  }).join("");
  dropdown.querySelectorAll(".dropdown-item").forEach(btn => btn.addEventListener("click", event => {
    if(event.target.closest("[data-delete]")){
      event.stopPropagation();
      removeHistoryItem(btn.dataset.type,btn.dataset.label);
      return;
    }
    if(btn.dataset.type === "store"){
      const store = stores.find(s => s.id === btn.dataset.id);
      if(store){
        searchInput.value = store.name;
        clearBtn.classList.add("show");
        saveSearch(store.name);
        openStore(store);
      }
    }else{
      searchInput.value = btn.dataset.label;
      clearBtn.classList.add("show");
      saveSearch(btn.dataset.label);
      render();
    }
    dropdown.classList.remove("show");
  }));
}

function setupRatingControl(){
  const ratingNumber = el("ratingNumber");
  const starDrag = el("starDrag");
  const starFill = el("starFill");
  updateRatingUI(10);
  ratingNumber.addEventListener("input",()=>updateRatingUI(Number(ratingNumber.value)));
  const updateByPointer = event => {
    const rect = starDrag.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX-rect.left,0),rect.width);
    const value = Math.round((x/rect.width)*100)/10;
    updateRatingUI(value);
  };
  starDrag.addEventListener("pointerdown", event => {
    updateByPointer(event);
    starDrag.setPointerCapture(event.pointerId);
    starDrag.onpointermove = updateByPointer;
  });
  starDrag.addEventListener("pointerup", () => starDrag.onpointermove = null);
}
function updateRatingUI(value){
  activeRating = Math.max(0,Math.min(10,Number.isFinite(value)?value:0));
  activeRating = Math.round(activeRating*10)/10;
  el("ratingNumber").value = activeRating;
  el("starFill").style.width = `${activeRating*10}%`;
}
function previewUpload(){
  const file = el("reviewPhotoFile").files && el("reviewPhotoFile").files[0];
  if(!file){el("uploadPreview").classList.remove("show");return}
  const reader = new FileReader();
  reader.onload = () => {
    el("uploadPreviewImg").src = reader.result;
    el("uploadPreviewImg").dataset.src = reader.result;
    el("uploadPreview").classList.add("show");
  };
  reader.readAsDataURL(file);
}

function openImageViewer(src){
  viewerImages = [...new Set([...(activeStore ? [activeStore.coverImage,...activeStore.gallery,...activeStore.extraImages] : []).filter(Boolean)])];
  viewerIndex = Math.max(0,viewerImages.indexOf(src));
  imgScale=1;viewerImg.src=src;setViewerScale(1);imageViewer.classList.add("show");
}
function closeImageViewer(){imageViewer.classList.remove("show")}
function changeViewerImage(direction){
  if(!viewerImages.length) return;
  viewerIndex = (viewerIndex + direction + viewerImages.length) % viewerImages.length;
  viewerImg.src = viewerImages[viewerIndex];
  setViewerScale(1);
}
function setViewerScale(scale){imgScale=scale;viewerImg.style.transform=`scale(${imgScale})`}
function setupImageViewerGestures(){
  let startDistance=0,startScale=1,startX=0;
  imageViewer.addEventListener("touchstart",event=>{
    if(event.touches.length===2){startDistance=touchDistance(event.touches[0],event.touches[1]);startScale=imgScale}
    if(event.touches.length===1){startX=event.touches[0].clientX}
  },{passive:false});
  imageViewer.addEventListener("touchmove",event=>{
    if(event.touches.length===2){event.preventDefault();const current=touchDistance(event.touches[0],event.touches[1]);setViewerScale(Math.max(1,Math.min(4,startScale*(current/startDistance))))}
  },{passive:false});
  imageViewer.addEventListener("touchend",event=>{
    if(event.changedTouches.length===1&&imgScale<=1.05){const diff=event.changedTouches[0].clientX-startX;if(Math.abs(diff)>60){changeViewerImage(diff>0?-1:1)}}
  });
}
function touchDistance(a,b){const dx=a.clientX-b.clientX,dy=a.clientY-b.clientY;return Math.sqrt(dx*dx+dy*dy)}

function runLoadingIcons(){
  const wrap = body => `<svg viewBox="0 0 120 120"><g class="draw-line">${body}</g></svg>`;
  const icons = [
    wrap(`<path d="M35 24v34"/><path d="M47 24v34"/><path d="M35 39h12"/><path d="M41 58v38"/><path d="M78 24v72"/><path d="M69 24h18"/>`),
    wrap(`<path d="M38 34l22-12 22 12 13 20-18 10v34H43V64L25 54l13-20z"/>`),
    wrap(`<path d="M24 58l36-30 36 30"/><path d="M35 54v44h50V54"/>`),
    wrap(`<path d="M25 76h70"/><path d="M34 76l10-26h32l10 26"/><path d="M46 50h28"/><circle cx="42" cy="88" r="7"/><circle cx="78" cy="88" r="7"/>`),
    wrap(`<path d="M24 42l36-14 36 14-36 14-36-14z"/><path d="M38 58v18c0 8 10 18 22 18s22-10 22-18V58"/>`),
    wrap(`<path d="M44 88V32l42-9v52"/><circle cx="35" cy="88" r="9"/><circle cx="77" cy="75" r="9"/>`)
  ];
  let i=0,box=el("lineIcon");
  box.innerHTML=icons[0];
  setInterval(()=>{i=(i+1)%icons.length;box.innerHTML=icons[i]},1450);
}

function safeUUID(){return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():"id_"+Date.now()+"_"+Math.random().toString(36).slice(2)}
function safeJsonParse(text,fallback){try{return JSON.parse(text||"")}catch(e){return fallback}}
function runTests(){
  console.assert(document.getElementById("searchInput"),"search input exists");
  console.assert(uniqueRecent(["A","a","B"]).length===2,"search history unique");
  console.assert(timeToMinutes("03:00")===180,"time parser");
  console.assert(normalizeImageUrl("https://drive.google.com/file/d/abc123/view").includes("abc123"),"drive url normalize");
}
function demoStores(){
  return [
    {id:"D001",name:"咕嚕叫土司（鹽行店）",category:"食",discount:"請填入學生會特約優惠內容",description:"鹽行周邊吐司、漢堡、蛋餅店家。",extra:"適合晚餐、宵夜時段。",address:"台南市永康區",lat:23.0400,lng:120.2400,coverImage:FALLBACK_IMG,gallery:[FALLBACK_IMG],extraImages:[],openTime:"19:00",closeTime:"03:00",reviews:[],status:"active"},
    {id:"D002",name:"哈胖 high 胖－鹽行店",category:"食",discount:"請填入學生會特約優惠內容",description:"鹽行周邊餐飲店家。",extra:"適合學生晚餐、宵夜合作店家。",address:"台南市永康區",lat:23.0410,lng:120.2410,coverImage:FALLBACK_IMG,gallery:[FALLBACK_IMG],extraImages:[],openTime:"17:00",closeTime:"00:30",reviews:[],status:"active"}
  ];
}
