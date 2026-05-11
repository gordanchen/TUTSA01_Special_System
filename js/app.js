'use strict';

const API_URL = 'https://script.google.com/macros/s/AKfycbzXQtCgRc4TIRyjer_zBLczTEP_e45Ek7YZhsLga2Q6zVL2k5gUTQ8fIO40LPYOudq7/exec';
const DEFAULT_CENTER = [23.0384, 120.2399];
const DEFAULT_ZOOM = 16;
const FALLBACK_IMG = 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?q=80&w=1200&auto=format&fit=crop';
const STORAGE_SEARCH = 'beeMapSearchHistory';
const STORAGE_STORE = 'beeMapStoreHistory';
const STORAGE_REVIEWED = 'beeMapReviewedStores';
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

let map = null;
let userLatLng = null;
let userMarker = null;
let currentCategory = '全部';
let activeStore = null;
let activeRating = 10;
let imgScale = 1;
let stores = [];
let markers = [];
let markerCluster = null;
let normalLayer = null;
let satelliteLayer = null;
let currentLayerMode = 'normal';
let galleryTimer = null;
let viewerImages = [];
let viewerIndex = 0;
let isRendering = false;
let renderTimer = null;
let geoWatchId = null;
let suppressNextMoveEnd = false;

const el = id => document.getElementById(id);
const searchInput = el('searchInput');
const storeList = el('storeList');
const storeCount = el('storeCount');
const loading = el('loading');
const toastBox = el('toast');
const bottomSheet = el('bottomSheet');
const dropdown = el('searchDropdown');
const clearBtn = el('clearBtn');
const detailOverlay = el('detailOverlay');
const imageViewer = el('imageViewer');
const viewerImg = el('viewerImg');
const ratingNumber = el('ratingNumber');
const starDrag = el('starDrag');
const starFill = el('starFill');
const reviewPhotoFile = el('reviewPhotoFile');
const uploadPreview = el('uploadPreview');
const uploadPreviewImg = el('uploadPreviewImg');

init();

async function init() {
  try {
    runTests();
    runLoadingIcons();
    setupMap();
    setupEvents();
    await loadStores();
    locateUser(false);
  } catch (error) {
    console.error(error);
    stores = demoStores();
    render();
    loading.classList.add('hidden');
    showToast('系統初始化失敗，已載入示範資料');
  }
}

function setupMap() {
  if (typeof L === 'undefined') throw new Error('Leaflet 尚未載入');
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  normalLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '© OpenStreetMap' });
  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, attribution: '© Esri' });
  normalLayer.addTo(map);
  let mapMoveTimer = null;
  map.on('moveend', () => {
    if (suppressNextMoveEnd) { suppressNextMoveEnd = false; return; }
    if (detailOverlay.classList.contains('show')) return;
    clearTimeout(mapMoveTimer);
    mapMoveTimer = setTimeout(() => renderList(getFilteredStores()), 260);
  });
}

function setupEvents() {
  mountCategoryIcons();
  setupBottomSheetDrag();
  searchInput.addEventListener('input', () => {
    clearBtn.classList.toggle('show', Boolean(searchInput.value.trim()));
    render();
    renderSearchDropdown();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && searchInput.value.trim()) saveSearch(searchInput.value.trim());
  });
  searchInput.addEventListener('focus', () => {
    setSheetExpanded(false);
    document.querySelector('.app').classList.add('searching');
    renderSearchDropdown();
  });
  searchInput.addEventListener('blur', () => setTimeout(() => {
    dropdown.classList.remove('show');
    document.querySelector('.app').classList.remove('searching');
  }, 180));
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.remove('show');
    render();
    renderSearchDropdown();
  });
  el('homeBtn').addEventListener('click', () => {
    suppressNextMoveEnd = true;
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    detailOverlay.classList.remove('show');
    setSheetExpanded(false);
    renderList(getFilteredStores());
  });
  el('filterRow').addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    currentCategory = btn.dataset.category;
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
  el('locateBtn').addEventListener('click', () => locateUser(true));
  el('zoomInBtn').addEventListener('click', () => map.zoomIn());
  el('zoomOutBtn').addEventListener('click', () => map.zoomOut());
  el('layerToggleBtn').addEventListener('click', () => switchMapLayer(currentLayerMode === 'normal' ? 'satellite' : 'normal'));
  el('sheetToggle').addEventListener('click', toggleBottomSheet);
  document.querySelector('.sheet-header').addEventListener('click', toggleBottomSheet);
  el('closeDetailBtn').addEventListener('click', () => detailOverlay.classList.remove('show'));
  el('systemNavBtn').addEventListener('click', openSystemNav);
  el('submitReviewBtn').addEventListener('click', submitReview);
  el('viewerClose').addEventListener('click', closeImageViewer);
  el('viewerPrev').addEventListener('click', () => changeViewerImage(-1));
  el('viewerNext').addEventListener('click', () => changeViewerImage(1));
  setupRatingControl();
  setupImageViewerGestures();
  reviewPhotoFile.addEventListener('change', previewUpload);
}

