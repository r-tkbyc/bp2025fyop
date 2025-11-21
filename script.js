// ★★★ GPSエリア限定機能の有効/無効を切り替える設定 ★★★
// true: エリア限定を有効にする / false: エリア限定を無効にする
const IS_GPS_LIMIT_ENABLED = false;

// 1. エリア設定（例として東京駅周辺 半径500m に設定）
// IS_GPS_LIMIT_ENABLED が true の場合のみ、以下の設定が使用されます。
const ALLOWED_LATITUDE = 35.572474208473515; // 許可エリア中心の緯度
const ALLOWED_LONGITUDE = 139.74800306377824; // 許可エリア中心の経度
const ALLOWED_RADIUS_METERS = 100; // 許可エリアの半径（メートル）

/**
 * 2. 2点間の緯度経度から距離を計算する（ヒュベニの公式）
 * @param {number} lat1 地点1の緯度
 * @param {number} lng1 地点1の経度
 * @param {number} lat2 地点2の緯度
 * @param {number} lng2 地点2の経度
 * @returns {number} 2点間の距離（メートル）
 */
function getDistanceInMeters(lat1, lng1, lat2, lng2) {
  const R = 6378137; // 地球の半径（メートル）
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


document.addEventListener('DOMContentLoaded', async () => {
  const cameraFeed = document.getElementById('cameraFeed');
  const photoCanvas = document.getElementById('photoCanvas');
  const shutterButton = document.getElementById('shutterButton');

  const permissionModal = document.getElementById('permissionModal');
  const permissionMessage = document.getElementById('permissionMessage');
  const closeModalButton = document.getElementById('closeModalButton');
  const permissionImage = document.getElementById('permissionImage');

  // プレビュー用モーダル
  const previewModal    = document.getElementById('previewModal');
  const previewImage    = document.getElementById('previewImage');
  const previewSaveBtn  = document.getElementById('previewSaveBtn');
  const previewShareBtn = document.getElementById('previewShareBtn');
  const previewCloseBtn = document.getElementById('previewCloseBtn');
  const previewCloseX   = document.getElementById('previewCloseX');

  // フレーム
  const frameTopEl    = document.getElementById('frameTop');
  const frameBottomEl = document.getElementById('frameBottom');

  // スタンプ（Fabric）
  const stampCanvasEl = document.getElementById('stampCanvas');
  const stampButton   = document.getElementById('stampButton');
  const stampSheet    = document.getElementById('stampSheet');
  const sheetCloseX  = document.getElementById('sheetCloseX');

  // カメラ切り替えボタン
  const cameraToggleButton = document.getElementById('cameraToggleButton');
  let currentFacingMode = 'environment';

  // 長押しフリック用ダイヤル
  const actionDial = document.getElementById('stampActionDial');
  const LONGPRESS_MS = 450;
  const FLICK_THRESHOLD = 50;

  let fcanvas = null;
  let isSheetOpen = false;
  let stream = null;
  const canvasContext = photoCanvas.getContext('2d');
  let lastCaptureBlob = null;
  let lastCaptureObjectURL = null;
  let lpTimer = null;
  let lpStartPoint = null;
  let lpTarget = null;
  let dialOpen = false;

  const disableCameraFeatures = () => {
    shutterButton.disabled = true;
    stampButton.disabled = true;
    cameraToggleButton.disabled = true;
    shutterButton.style.opacity = '0.5';
    stampButton.style.opacity = '0.5';
    cameraToggleButton.style.opacity = '0.5';
  };

  const enableCameraFeatures = () => {
    shutterButton.disabled = false;
    stampButton.disabled = false;
    cameraToggleButton.disabled = false;
    shutterButton.style.opacity = '1';
    stampButton.style.opacity = '1';
    cameraToggleButton.style.opacity = '1';
  };

  const setCameraView = (isCameraActive) => {
    if (isCameraActive) {
      cameraFeed.classList.remove('hidden');
      photoCanvas.classList.add('hidden');
      shutterButton.classList.remove('hidden');
      cameraToggleButton.classList.remove('hidden');
    } else {
      cameraFeed.classList.add('hidden');
      photoCanvas.classList.remove('hidden');
      shutterButton.classList.add('hidden');
      cameraToggleButton.classList.add('hidden');
    }
  };

  const startCamera = async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: currentFacingMode },
          width:  { ideal: 4096 },
          height: { ideal: 4096 }
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      const caps  = track.getCapabilities ? track.getCapabilities() : null;
      if (caps && caps.width && caps.height) {
        try {
          await track.applyConstraints({
            width:  { ideal: caps.width.max },
            height: { ideal: caps.height.max }
          });
        } catch (e) { console.warn('applyConstraints skipped:', e); }
      }
      cameraFeed.srcObject = stream;
      await cameraFeed.play();
      if (currentFacingMode === 'user') {
        cameraFeed.style.transform = 'scaleX(-1)';
      } else {
        cameraFeed.style.transform = 'none';
      }
      const settings = track.getSettings ? track.getSettings() : {};
      console.log('Active camera resolution =', settings.width, 'x', settings.height, ', Facing Mode =', currentFacingMode);
      setCameraView(true);
      enableCameraFeatures();
      if (!fcanvas) {
        initFabricCanvas();
      } else {
        resizeStampCanvas();
      }
      return true;
    } catch (err) {
      console.error('カメラへのアクセスに失敗:', err);
      if (permissionImage) permissionImage.classList.add('hidden');
      if (permissionMessage) {
        permissionMessage.classList.remove('hidden');
        permissionMessage.style.textAlign = 'center';
        if (err.name === 'NotAllowedError') {
          permissionMessage.textContent = 'カメラの使用が拒否されました。ブラウザの設定で許可してください。';
        } else if (err.name === 'NotFoundError') {
          permissionMessage.textContent = 'カメラが見つかりませんでした。';
        } else {
          permissionMessage.textContent = 'カメラへのアクセス中にエラーが発生しました。';
        }
      }
      permissionModal.style.display = 'flex';
      document.body.classList.add('modal-open');
      disableCameraFeatures();
      return false;
    }
  };

  cameraToggleButton.addEventListener('click', async () => {
    currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
    await startCamera();
  });

  function checkLocationAndPermission() {
    return new Promise((resolve) => {
      if (permissionImage) permissionImage.classList.add('hidden');
      if (permissionMessage) permissionMessage.classList.remove('hidden');
      permissionMessage.style.textAlign = 'center';

      if (!navigator.geolocation) {
        permissionMessage.textContent = 'お使いのブラウザは位置情報サービスに対応していません。';
        permissionModal.style.display = 'flex';
        document.body.classList.add('modal-open');
        resolve(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLat = position.coords.latitude;
          const userLng = position.coords.longitude;
          console.log(`位置情報取得成功: Lat=${userLat}, Lng=${userLng}`);
          const distance = getDistanceInMeters(userLat, userLng, ALLOWED_LATITUDE, ALLOWED_LONGITUDE);
          console.log(`指定エリアまでの距離: ${distance.toFixed(2)} メートル`);
          if (distance <= ALLOWED_RADIUS_METERS) {
            console.log("エリア内です。");
            resolve(true);
          } else {
            console.log("エリア外です。");
            permissionMessage.textContent = '指定されたエリア外のため、ご利用いただけません。';
            permissionModal.style.display = 'flex';
            document.body.classList.add('modal-open');
            resolve(false);
          }
        },
        (err) => {
          console.error('位置情報アクセス失敗:', err);
          switch (err.code) {
            case err.PERMISSION_DENIED:
              permissionMessage.textContent = '位置情報の使用が拒否されました。ブラウザの設定で許可してください。';
              break;
            case err.POSITION_UNAVAILABLE:
              permissionMessage.textContent = '位置情報を取得できませんでした。';
              break;
            case err.TIMEOUT:
              permissionMessage.textContent = '位置情報の取得がタイムアウトしました。';
              break;
            default:
              permissionMessage.textContent = '位置情報アクセス中に不明なエラーが発生しました。';
              break;
          }
          permissionModal.style.display = 'flex';
          document.body.classList.add('modal-open');
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  async function initializeApp() {
    disableCameraFeatures();

    let isUserInArea = false; // ★ 変更：判定結果を格納する変数

    // ★ 変更：ここから =======================================================
    // 設定スイッチが true の場合のみ、GPSチェックを行う
    if (IS_GPS_LIMIT_ENABLED) {
      isUserInArea = await checkLocationAndPermission();
    } else {
      // false の場合は、GPSチェックをスキップして常に許可する
      console.log("GPSエリア限定は無効です。");
      isUserInArea = true;
    }
    // ★ 変更：ここまで =======================================================


    if (isUserInArea) {
      const isCameraReady = await startCamera();
      if (isCameraReady) {
        if (permissionImage) permissionImage.classList.remove('hidden');
        if (permissionMessage) permissionMessage.classList.add('hidden');
        permissionModal.style.display = 'flex';
        document.body.classList.add('modal-open');
        closeModalButton.onclick = () => {
          permissionModal.style.display = 'none';
          document.body.classList.remove('modal-open');
        };
      } else {
        closeModalButton.onclick = null;
      }
    } else {
      closeModalButton.onclick = null;
    }
  }

  await initializeApp();

  function waitImage(el) {
    return new Promise((resolve) => {
      if (!el) return resolve(null);
      if (el.complete && el.naturalWidth && el.naturalHeight) return resolve(el);
      el.addEventListener('load', () => resolve(el), { once: true });
      el.addEventListener('error', () => resolve(null), { once: true });
    });
  }
  async function ensureFramesReady() {
    await Promise.all([waitImage(frameTopEl), waitImage(frameBottomEl)]);
  }

  function drawFramesToCanvas() {
    const cw = photoCanvas.width;
    const ch = photoCanvas.height;
    const ctx = canvasContext;
    const drawOne = (imgEl, place) => {
      if (!imgEl) return;
      const iw = imgEl.naturalWidth;
      const ih = imgEl.naturalHeight;
      if (!iw || !ih) return;
      const scale = cw / iw;
      const drawW = cw;
      const drawH = Math.round(ih * scale);
      const dx = 0;
      const dy = (place === 'top') ? 0 : (ch - drawH);
      ctx.drawImage(imgEl, 0, 0, iw, ih, dx, dy, drawW, drawH);
    };
    drawOne(frameTopEl, 'top');
    drawOne(frameBottomEl, 'bottom');
  }

  function openPreviewModalWithCanvas(canvas) {
    if (lastCaptureObjectURL) {
      URL.revokeObjectURL(lastCaptureObjectURL);
      lastCaptureObjectURL = null;
    }
    lastCaptureBlob = null;
    canvas.toBlob((blob) => {
      if (!blob) {
        previewImage.src = canvas.toDataURL('image/png');
      } else {
        lastCaptureBlob = blob;
        lastCaptureObjectURL = URL.createObjectURL(blob);
        previewImage.src = lastCaptureObjectURL;
      }
      previewModal.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }, 'image/png');
  }

  async function closePreviewModalAndRetake() {
    previewModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (lastCaptureObjectURL) {
      URL.revokeObjectURL(lastCaptureObjectURL);
      lastCaptureObjectURL = null;
    }
    lastCaptureBlob = null;
    await startCamera();
  }

  function freezeTargetForDial(target){
    if (!target) return;
    target.__preLock = {
      mvx: target.lockMovementX, mvy: target.lockMovementY,
      sx: target.lockScalingX, sy: target.lockScalingY,
      rot: target.lockRotation, hc: target.hasControls
    };
    target.lockMovementX = target.lockMovementY = true;
    target.lockScalingX  = target.lockScalingY  = true;
    target.lockRotation  = true;
    target.hasControls   = false;
    target.setCoords && target.setCoords();
  }
  function unfreezeTargetAfterDial(target){
    if (!target || target._locked) return;
    const p = target.__preLock;
    if (!p) return;
    target.lockMovementX = p.mvx; target.lockMovementY = p.mvy;
    target.lockScalingX  = p.sx;  target.lockScalingY  = p.sy;
    target.lockRotation  = p.rot; target.hasControls   = p.hc;
    target.__preLock = null;
    target.setCoords && target.setCoords();
  }

  function initFabricCanvas() {
    if (fcanvas) { resizeStampCanvas(); return; }
    fcanvas = new fabric.Canvas(stampCanvasEl, {
      selection: true,
      preserveObjectStacking: true
    });
    resizeStampCanvas();
    const container = fcanvas.getElement().parentNode;
    if (container) {
      container.style.position  = 'absolute';
      container.style.inset     = '0';
      container.style.width     = '100%';
      container.style.height    = '100%';
      container.style.zIndex    = '7';
    }
    fcanvas.upperCanvasEl.style.touchAction   = 'none';
    fcanvas.upperCanvasEl.style.pointerEvents = 'auto';
    fcanvas.upperCanvasEl.style.zIndex        = '7';
    stampCanvasEl.style.pointerEvents = 'auto';
    stampCanvasEl.style.touchAction   = 'none';
    fcanvas.defaultCursor             = 'grab';
    fcanvas.allowTouchScrolling       = false;
    fcanvas.targetFindTolerance       = 12;
    fabric.Object.prototype.cornerSize = 26;
    fabric.Object.prototype.cornerStyle = 'circle';
    fabric.Object.prototype.cornerColor = '#ff5b82';
    fabric.Object.prototype.borderColor = '#ff5b82';
    fabric.Object.prototype.transparentCorners = false;

    let gObj = null, gStart = null;
    const getDist = (a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    const getAngle=(a,b)=>Math.atan2(b.clientY-a.clientY,b.clientX-a.clientX);

    fcanvas.upperCanvasEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const obj = fcanvas.getActiveObject();
        if (!obj) return;
        gObj = obj;
        gStart = {
          dist: getDist(e.touches[0], e.touches[1]),
          angle: getAngle(e.touches[0], e.touches[1]),
          scaleX: obj.scaleX || obj.scale || 1,
          angleDeg: obj.angle || 0
        };
        e.preventDefault();
      }
    }, { passive:false });

    fcanvas.upperCanvasEl.addEventListener('touchmove', (e) => {
      if (gObj && e.touches.length === 2) {
        const dist = getDist(e.touches[0], e.touches[1]);
        const ang  = getAngle(e.touches[0], e.touches[1]);
        const s = dist / gStart.dist;
        const newScale = Math.max(0.1, Math.min(5, gStart.scaleX * s));
        gObj.scale(newScale);
        const deltaDeg = (ang - gStart.angle) * (180/Math.PI);
        gObj.rotate(gStart.angleDeg + deltaDeg);
        gObj.setCoords();
        fcanvas.requestRenderAll();
        e.preventDefault();
      }
    }, { passive:false });

    fcanvas.upperCanvasEl.addEventListener('touchend', (e) => {
      if (e.touches.length < 2 && gObj) {
        gObj = null;
        gStart = null;
        e.preventDefault();
      }
    }, { passive:false });

    if (actionDial) {
      const upper = fcanvas.upperCanvasEl;
      const showActionDial = (x, y, target) => {
        const containerRect = document.querySelector('.container').getBoundingClientRect();
        const localX = x - containerRect.left;
        const localY = y - containerRect.top;
        freezeTargetForDial(target);
        fcanvas.skipTargetFind = true;
        fcanvas.selection = false;
        actionDial.style.left = `${localX}px`;
        actionDial.style.top  = `${localY}px`;
        actionDial.classList.remove('hidden');
        actionDial.setAttribute('aria-hidden', 'false');
        dialOpen = true;
        const lockBtn = actionDial.querySelector('[data-action="lock-toggle"]');
        if (lockBtn) {
          const locked = !!target._locked;
          lockBtn.textContent = locked ? 'ロック解除' : 'ロック';
        }
      };
      const hideActionDial = () => {
        if (!dialOpen) return;
        actionDial.classList.add('hidden');
        actionDial.setAttribute('aria-hidden', 'true');
        dialOpen = false;
        fcanvas.skipTargetFind = false;
        fcanvas.selection = true;
        if (lpTarget) unfreezeTargetAfterDial(lpTarget);
      };
      const doStampAction = (action, target) => {
        if (!target || !fcanvas) return;
        switch (action) {
          case 'delete': fcanvas.remove(target); break;
          case 'front': fcanvas.bringToFront(target); break;
          case 'back': fcanvas.sendToBack(target); break;
          case 'lock-toggle':
            if (target._locked) {
              target.lockMovementX = target.lockMovementY = false;
              target.lockScalingX  = target.lockScalingY  = false;
              target.lockRotation  = false;
              target.hasControls   = true;
              target.selectable    = true;
              target.evented       = true;
              target._locked       = false;
              target.opacity       = 1;
              target.__preLock = null;
            } else {
              target.lockMovementX = target.lockMovementY = true;
              target.lockScalingX  = target.lockScalingY  = true;
              target.lockRotation  = true;
              target.hasControls   = false;
              target.selectable    = true;
              target.evented       = true;
              target._locked       = true;
              target.opacity       = 0.95;
            }
            break;
        }
        target.setCoords?.();
        fcanvas.requestRenderAll();
      };
      upper.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1 || isSheetOpen) { clearTimeout(lpTimer); return; }
        const target = fcanvas.findTarget(e, true) || fcanvas.getActiveObject();
        if (!target) { clearTimeout(lpTimer); return; }
        lpTarget = target;
        lpStartPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        clearTimeout(lpTimer);
        lpTimer = setTimeout(() => {
          fcanvas.setActiveObject(lpTarget);
          fcanvas.requestRenderAll();
          showActionDial(lpStartPoint.x, lpStartPoint.y, lpTarget);
          lpTimer = null;
        }, LONGPRESS_MS);
      }, { passive: true });
      upper.addEventListener('touchmove', (e) => {
        if (lpTimer && e.touches.length === 1 && lpStartPoint) {
          const dx = e.touches[0].clientX - lpStartPoint.x;
          const dy = e.touches[0].clientY - lpStartPoint.y;
          if (Math.hypot(dx, dy) > 10) {
            clearTimeout(lpTimer);
            lpTimer = null;
          }
        }
      }, { passive: true });
      upper.addEventListener('touchend', (e) => {
        if (lpTimer) {
          clearTimeout(lpTimer);
          lpTimer = null;
          lpStartPoint = null;
          lpTarget = null;
          return;
        }
        if (dialOpen && lpStartPoint && lpTarget) {
          const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
          if (t) {
            const dx = t.clientX - lpStartPoint.x;
            const dy = t.clientY - lpStartPoint.y;
            const dist = Math.hypot(dx, dy);
            if (dist >= FLICK_THRESHOLD) {
              let action = null;
              if (Math.abs(dx) > Math.abs(dy)) {
                action = dx > 0 ? 'delete' : 'lock-toggle';
              } else {
                action = dy < 0 ? 'front' : 'back';
              }
              doStampAction(action, lpTarget);
            }
          }
          hideActionDial();
          lpStartPoint = null;
          lpTarget = null;
        }
      }, { passive: true });
      actionDial.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.dial-btn');
        if (!btn || !lpTarget) return;
        const action = btn.getAttribute('data-action');
        doStampAction(action, lpTarget);
        hideActionDial();
        lpStartPoint = null;
        lpTarget = null;
      });
    }
  }

  function resizeStampCanvas() {
    if (!stampCanvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = document.querySelector('.container').getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    stampCanvasEl.width  = Math.round(cssW * dpr);
    stampCanvasEl.height = Math.round(cssH * dpr);
    stampCanvasEl.style.width  = cssW + 'px';
    stampCanvasEl.style.height = cssH + 'px';
    if (fcanvas) {
      fcanvas.setWidth(cssW);
      fcanvas.setHeight(cssH);
      fcanvas.setZoom(dpr);
      fcanvas.renderAll();
    }
  }

  function addStampFromURL(url) {
    if (!fcanvas) return;
    fabric.Image.fromURL(url, (img) => {
      img.set({
        originX: 'center', originY: 'center',
        selectable: true, hasControls: true, hasBorders: true,
        uniformScaling: true, lockScalingFlip: true,
        transparentCorners: false, cornerColor: '#ff5b82',
        cornerStyle: 'circle', borderColor: '#ff5b82', cornerSize: 26
      });
      img.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
      const cssW = fcanvas.getWidth();
      const cssH = fcanvas.getHeight();
      const base = Math.min(cssW, cssH) * 0.3;
      const scale = base / img.width;
      img.scale(scale);
      fcanvas.add(img);
      fcanvas.viewportCenterObject(img);
      img.setCoords();
      fcanvas.bringToFront(img);
      fcanvas.setActiveObject(img);
      fcanvas.requestRenderAll();
      closeStampSheet();
    }, { crossOrigin: 'anonymous' });
  }

  function openStampSheet() {
    if (actionDial && dialOpen) {
      actionDial.classList.add('hidden');
      actionDial.setAttribute('aria-hidden', 'true');
      dialOpen = false;
    }
    stampSheet.classList.add('open');
    isSheetOpen = true;
    document.querySelector('.container')?.classList.add('sheet-open');
  }
  function closeStampSheet() {
    stampSheet.classList.remove('open');
    isSheetOpen = false;
    document.querySelector('.container')?.classList.remove('sheet-open');
  }

  let currentStampTab = 'stamp1';
  function activateStampTab(tabName) {
    currentStampTab = tabName;
    document.querySelectorAll('#stampTabs .tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      const panelId = 'panel-' + btn.dataset.tab;
      btn.setAttribute('aria-controls', panelId);
      btn.id = 'tab-' + btn.dataset.tab;
    });
    document.querySelectorAll('.stamp-panel').forEach(panel => {
      const isActive = panel.dataset.tab === tabName;
      panel.classList.toggle('active', isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if (isActive) {
        panel.id = 'panel-' + tabName;
        panel.setAttribute('aria-labelledby', 'tab-' + tabName);
      }
    });
  }

  document.getElementById('stampTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const tabName = btn.dataset.tab;
    if (tabName) activateStampTab(tabName);
  });

  const _openStampSheetOrig = openStampSheet;
  openStampSheet = function() {
    _openStampSheetOrig();
    activateStampTab(currentStampTab || 'stamp1');
  };

  stampButton?.addEventListener('click', () => {
    if (!fcanvas) initFabricCanvas();
    if (isSheetOpen) closeStampSheet(); else openStampSheet();
  });
  sheetCloseX?.addEventListener('click', closeStampSheet);

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.stamp-thumb');
    if (!btn) return;
    const src = btn.getAttribute('data-src');
    if (src) addStampFromURL(src);
  });

  window.addEventListener('resize', () => {
    resizeStampCanvas();
    if (fcanvas) fcanvas.calcOffset();
  });

  shutterButton.addEventListener('click', async () => {
    if (!stream || !cameraFeed.srcObject) return;
    const cw = cameraFeed.clientWidth;
    const ch = cameraFeed.clientHeight;
    if (!cw || !ch) {
      const rect = document.querySelector('.container').getBoundingClientRect();
      photoCanvas.width  = Math.max(1, Math.round(rect.width));
      photoCanvas.height = Math.max(1, Math.round(rect.height));
    } else {
      photoCanvas.width  = cw;
      photoCanvas.height = ch;
    }
    const vw = cameraFeed.videoWidth;
    const vh = cameraFeed.videoHeight;
    if (!vw || !vh || cameraFeed.readyState < 2) {
      setTimeout(() => shutterButton.click(), 50);
      return;
    }
    const videoRatio  = vw / vh;
    const canvasRatio = photoCanvas.width / photoCanvas.height;
    let sx, sy, sWidth, sHeight;
    if (videoRatio > canvasRatio) {
      sHeight = vh; sWidth = Math.round(vh * canvasRatio);
      sx = Math.round((vw - sWidth) / 2); sy = 0;
    } else {
      sWidth = vw; sHeight = Math.round(vw / canvasRatio);
      sx = 0; sy = Math.round((vh - sHeight) / 2);
    }
    canvasContext.setTransform(1, 0, 0, 1, 0, 0);
    canvasContext.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    if (currentFacingMode === 'user') {
      canvasContext.translate(photoCanvas.width, 0);
      canvasContext.scale(-1, 1);
    }
    canvasContext.drawImage(cameraFeed, sx, sy, sWidth, sHeight, 0, 0, photoCanvas.width, photoCanvas.height);
    canvasContext.setTransform(1, 0, 0, 1, 0, 0);
    await ensureFramesReady();
    drawFramesToCanvas();
    if (fcanvas) {
      fcanvas.discardActiveObject();
      fcanvas.renderAll();
      canvasContext.drawImage(stampCanvasEl, 0, 0, stampCanvasEl.width, stampCanvasEl.height, 0, 0, photoCanvas.width, photoCanvas.height);
    }
    stream.getTracks().forEach(t => t.stop());
    cameraFeed.srcObject = null;
    setCameraView(false);
    openPreviewModalWithCanvas(photoCanvas);
  });

  previewSaveBtn.addEventListener('click', () => {
    const url = photoCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'photo_' + new Date().getTime() + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  previewShareBtn.addEventListener('click', async () => {
    try {
      if (navigator.canShare && lastCaptureBlob) {
        const file = new File([lastCaptureBlob], 'photo.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      }
      const url = photoCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'photo_' + new Date().getTime() + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      alert('共有がサポートされていないため、画像を保存しました。端末の共有機能からX/Instagramへ送ってください。');
    } catch (e) {
      console.warn('共有に失敗:', e);
      alert('共有に失敗しました。保存してから端末の共有機能をご利用ください。');
    }
  });

  function handlePreviewClose() { closePreviewModalAndRetake(); }
  previewCloseBtn.addEventListener('click', handlePreviewClose);
  previewCloseX .addEventListener('click', handlePreviewClose);

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });
});