async function loadStores() {
  try {
    const data = await requestStores();
    const rows = normalizeApiPayload(data);
    stores = rows.map(normalizeStore).filter(store => store.status !== 'hidden' && Number.isFinite(store.lat) && Number.isFinite(store.lng));
    if (!stores.length) {
      stores = demoStores();
      showToast('試算表目前沒有可顯示店家，先載入示範資料');
    }
    render();
  } catch (error) {
    console.error('讀取試算表失敗：', error);
    stores = demoStores();
    render();
    showToast('試算表讀取失敗，已載入示範資料');
  } finally {
    setTimeout(() => loading.classList.add('hidden'), 650);
  }
}

async function requestStores() {
  const url = withQuery(API_URL, { action: 'stores' });
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`API 回應失敗：${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn('fetch 讀取失敗，改用 JSONP 備援：', error);
    return requestStoresByJsonp(url);
  }
}

function requestStoresByJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `__beeMapCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP 逾時，請檢查 Apps Script 部署權限'));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = data => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP 載入失敗'));
    };

    script.src = withQuery(url, { callback: callbackName, t: Date.now() });
    document.body.appendChild(script);
  });
}

function normalizeApiPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.stores)) return data.stores;
  if (data && data.ok === false) throw new Error(data.message || 'Apps Script 回傳錯誤');
  throw new Error('API 格式不正確，應回傳陣列或 { ok:true, data:[...] }');
}

function withQuery(url, params) {
  const u = new URL(url, window.location.href);
  Object.entries(params).forEach(([key, value]) => u.searchParams.set(key, value));
  return u.toString();
}

function normalizeStore(row) {
  const lat = Number(row.lat || row.Lat || row.latitude || row['緯度'] || row['店家緯度']);
  const lng = Number(row.lng || row.Lng || row.longitude || row['經度'] || row['店家經度']);
  return {
    id: String(row.id || row.ID || safeUUID()),
    name: row.name || row['店名'] || row['店家名稱'] || '未命名店家',
    category: row.category || row['分類'] || '其他',
    discount: row.discount || row['特約內容'] || row['優惠內容'] || row.description || '尚未填寫特約內容',
    openTime: row.openTime || row['開始營業'] || '09:00',
    closeTime: row.closeTime || row['結束營業'] || '22:00',
    description: row.description || row['店家介紹'] || row['說明'] || '尚未新增店家介紹。',
    extra: row.extra || row['其他介紹'] || '尚未新增其他介紹。',
    address: row.address || row['地址'] || '',
    lat, lng,
    coverImage: row.coverImage || row['封面照片'] || row['店家封面'] || FALLBACK_IMG,
    gallery: splitImages(row.gallery || row['店內照片'] || row.photos || row['照片'] || ''),
    extraImages: splitImages(row.extraImages || row['其他圖片'] || ''),
    googleMapUrl: row.googleMapUrl || row['Google地圖'] || '',
    appleMapUrl: row.appleMapUrl || row['Apple地圖'] || '',
    status: row.status || row['狀態'] || 'active',
    reviews: parseReviews(row.reviews || row['評價'] || '')
  };
}

function splitImages(text) {
  const cleaned = String(text || '').split(CR).join('');
  return cleaned.split(',').flatMap(p => p.split('，')).flatMap(p => p.split(LF)).map(s => s.trim()).filter(Boolean);
}

function parseReviews(text) {
  if (Array.isArray(text)) return text;
  try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed; } catch (e) {}
  return String(text || '').split('|').filter(Boolean).map((comment, i) => ({ id: 'R' + i, rating: 8, comment, photo: '' }));
}

function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => render(), 180); }
function render() {
  if (!map || isRendering) return;
  isRendering = true;
  try {
    const filtered = getFilteredStores();
    storeCount.textContent = `探索 ${filtered.length} 間校園人氣特約`;
    clearMarkers();
    renderMarkers(filtered);
    renderList(filtered);
    renderSearchDropdown();
  } finally { isRendering = false; }
}

function getFilteredStores() {
  const keyword = searchInput.value.trim().toLowerCase();
  return stores.filter(store => {
    const text = `${store.name} ${store.category} ${store.discount} ${store.address}`.toLowerCase();
    return (!keyword || text.includes(keyword)) && (currentCategory === '全部' || store.category === currentCategory);
  }).sort((a, b) => getDistance(a) - getDistance(b));
}

function renderMarkers(list) {
  if (!map || typeof L.markerClusterGroup !== 'function') return;
  if (markerCluster) {
    markerCluster.clearLayers();
    if (map.hasLayer(markerCluster)) map.removeLayer(markerCluster);
  }
  markerCluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    iconCreateFunction: cluster => L.divIcon({
      html: `<div style="width:48px;height:48px;border-radius:50%;background:#F6A800;color:white;display:grid;place-items:center;font-weight:900;border:4px solid white">${cluster.getChildCount()}</div>`,
      className: '', iconSize: [48, 48]
    })
  });
  list.forEach(store => {
    const marker = L.marker([store.lat, store.lng], {
      icon: L.divIcon({ className: '', html: `<div class="marker-pin ${markerClass(store.category)}"><span>${iconFor(store.category)}</span></div>`, iconSize: [42, 42], iconAnchor: [21, 21] })
    });
    marker.on('click', () => {
      suppressNextMoveEnd = true;
      map.setView([store.lat, store.lng], Math.max(map.getZoom(), 17), { animate: true });
      setSheetExpanded(false);
      renderList([store]);
    });
    markers.push(marker);
    markerCluster.addLayer(marker);
  });
  if (markerCluster.getLayers().length) map.addLayer(markerCluster);
}

function renderList(list) {
  if (!list.length) {
    storeList.innerHTML = '<div style="padding:22px;text-align:center;color:#756247;font-weight:800">附近還沒有符合的特約店家 🐝<br><small>換個關鍵字或分類試試看</small></div>';
    return;
  }
  const visibleList = bottomSheet.classList.contains('expanded') ? list : list.slice(0, 1);
  storeList.innerHTML = visibleList.map(store => `<button class="store-card float-in" data-id="${escapeAttr(store.id)}"><div class="store-cover-wrap"><img src="${escapeAttr(store.coverImage || FALLBACK_IMG)}" alt="${escapeAttr(store.name)}" onerror="this.src='${FALLBACK_IMG}'">${isFavorite(store.id) ? '<span class="fav-badge">♥</span>' : ''}</div><div><div class="store-topline"><span class="store-status ${getOpenStatus(store) === '營業中' ? 'open' : 'close'}">${getOpenStatus(store)}</span>${getDistance(store) < 400 ? '<span class="hot-badge">熱門</span>' : ''}</div><h3>${escapeHtml(store.name)}</h3><p>${escapeHtml(store.discount)}</p><div class="meta"><span class="tag">${escapeHtml(store.category)}</span><span class="distance">${formatDistance(getDistance(store))}</span><span class="mini-save">${getFavoriteCount(store.id)} 收藏</span></div></div></button>`).join('');
  storeList.querySelectorAll('.store-card').forEach(card => card.addEventListener('click', () => {
    const store = stores.find(s => s.id === card.dataset.id);
    if (!store) return;
    if (!bottomSheet.classList.contains('expanded')) {
      setSheetExpanded(true);
      renderList(getFilteredStores());
      suppressNextMoveEnd = true;
      map.setView([store.lat, store.lng], Math.max(map.getZoom(), 17), { animate: true });
      return;
    }
    openStore(store);
  }));
}

function openStore(store) {
  activeStore = store;
  saveStoreHistory(store.name);
  suppressNextMoveEnd = true;
  map.setView([store.lat, store.lng], Math.max(map.getZoom(), 17), { animate: true });
  const photos = [store.coverImage, ...store.gallery].filter(Boolean);
  el('galleryTrack').innerHTML = photos.map(src => `<img src="${escapeAttr(src)}" onerror="this.src='${FALLBACK_IMG}'" onclick="openImageViewer(this.src)">`).join('');
  startGalleryAutoplay();
  el('photoGrid').innerHTML = photos.map(src => `<img src="${escapeAttr(src)}" onerror="this.src='${FALLBACK_IMG}'" onclick="openImageViewer(this.src)">`).join('');
  el('extraPhotos').innerHTML = store.extraImages.map(src => `<img src="${escapeAttr(src)}" onerror="this.src='${FALLBACK_IMG}'" onclick="openImageViewer(this.src)">`).join('');
  el('detailThumb').src = store.coverImage || FALLBACK_IMG;
  el('detailName').textContent = store.name;
  el('detailDiscount').textContent = store.discount;
  el('detailIntro').textContent = store.description;
  el('detailExtra').textContent = store.extra;
  el('detailCategory').textContent = store.category;
  el('detailOpen').textContent = getOpenStatus(store);
  el('detailDistance').textContent = formatDistance(getDistance(store));
  renderReviews(store);
  el('detailFavBtn').classList.toggle('active', isFavorite(store.id));
  detailOverlay.classList.add('show');
  setSheetExpanded(false);
}

function startGalleryAutoplay() {
  clearInterval(galleryTimer);
  const track = el('galleryTrack');
  const slides = track.querySelectorAll('img');
  if (slides.length <= 1) return;
  let index = 0;
  galleryTimer = setInterval(() => { index = (index + 1) % slides.length; track.scrollTo({ left: track.clientWidth * index, behavior: 'smooth' }); }, 2800);
}

function renderReviews(store) {
  const reviews = getLocalReviews(store.id).concat(store.reviews || []);
  const count = reviews.length;
  const avg = count ? reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / count : 0;
  el('avgScore').textContent = `${avg.toFixed(1)} / 10`;
  el('avgStars').textContent = toStars(avg);
  el('reviewCount').textContent = `${count} 則評價`;
  el('reviewList').innerHTML = count ? reviews.map(r => `<div class="review-item"><div class="review-avatar">匿</div><div><div class="stars">${toStars(Number(r.rating || 0))}</div><p>${escapeHtml(r.comment || '')}</p>${r.photo ? `<img class="review-photo" src="${escapeAttr(r.photo)}" onclick="openImageViewer(this.src)">` : ''}</div></div>`).join('') : '<p style="margin-top:12px;color:#756247">目前尚無評價，成為第一個評論的人。</p>';
}

function submitReview() {
  if (!activeStore) return;
  const reviewed = safeJsonParse(localStorage.getItem(STORAGE_REVIEWED), {});
  if (reviewed[activeStore.id]) { showToast('此裝置已評價過這間店家'); return; }
  const comment = el('reviewText').value.trim();
  const photo = uploadPreviewImg.dataset.src || '';
  if (!comment) { showToast('請先輸入評價內容'); return; }
  const reviews = getLocalReviews(activeStore.id);
  reviews.unshift({ rating: activeRating, comment, photo, createdAt: new Date().toISOString() });
  localStorage.setItem('reviews_' + activeStore.id, JSON.stringify(reviews));
  reviewed[activeStore.id] = true;
  localStorage.setItem(STORAGE_REVIEWED, JSON.stringify(reviewed));
  el('reviewText').value = '';
  reviewPhotoFile.value = '';
  uploadPreview.classList.remove('show');
  uploadPreviewImg.src = '';
  uploadPreviewImg.dataset.src = '';
  renderReviews(activeStore);
  showToast('評價已送出，正式版會進入後台審核');
}

function getLocalReviews(storeId) { return safeJsonParse(localStorage.getItem('reviews_' + storeId), []); }
function openSystemNav() {
  if (!activeStore) return;
  const useGoogle = confirm(['要使用 Google 地圖導航嗎？', '按「取消」則改用 Apple 地圖。'].join(LF));
  const googleUrl = activeStore.googleMapUrl || `https://www.google.com/maps/dir/?api=1&destination=${activeStore.lat},${activeStore.lng}`;
  const appleUrl = activeStore.appleMapUrl || `https://maps.apple.com/?daddr=${activeStore.lat},${activeStore.lng}`;
  window.open(useGoogle ? googleUrl : appleUrl, '_blank');
}

function locateUser(showMessage) {
  if (!navigator.geolocation) { if (showMessage) showToast('此裝置不支援定位'); return; }
  const applyPosition = pos => {
    userLatLng = [pos.coords.latitude, pos.coords.longitude];
    if (userMarker) userMarker.remove();
    userMarker = L.marker(userLatLng, { icon: L.divIcon({ className: '', html: '<div class="user-marker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
    scheduleRender();
    if (showMessage) { suppressNextMoveEnd = true; map.setView(userLatLng, 16, { animate: true }); showToast('已定位目前位置'); }
  };
  navigator.geolocation.getCurrentPosition(applyPosition, () => { if (showMessage) showToast('無法取得定位，請確認瀏覽器權限'); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
  if (!geoWatchId) geoWatchId = navigator.geolocation.watchPosition(pos => {
    userLatLng = [pos.coords.latitude, pos.coords.longitude];
    if (userMarker) userMarker.setLatLng(userLatLng);
    scheduleRender();
  }, () => {}, { enableHighAccuracy: false, timeout: 12000, maximumAge: 30000 });
}

function switchMapLayer(mode) {
  if (currentLayerMode === mode) return;
  currentLayerMode = mode;
  if (mode === 'satellite') { map.removeLayer(normalLayer); satelliteLayer.addTo(map); document.body.classList.add('satellite-mode'); el('layerToggleBtn').classList.add('active'); }
  else { map.removeLayer(satelliteLayer); normalLayer.addTo(map); document.body.classList.remove('satellite-mode'); el('layerToggleBtn').classList.remove('active'); }
}
function clearMarkers() { markers.forEach(marker => marker.remove()); markers = []; if (markerCluster && map.hasLayer(markerCluster)) map.removeLayer(markerCluster); }
function getDistance(store) { return userLatLng ? haversine(userLatLng[0], userLatLng[1], store.lat, store.lng) : haversine(DEFAULT_CENTER[0], DEFAULT_CENTER[1], store.lat, store.lng); }
function haversine(lat1, lng1, lat2, lng2) { const R = 6371000, toRad = deg => deg * Math.PI / 180, dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1), a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function formatDistance(m) { return !Number.isFinite(m) ? '距離未知' : m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m)} 公尺`; }
function categorySvg(c) { return ({ '食': `<svg viewBox='0 0 24 24'><path d='M6 3v5'/><path d='M8 3v5'/><path d='M10 3v5'/><path d='M8 8v13'/><path d='M16 3v18'/><path d='M14 3h4'/></svg>`, '衣': `<svg viewBox='0 0 24 24'><path d='M7 6l5-3 5 3 2 4-3 2v8H8v-8L5 10l2-4z'/></svg>`, '住': `<svg viewBox='0 0 24 24'><path d='M3 11l9-7 9 7'/><path d='M7 10v10h10V10'/></svg>`, '行': `<svg viewBox='0 0 24 24'><path d='M5 15h14'/><path d='M7 15l2-5h6l2 5'/><path d='M9 10h6'/><circle cx='8.5' cy='18' r='1.7'/><circle cx='15.5' cy='18' r='1.7'/></svg>`, '育': `<svg viewBox='0 0 24 24'><path d='M4 7l8-3 8 3-8 3-8-3z'/><path d='M7 11v4c0 1.2 2.2 3 5 3s5-1.8 5-3v-4'/></svg>`, '樂': `<svg viewBox='0 0 24 24'><path d='M9 18V6l10-2v12'/><circle cx='7' cy='18' r='2'/><circle cx='17' cy='16' r='2'/></svg>` }[c] || `<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='7'/></svg>`); }
function iconFor(c) { return categorySvg(c); }
function mountCategoryIcons() { document.querySelectorAll('.pill-icon').forEach(item => { item.innerHTML = categorySvg(item.dataset.icon); }); }
function markerClass(c) { return ({ '食': 'marker-food', '衣': 'marker-cloth', '住': 'marker-home', '行': 'marker-move', '育': 'marker-edu', '樂': 'marker-fun' }[c] || 'marker-other'); }
function toStars(score) { const stars = Math.max(0, Math.min(5, Math.round(Number(score || 0) / 2))); return '★'.repeat(stars) + '☆'.repeat(5 - stars); }
function showToast(text) { toastBox.textContent = text; toastBox.style.display = 'block'; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => toastBox.style.display = 'none', 2200); }
function setSheetExpanded(expanded) { const wasExpanded = bottomSheet.classList.contains('expanded'); bottomSheet.classList.toggle('expanded', expanded); document.querySelector('.app').classList.toggle('sheet-expanded', expanded); bottomSheet.style.height = expanded ? '68vh' : '185px'; document.documentElement.style.setProperty('--sheet-h', expanded ? '68vh' : '185px'); if (map && expanded && !wasExpanded) setTimeout(() => { suppressNextMoveEnd = true; map.panBy([0, -80], { animate: true, duration: .22 }); }, 60); }
function toggleBottomSheet() { setSheetExpanded(!bottomSheet.classList.contains('expanded')); setTimeout(() => renderList(getFilteredStores()), 120); }
function setupBottomSheetDrag() { let startY = 0, startHeight = 185, lastY = 0, lastTime = 0, velocity = 0, isDragging = false; bottomSheet.addEventListener('touchstart', e => { if (e.target.closest('.store-card')) return; isDragging = true; startY = e.touches[0].clientY; lastY = startY; lastTime = Date.now(); startHeight = bottomSheet.offsetHeight; bottomSheet.style.transition = 'none'; }, { passive: true }); bottomSheet.addEventListener('touchmove', e => { if (!isDragging) return; const currentY = e.touches[0].clientY; const delta = startY - currentY; const now = Date.now(); velocity = (lastY - currentY) / (now - lastTime + 1); lastY = currentY; lastTime = now; let next = startHeight + delta; const max = window.innerHeight * .68; if (next < 185) next = 185 - (185 - next) * .18; if (next > max) next = max + (next - max) * .12; bottomSheet.style.height = next + 'px'; }, { passive: true }); bottomSheet.addEventListener('touchend', () => { if (!isDragging) return; isDragging = false; bottomSheet.style.transition = 'height .42s cubic-bezier(.22,1,.36,1)'; const expanded = velocity > .45 || bottomSheet.offsetHeight > window.innerHeight * .42; setSheetExpanded(expanded); renderList(getFilteredStores()); }); }
function escapeHtml(text) { return String(text || '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch])); }
function escapeAttr(text) { return escapeHtml(text).replaceAll('`', '&#096;'); }
function scrollToSection(id) { el(id).scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function saveSearch(text) { const arr = uniqueRecent([text, ...getStorageArr(STORAGE_SEARCH)]); localStorage.setItem(STORAGE_SEARCH, JSON.stringify(arr.slice(0, 8))); renderSearchDropdown(); }
function saveStoreHistory(name) { const arr = uniqueRecent([name, ...getStorageArr(STORAGE_STORE)]); localStorage.setItem(STORAGE_STORE, JSON.stringify(arr.slice(0, 8))); }
function removeHistoryItem(type, label) { const key = type === 'search' ? STORAGE_SEARCH : STORAGE_STORE; const arr = getStorageArr(key).filter(item => item !== label); localStorage.setItem(key, JSON.stringify(arr)); renderSearchDropdown(); showToast('已刪除紀錄'); }
function getStorageArr(key) { return safeJsonParse(localStorage.getItem(key), []); }
function uniqueRecent(arr) { return [...new Set(arr.filter(Boolean))]; }
function renderSearchDropdown() { const focused = document.activeElement === searchInput, keyword = searchInput.value.trim().toLowerCase(); let items = []; if (keyword) items = getFilteredStores().slice(0, 6).map(store => ({ type: 'store', label: store.name, note: `${store.category} · ${formatDistance(getDistance(store))}`, id: store.id })); else if (focused) items = [...getStorageArr(STORAGE_SEARCH).map(label => ({ type: 'search', label, note: '搜尋紀錄' })), ...getStorageArr(STORAGE_STORE).map(label => ({ type: 'historyStore', label, note: '看過的店家' }))].slice(0, 8); dropdown.style.maxHeight = bottomSheet.classList.contains('expanded') ? '140px' : '235px'; dropdown.classList.toggle('show', items.length > 0 && focused); document.querySelector('.app').classList.toggle('searching', items.length > 0 && focused); dropdown.innerHTML = items.map(item => { const deletable = item.type === 'search' || item.type === 'historyStore'; return `<button class="dropdown-item ${deletable ? 'has-delete' : ''}" data-type="${escapeAttr(item.type)}" data-id="${escapeAttr(item.id || '')}" data-label="${escapeAttr(item.label)}"><span class="dropdown-text">${escapeHtml(item.label)}<small>${escapeHtml(item.note)}</small></span>${deletable ? '<span class="history-delete" data-delete="1">×</span>' : ''}</button>`; }).join(''); dropdown.querySelectorAll('.dropdown-item').forEach(btn => btn.addEventListener('click', event => { if (event.target.closest('[data-delete]')) { event.stopPropagation(); removeHistoryItem(btn.dataset.type, btn.dataset.label); return; } if (btn.dataset.type === 'store') { const store = stores.find(s => s.id === btn.dataset.id); if (store) { searchInput.value = store.name; clearBtn.classList.add('show'); saveSearch(store.name); openStore(store); } } else { searchInput.value = btn.dataset.label; clearBtn.classList.add('show'); saveSearch(btn.dataset.label); render(); } dropdown.classList.remove('show'); })); }
function setupRatingControl() { updateRatingUI(10); ratingNumber.addEventListener('input', () => updateRatingUI(Number(ratingNumber.value))); const updateByPointer = event => { const rect = starDrag.getBoundingClientRect(), x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width), value = Math.round((x / rect.width) * 100) / 10; updateRatingUI(value); }; starDrag.addEventListener('pointerdown', event => { updateByPointer(event); starDrag.setPointerCapture(event.pointerId); starDrag.onpointermove = updateByPointer; }); starDrag.addEventListener('pointerup', () => starDrag.onpointermove = null); }
function updateRatingUI(value) { activeRating = Math.max(0, Math.min(10, Number.isFinite(value) ? value : 0)); activeRating = Math.round(activeRating * 10) / 10; ratingNumber.value = activeRating; starFill.style.width = `${activeRating * 10}%`; }
function previewUpload() { const file = reviewPhotoFile.files && reviewPhotoFile.files[0]; if (!file) { uploadPreview.classList.remove('show'); return; } const reader = new FileReader(); reader.onload = () => { uploadPreviewImg.src = reader.result; uploadPreviewImg.dataset.src = reader.result; uploadPreview.classList.add('show'); }; reader.readAsDataURL(file); }
function openImageViewer(src) { viewerImages = [...new Set([...(activeStore ? [activeStore.coverImage, ...activeStore.gallery, ...activeStore.extraImages] : []).filter(Boolean)])]; viewerIndex = Math.max(0, viewerImages.indexOf(src)); imgScale = 1; viewerImg.src = src; setViewerScale(1); imageViewer.classList.add('show'); }
function closeImageViewer() { imageViewer.classList.remove('show'); }
function changeViewerImage(direction) { if (!viewerImages.length) return; viewerIndex = (viewerIndex + direction + viewerImages.length) % viewerImages.length; viewerImg.src = viewerImages[viewerIndex]; setViewerScale(1); }
function setViewerScale(scale) { imgScale = scale; viewerImg.style.transform = `scale(${imgScale})`; }
function setupImageViewerGestures() { let startDistance = 0, startScale = 1, startX = 0; imageViewer.addEventListener('touchstart', event => { if (event.touches.length === 2) { startDistance = touchDistance(event.touches[0], event.touches[1]); startScale = imgScale; } if (event.touches.length === 1) startX = event.touches[0].clientX; }, { passive: false }); imageViewer.addEventListener('touchmove', event => { if (event.touches.length === 2) { event.preventDefault(); const current = touchDistance(event.touches[0], event.touches[1]); setViewerScale(Math.max(1, Math.min(4, startScale * (current / startDistance)))); } }, { passive: false }); imageViewer.addEventListener('touchend', event => { if (event.changedTouches.length === 1 && imgScale <= 1.05) { const diff = event.changedTouches[0].clientX - startX; if (Math.abs(diff) > 60) changeViewerImage(diff > 0 ? -1 : 1); } }); }
function touchDistance(a, b) { const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY; return Math.sqrt(dx * dx + dy * dy); }
function runLoadingIcons() { const wrap = body => `<svg viewBox="0 0 120 120"><g class="draw-line">${body}</g></svg>`; const icons = [wrap('<path d="M35 24v34"/><path d="M47 24v34"/><path d="M35 39h12"/><path d="M41 58v38"/><path d="M78 24v72"/><path d="M69 24h18"/>'), wrap('<path d="M38 34l22-12 22 12 13 20-18 10v34H43V64L25 54l13-20z"/>'), wrap('<path d="M24 58l36-30 36 30"/><path d="M35 54v44h50V54"/>'), wrap('<path d="M25 76h70"/><path d="M34 76l10-26h32l10 26"/><path d="M46 50h28"/><circle cx="42" cy="88" r="7"/><circle cx="78" cy="88" r="7"/>'), wrap('<path d="M24 42l36-14 36 14-36 14-36-14z"/><path d="M38 58v18c0 8 10 18 22 18s22-10 22-18V58"/>'), wrap('<path d="M44 88V32l42-9v52"/><circle cx="35" cy="88" r="9"/><circle cx="77" cy="75" r="9"/>')]; let i = 0, box = el('lineIcon'); box.innerHTML = icons[0]; setInterval(() => { i = (i + 1) % icons.length; box.innerHTML = icons[i]; }, 1450); }
function safeUUID() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
function getOpenStatus(store) { const now = new Date(); const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; return hm >= store.openTime && hm <= store.closeTime ? '營業中' : '已休息'; }
function isFavorite(id) { return getStorageArr('beeFav').includes(id); }
function toggleFavorite(id) { const already = isFavorite(id); const arr = getStorageArr('beeFav'); const next = already ? arr.filter(v => v !== id) : [id, ...arr]; localStorage.setItem('beeFav', JSON.stringify(next)); render(); if (activeStore && activeStore.id === id) { const btn = el('detailFavBtn'); btn.classList.toggle('active', !already); btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1.04)' }], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' }); } showToast(already ? '已取消收藏' : '已加入收藏'); }
function getFavoriteCount(id) { return getStorageArr('beeFav').includes(id) ? 1 : 0; }
function safeJsonParse(text, fallback) { try { return JSON.parse(text || ''); } catch (e) { return fallback; } }
function runTests() { console.assert(document.getElementById('searchInput'), 'search input exists'); console.assert(document.getElementById('clearBtn'), 'clear button exists'); console.assert(typeof scheduleRender === 'function', 'scheduleRender exists'); console.assert(typeof renderMarkers === 'function', 'renderMarkers exists'); }
function demoStores() { return [{ id: 'D001', name: '蜂享咖啡', category: '食', discount: '出示學生證享飲品 9 折優惠。', description: '鄰近校園，適合讀書、討論報告與短暫休息。', extra: '可依後台新增更多補充介紹與圖片。', address: '台南市永康區中正路529號附近', lat: 23.0387, lng: 120.2396, coverImage: FALLBACK_IMG, gallery: [FALLBACK_IMG, 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?q=80&w=1200&auto=format&fit=crop'], extraImages: [], reviews: [{ rating: 9, comment: '環境舒服，優惠實用。', photo: '' }], status: 'active' }, { id: 'D002', name: '晨光早午餐', category: '食', discount: '學生套餐折抵 10 元，內用飲品免費升級。', description: '早八救星，餐點選擇多。', extra: '尖峰時段建議提早前往。', address: '台南市永康區復國一路', lat: 23.0408, lng: 120.2439, coverImage: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?q=80&w=1200&auto=format&fit=crop', gallery: ['https://images.unsplash.com/photo-1525351484163-7529414344d8?q=80&w=1200&auto=format&fit=crop'], extraImages: [], reviews: [{ rating: 8, comment: '份量很夠，離學校不遠。', photo: '' }], status: 'active' }, { id: 'D003', name: '小蜜蜂文具館', category: '育', discount: '文具滿 100 元享 95 折，影印另有優惠。', description: '提供文具、影印與臨時報告需求。', extra: '適合學生臨時購買課程用品。', address: '台南市永康區中華路', lat: 23.0342, lng: 120.2328, coverImage: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?q=80&w=1200&auto=format&fit=crop', gallery: ['https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?q=80&w=1200&auto=format&fit=crop'], extraImages: [], reviews: [], status: 'active' }]; }
