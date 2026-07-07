const { tracePath, splitPath, getPathBounds } = require('../../utils/svg-path.js')
const { regions, boundaryPath } = require('../../utils/map-data.js')
const geo = require('../../utils/geo.js')

/* ===== 常量 ===== */
const MAP_VIEWBOX = 1200
const NORM_VIEWBOX = 1000
const POSTER_W = 1440
const POSTER_H = 1920
const DISPLAY_FONT = '"STKaiti", "KaiTi", serif'
const TEXT_FONT = '"STSong", "SimSun", serif'
const STORE_KEY = 'travel-map-data-v1'

/* ===== 模板 ===== */
const templates = {
  minimal: {
    name: '极简白底', empty: '#e9e3d8', border: '#fffaf1',
    active: '#1f7a67', label: '#31433a', paper: '#fffaf1',
    title: '#1e2b25', accent: '#1f7a67'
  },
  journal: {
    name: '褚橙', empty: '#eadcc9', border: '#fff6e7',
    active: '#c46d3d', label: '#3c3329', paper: '#f8ead4',
    title: '#2f251d', accent: '#c46d3d'
  },
  ink: {
    name: '青绿', empty: '#dfe8dd', border: '#f6fbf4',
    active: '#376f6b', label: '#243935', paper: '#f6fbf4',
    title: '#18332f', accent: '#376f6b'
  }
}

/* ===== 状态 ===== */
const state = {
  activeId: '',
  template: 'minimal',
  photos: new Map(),
  profile: { avatar: '', nickname: '', avatarImg: null },
  provinces: (regions && regions.length > 0) ? regions : [],
  scope: { level: 'country', provinceId: '' },
  provinceRegionsCache: {},
}

// 画布引用
let mapCanvas = null
let mapCtx = null
let mapDpr = 1
let mapDispW = 0
let mapDispH = 0
let posterCanvas = null
let posterCtx = null

/* ===== 辅助函数 ===== */

function roundRect(ctx, x, y, w, h, r) {
  // 用手绘 arcTo 路径，避免依赖原生 ctx.roundRect（其 radii 参数在部分基础库仅接受数组，传数字会抛错）
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawCoverImage(ctx, img, x, y, w, h) {
  if (!img || !img.width) return
  const scale = Math.max(w / img.width, h / img.height)
  const sw = w / scale
  const sh = h / scale
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = Array.from(text || '')
  const lines = []
  let line = ''
  chars.forEach(ch => {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = ch
    } else {
      line = test
    }
  })
  if (line) lines.push(line)
  const visible = lines.slice(0, maxLines)
  if (lines.length > maxLines) {
    let last = visible[visible.length - 1]
    while (last.length > 0 && ctx.measureText(last + '...').width > maxWidth) {
      last = last.slice(0, -1)
    }
    visible[visible.length - 1] = last + '...'
  }
  visible.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight))
}

function trimTextToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 0 && ctx.measureText(t + '...').width > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + '...'
}

function getPhotoImage(provinceId, posterImages) {
  if (posterImages) return posterImages.get(provinceId)
  const photo = state.photos.get(provinceId)
  return photo ? photo.image : null
}

/* ===== 本地文件持久化辅助 ===== */
// 把临时文件复制到小程序本地持久目录（进程销毁/重开仍在），返回持久路径
function ensurePhotoDir() {
  const fs = wx.getFileSystemManager()
  const dir = `${wx.env.USER_DATA_PATH}/travel-photos`
  try { fs.accessSync(dir) } catch (e) {
    try { fs.mkdirSync(dir, true) } catch (e2) {}
  }
  return dir
}

function persistTempFile(tempPath, prefix) {
  return new Promise((resolve) => {
    let dest = tempPath
    try {
      const dir = ensurePhotoDir()
      const rawExt = (tempPath.split('?')[0].split('.').pop() || 'jpg').toLowerCase()
      const ext = ['jpg', 'jpeg', 'png', 'gif', 'webp'].indexOf(rawExt) >= 0 ? rawExt : 'jpg'
      dest = `${dir}/${prefix}_${Date.now()}.${ext}`
      wx.getFileSystemManager().copyFile({
        srcPath: tempPath,
        destPath: dest,
        success: () => resolve(dest),
        fail: () => resolve(tempPath)
      })
    } catch (e) {
      resolve(tempPath)
    }
  })
}

function removeFileSafe(path) {
  if (!path) return
  try { wx.getFileSystemManager().unlinkSync(path) } catch (e) {}
}

function isPersistPath(path) {
  return typeof path === 'string' && path.indexOf(wx.env.USER_DATA_PATH) === 0
}

/* ===== 南海诸岛放大图 ===== */
function getSouthSeaInsetData() {
  const province = state.provinces.find(p => p.name === '海南')
  if (!province) return null
  const parts = splitPath(province.d)
  const islands = parts
    .map(d => ({ d, bounds: getPathBounds(d) }))
    .filter(p => p.bounds.y > 845 && p.bounds.width > 0 && p.bounds.height > 0)
  if (islands.length === 0) return null
  const xs = islands.map(p => p.bounds.x)
  const ys = islands.map(p => p.bounds.y)
  const x2s = islands.map(p => p.bounds.x + p.bounds.width)
  const y2s = islands.map(p => p.bounds.y + p.bounds.height)
  return {
    province, islands,
    bounds: {
      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      width: Math.max.apply(null, x2s) - Math.min.apply(null, xs),
      height: Math.max.apply(null, y2s) - Math.min.apply(null, ys)
    }
  }
}

/* ===== 港澳放大图 ===== */
function getHKMacauInsetData() {
  const regions = state.provinces.filter(p => p.name === '香港' || p.name === '澳门')
  if (regions.length === 0) return null
  const xs = regions.map(r => r.bbox[0])
  const ys = regions.map(r => r.bbox[1])
  const x2s = regions.map(r => r.bbox[0] + r.bbox[2])
  const y2s = regions.map(r => r.bbox[1] + r.bbox[3])
  return {
    regions,
    bounds: {
      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      width: Math.max.apply(null, x2s) - Math.min.apply(null, xs),
      height: Math.max.apply(null, y2s) - Math.min.apply(null, ys)
    }
  }
}

/* ===== Page ===== */
Page({
  data: {
    activeName: '',
    uploadLabel: '上传照片',
    templateName: '极简白底',
    currentTemplate: 'minimal',
    posterText: '',
    nickname: '',
    avatarUrl: '',
    hasAvatar: false,
    posterUrl: '',
    hasPoster: false,
    scaleValue: 112,
    xValue: 0,
    yValue: 0,
    canUpload: true,
    canGenerate: false,
    useOriginal: false,
    hasActivePhoto: false,
    posterModalOpen: false,
    privacyVisible: false,
    privacyContractName: '《隐私保护指引》',
    regionNames: [],
    regionIndex: 0,
    scopeLevel: 'country',
    scopeProvinceName: '',
    navItems: [],
    activeNavId: 'country',
  },

  onLoad() {
    state.provinces = (regions && regions.length > 0) ? regions : []
    const provinces = state.provinces
    state._imagesLoaded = false
    this.loadState()  // 先恢复上次保存的照片/资料
    const guangdong = provinces.find(p => p.name === '广东')
    state.activeId = guangdong ? guangdong.id : (provinces[0] ? provinces[0].id : '')
    const defaultIndex = guangdong ? provinces.indexOf(guangdong) : 0
    this.setData({
      canGenerate: provinces.length > 0,
      // 下拉选择器：省份名数组 + 当前选中下标，下标与 state.provinces 一一对应，保证地名↔位置映射准确
      regionNames: provinces.map(p => p.name),
      regionIndex: defaultIndex,
      scopeLevel: 'country',
      scopeProvinceName: '',
      nickname: state.profile.nickname || '',
      avatarUrl: state.profile.avatar || '',
      hasAvatar: !!state.profile.avatar,
      currentTemplate: state.template,
      templateName: templates[state.template].name,
    })
    this.syncPanel()
    this.buildNavItems()
    this.initPrivacy()
  },

  onReady() {
    this.initMapCanvas()
    this.initPosterCanvas()
    // 热重载保险：延迟补一次重绘，避免首帧画布未就绪导致空白
    setTimeout(() => this.renderMap(), 400)
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
  },

  /* ===== 本地持久化（照片/资料跨会话保留） ===== */
  saveState() {
    const photosObj = {}
    state.photos.forEach((photo, id) => {
      photosObj[id] = { src: photo.src, scale: photo.scale, x: photo.x, y: photo.y }
    })
    try {
      wx.setStorageSync(STORE_KEY, {
        version: 1,
        photos: photosObj,
        profile: { avatar: state.profile.avatar, nickname: state.profile.nickname },
        template: state.template,
        useOriginal: this.data.useOriginal
      })
    } catch (e) {}
  },

  loadState() {
    let data = null
    try { data = wx.getStorageSync(STORE_KEY) } catch (e) {}
    if (!data || !data.photos) return
    Object.keys(data.photos).forEach((id) => {
      const p = data.photos[id]
      if (!p || !p.src) return
      state.photos.set(id, {
        src: p.src,
        image: null,
        scale: p.scale || 1.16,
        x: p.x || 0,
        y: p.y || 0
      })
    })
    if (data.profile) {
      state.profile.avatar = data.profile.avatar || ''
      state.profile.nickname = data.profile.nickname || ''
    }
    if (data.template && templates[data.template]) state.template = data.template
    this.setData({ useOriginal: !!data.useOriginal })
  },

  // 画布就绪后，把已恢复的照片路径加载成 Canvas 图片
  loadAllImages(callback) {
    if (!mapCanvas) { if (callback) callback(); return }
    const ids = []
    state.photos.forEach((photo, id) => { if (!photo.image && photo.src) ids.push(id) })
    if (ids.length === 0) { if (callback) callback(); return }
    let pending = ids.length
    const finish = () => { pending -= 1; if (pending === 0 && callback) callback() }
    ids.forEach((id) => {
      const photo = state.photos.get(id)
      const img = mapCanvas.createImage()
      img.onload = () => { photo.image = img; finish() }
      img.onerror = () => { state.photos.delete(id); finish() }
      img.src = photo.src
    })
  },

  /* ===== 隐私授权（合规，采用微信官方自定义弹窗标准写法） ===== */
  initPrivacy() {
    // 始终注册隐私拦截：未授权时微信会在调用相册/相机等接口时回调这里，
    // 我们弹出自己的弹窗，并在用户点击「同意」时调用 resolve() 让被挂起的接口自动恢复。
    if (wx.onNeedPrivacyAuthorize) {
      wx.onNeedPrivacyAuthorize((resolve, reject) => {
        this._prResolve = resolve
        this._prReject = reject
        this.setData({ privacyVisible: true })
      })
    }
  },

  onAgreePrivacy() {
    wx.setStorageSync('travel-map-privacy-agreed', true)
    this.setData({ privacyVisible: false })
    // 关键：调用 resolve() 通知微信已授权，被挂起的 chooseMedia / saveImageToPhotosAlbum 会自动恢复
    if (this._prResolve) {
      this._prResolve()
      this._prResolve = null
      this._prReject = null
    }
  },

  onRefusePrivacy() {
    this.setData({ privacyVisible: false })
    // 拒绝则让被挂起的接口以失败结束
    if (this._prReject) {
      this._prReject()
      this._prReject = null
      this._prResolve = null
    }
    wx.showToast({ title: '需同意后才能使用', icon: 'none' })
  },

  onOpenPrivacyWeb() {
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({
        fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
      })
    }
  },

  /* ===== 画布初始化 ===== */
  initMapCanvas(retry = 0) {
    const query = wx.createSelectorQuery()
    query.select('#mapCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        // 节点可能尚未就绪（常见于热重载/首帧），自动重试
        if (retry < 10) {
          setTimeout(() => this.initMapCanvas(retry + 1), 120)
          return
        }
        console.error('[travel-map] 地图画布初始化失败（10 次重试均无节点）')
        return
      }
      mapCanvas = res[0].node
      mapCtx = mapCanvas.getContext('2d')
      mapDpr = wx.getSystemInfoSync().pixelRatio
      mapDispW = res[0].width
      mapDispH = res[0].height
      mapCanvas.width = mapDispW * mapDpr
      mapCanvas.height = mapDispH * mapDpr
      this.renderMap()
      this.syncPanel()
      if (!state._imagesLoaded) {
        state._imagesLoaded = true
        this.loadAllImages(() => this.renderMap())
      }
    })
  },

  initPosterCanvas() {
    const query = wx.createSelectorQuery()
    query.select('#posterCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return
      posterCanvas = res[0].node
      posterCtx = posterCanvas.getContext('2d')
    })
  },

  /* ===== 层级（全国 / 省内）===== */
  // 返回当前要绘制的"地图源"：全国层用 regions，省内层用该市数组
  getMapContext() {
    if (state.scope.level === 'province' && state.scope.provinceId) {
      const regs = state.provinceRegionsCache[state.scope.provinceId]
      if (regs) {
        return { regions: regs, viewbox: NORM_VIEWBOX, showBoundary: false, showInsets: false }
      }
    }
    return { regions: state.provinces, viewbox: MAP_VIEWBOX, showBoundary: true, showInsets: true }
  },

  // 某 region 在当前层级下的照片 key
  photoKeyOf(region) {
    if (state.scope.level === 'province') return state.scope.provinceId + ':' + region.id
    return region.id
  },

  // 当前选中单元（省 or 市）的照片 key
  currentPhotoKey() {
    if (!state.activeId) return ''
    if (state.scope.level === 'province') return state.scope.provinceId + ':' + state.activeId
    return state.activeId
  },

  /* ===== 地图渲染 ===== */
  renderMap() {
    if (!mapCtx || !mapCanvas) return
    const ctx = mapCtx
    ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height)
    ctx.save()
    ctx.scale(mapDpr, mapDpr)
    try {
      this.drawMap(ctx, { x: 0, y: 0, w: mapDispW, h: mapDispH }, null)
    } catch (e) {
      console.error('[travel-map] 地图绘制异常', e)
    }
    ctx.restore()
  },

  /**
   * 在任意 Canvas 2D 上下文上绘制地图。
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x,y,w,h}} area - 绘制区域
   * @param {Map|null} posterImages - 海报模式下的图片映射（null 时用 state.photos 中的 image）
   */
  /* 计算一组 region 的实际内容包围盒（归一化坐标），用于省内视图 fit 居中 */
  computeContentBounds(regions) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    regions.forEach(r => {
      const b = r.bbox
      if (!b || b.length < 4) return
      minX = Math.min(minX, b[0])
      minY = Math.min(minY, b[1])
      maxX = Math.max(maxX, b[0] + b[2])
      maxY = Math.max(maxY, b[1] + b[3])
    })
    if (!isFinite(minX)) return { x: 0, y: 0, w: NORM_VIEWBOX, h: NORM_VIEWBOX }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  },

  /* ===== 省内离岛/飞地识别 =====
   * 某些省份含"离主陆地极远"的区划（如海南·三沙市，其包围盒纵跨 y66→970 的南海诸岛），
   * 若纳入 fit 会把主岛压缩到极小。这里返回这些离群区划，主视图将其排除、改绘为右下角缩小补充图。
   * 启发式：逐个区划，若"去掉它后"整体包围盒在任一维度收缩 ≥40%，视为离群。
   * 实测 34 省仅海南·三沙市触发，不影响其他省份。 */
  getProvinceIslandOutliers(regions) {
    if (!regions || regions.length < 3) return []
    const all = regions.map(r => r.bbox)
    const minX = Math.min.apply(null, all.map(b => b[0]))
    const maxX = Math.max.apply(null, all.map(b => b[0] + b[2]))
    const minY = Math.min.apply(null, all.map(b => b[1]))
    const maxY = Math.max.apply(null, all.map(b => b[1] + b[3]))
    const W = maxX - minX, H = maxY - minY
    if (W <= 0 || H <= 0) return []
    const SHRINK = 0.40
    const flagged = []
    regions.forEach((r, i) => {
      const xs = [], x2s = [], ys = [], y2s = []
      regions.forEach((_, j) => {
        if (j === i) return
        xs.push(all[j][0]); x2s.push(all[j][0] + all[j][2])
        ys.push(all[j][1]); y2s.push(all[j][1] + all[j][3])
      })
      const wwo = Math.max.apply(null, x2s) - Math.min.apply(null, xs)
      const hwo = Math.max.apply(null, y2s) - Math.min.apply(null, ys)
      const sw = (W - wwo) / W
      const sh = (H - hwo) / H
      if (sw >= SHRINK || sh >= SHRINK) flagged.push(r)
    })
    // 仅当离群确属少数才生效，避免把本就离散的多块陆地整体误判
    if (flagged.length === 0 || flagged.length >= regions.length * 0.5) return []
    return flagged
  },

  drawMap(ctx, area, posterImages, highlightId) {
    if (highlightId === undefined) highlightId = state.activeId
    const template = templates[state.template]
    const mc = this.getMapContext()
    const isProvince = state.scope.level === 'province'

    // 省内视图：识别并分离"离岛/飞地"区划（如海南·三沙市）。主视图仅 fit 主陆地，
    // 离岛改为右下角缩小补充图，避免主岛被压缩到极小、不居中。
    let insetRegions = []
    let mainRegions = mc.regions
    let scale = area.w / mc.viewbox
    let tx = area.x
    let ty = area.y

    if (isProvince && mc.viewbox === NORM_VIEWBOX) {
      insetRegions = this.getProvinceIslandOutliers(mc.regions)
      mainRegions = mc.regions.filter(r => insetRegions.indexOf(r) < 0)
      const cb = this.computeContentBounds(mainRegions)
      const fit = 0.94
      scale = Math.min(area.w / cb.w, area.h / cb.h) * fit
      tx = area.x + (area.w - cb.w * scale) / 2 - cb.x * scale
      ty = area.y + (area.h - cb.h * scale) / 2 - cb.y * scale
    }

    // 记录当前变换矩阵，供点击命中检测使用（同时修复省内视图点击偏移）
    this._mapXF = { tx, ty, scale, viewbox: mc.viewbox, isProvince }
    this._provinceInset = null

    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(scale, scale)

    /* --- 省份 / 地市（主视图，不含离岛） --- */
    mainRegions.forEach(province => {
      const photo = state.photos.get(this.photoKeyOf(province))
      const img = getPhotoImage(this.photoKeyOf(province), posterImages)

      ctx.save()

      // 照片裁剪
      if (img) {
        ctx.beginPath()
        tracePath(ctx, province.d)
        ctx.clip()
        const [bx, by, bw, bh] = province.bbox
        const base = Math.max(bw, bh)
        const ps = photo ? photo.scale : 1.12
        const size = base * ps
        const ix = bx + bw / 2 - size / 2 + (photo ? photo.x : 0)
        const iy = by + bh / 2 - size / 2 + (photo ? photo.y : 0)
        ctx.drawImage(img, ix, iy, size, size)
      }

      // 省份路径
      ctx.beginPath()
      tracePath(ctx, province.d)
      ctx.fillStyle = img ? 'transparent' : template.empty
      ctx.fill()
      ctx.strokeStyle = province.id === highlightId ? template.active : template.border
      ctx.lineWidth = province.id === highlightId ? 2 : 1
      ctx.lineJoin = 'round'
      ctx.stroke()

      // 选中省份标签
      if (province.id === highlightId && province.bbox[2] > 22 && province.bbox[3] > 18) {
        const fs = 22
        ctx.font = `700 ${fs}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.strokeStyle = 'rgba(255, 250, 241, 0.88)'
        ctx.lineWidth = 4
        ctx.lineJoin = 'round'
        ctx.strokeText(province.name, province.label[0], province.label[1])
        ctx.fillStyle = img ? '#ffffff' : template.label
        ctx.fillText(province.name, province.label[0], province.label[1])
      }

      ctx.restore()
    })

    // 国界线
    if (mc.showBoundary && boundaryPath) {
      ctx.beginPath()
      tracePath(ctx, boundaryPath)
      ctx.strokeStyle = '#b7ad8b'
      ctx.lineWidth = 1.2
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    // 选中省份高亮描边（仅主视图区域）
    const active = mainRegions.find(p => p.id === highlightId)
    if (active) {
      ctx.beginPath()
      tracePath(ctx, active.d)
      ctx.strokeStyle = template.active
      ctx.lineWidth = 4
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    // 放大图（仅全国层）
    if (mc.showInsets) {
      this.drawSouthSeaInset(ctx, template, posterImages, highlightId)
      this.drawHongKongMacauInset(ctx, template, posterImages, highlightId)
    }

    ctx.restore()

    // 省内离岛缩小补充图（屏幕坐标，右下角悬浮卡片）
    if (isProvince && insetRegions.length) {
      this.drawProvinceIslandsInset(ctx, area, template, posterImages, highlightId, insetRegions)
    }
  },

  /* ===== 南海诸岛放大图 ===== */
  drawSouthSeaInset(ctx, template, posterImages, highlightId) {
    if (highlightId === undefined) highlightId = state.activeId
    const data = getSouthSeaInsetData()
    if (!data) return

    const frame = { x: 828, y: 842, w: 286, h: 250, padding: 28 }
    const innerW = frame.w - frame.padding * 2
    const innerH = frame.h - frame.padding * 2 - 28
    const s = Math.min(innerW / data.bounds.width, innerH / data.bounds.height)
    const ox = frame.x + frame.padding + (innerW - data.bounds.width * s) / 2 - data.bounds.x * s
    const oy = frame.y + 54 + (innerH - data.bounds.height * s) / 2 - data.bounds.y * s

    // 框
    ctx.save()
    roundRect(ctx, frame.x, frame.y, frame.w, frame.h, 8)
    ctx.fillStyle = 'rgba(255, 250, 241, 0.88)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(135, 119, 93, 0.44)'
    ctx.lineWidth = 1.4
    ctx.stroke()

    // 标题
    ctx.fillStyle = '#5d675f'
    ctx.font = `800 19px ${TEXT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('南海诸岛', frame.x + 18, frame.y + 31)

    // 照片
    const img = getPhotoImage(data.province.id, posterImages)
    if (img) {
      ctx.save()
      ctx.translate(ox, oy)
      ctx.scale(s, s)
      ctx.beginPath()
      data.islands.forEach(island => tracePath(ctx, island.d))
      ctx.clip()
      ctx.translate(-ox, -oy)
      ctx.scale(1 / s, 1 / s)
      drawCoverImage(ctx, img, frame.x + frame.padding, frame.y + 54, innerW, innerH)
      ctx.restore()
    }

    // 岛屿路径
    ctx.save()
    ctx.translate(ox, oy)
    ctx.scale(s, s)
    data.islands.forEach(island => {
      ctx.beginPath()
      tracePath(ctx, island.d)
      ctx.fillStyle = img ? 'transparent' : template.empty
      ctx.fill()
      ctx.strokeStyle = data.province.id === highlightId ? template.active : '#d8cdb9'
      ctx.lineWidth = 1.55 / s
      ctx.lineJoin = 'round'
      ctx.stroke()
    })
    ctx.restore()

    ctx.restore()
  },

  /* ===== 港澳放大图 ===== */
  drawHongKongMacauInset(ctx, template, posterImages, highlightId) {
    if (highlightId === undefined) highlightId = state.activeId
    const data = getHKMacauInsetData()
    if (!data) return

    const frame = { x: 932, y: 664, w: 182, h: 152, padding: 22 }
    const innerW = frame.w - frame.padding * 2
    const innerH = frame.h - frame.padding * 2 - 36
    const s = Math.min(innerW / data.bounds.width, innerH / data.bounds.height)
    const ox = frame.x + frame.padding + (innerW - data.bounds.width * s) / 2 - data.bounds.x * s
    const oy = frame.y + 48 + (innerH - data.bounds.height * s) / 2 - data.bounds.y * s

    ctx.save()
    roundRect(ctx, frame.x, frame.y, frame.w, frame.h, 8)
    ctx.fillStyle = 'rgba(255, 250, 241, 0.9)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(135, 119, 93, 0.44)'
    ctx.lineWidth = 1.4
    ctx.stroke()

    ctx.fillStyle = '#5d675f'
    ctx.font = `800 18px ${TEXT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('港澳', frame.x + 16, frame.y + 30)

    data.regions.forEach(region => {
      const img = getPhotoImage(region.id, posterImages)
      const photo = state.photos.get(region.id)

      ctx.save()
      ctx.translate(ox, oy)
      ctx.scale(s, s)

      if (img) {
        ctx.beginPath()
        tracePath(ctx, region.d)
        ctx.clip()
        ctx.translate(-ox, -oy)
        ctx.scale(1 / s, 1 / s)
        drawCoverImage(ctx, img, frame.x + frame.padding, frame.y + 48, innerW, innerH)
        ctx.translate(ox, oy)
        ctx.scale(s, s)
      }

      ctx.beginPath()
      tracePath(ctx, region.d)
      ctx.fillStyle = img ? 'transparent' : template.empty
      ctx.fill()
      ctx.strokeStyle = region.id === highlightId ? template.active : '#d8cdb9'
      ctx.lineWidth = 1.6 / s
      ctx.lineJoin = 'round'
      ctx.stroke()

      // 港澳放大图内不再绘制省名标签（下方独立方框已标注，避免字相对小点显得过大）

      ctx.restore()
    })

    ctx.restore()
  },

  /* ===== 省内离岛/飞地缩小补充图（如海南·三沙市/南海诸岛） ===== */
  drawProvinceIslandsInset(ctx, area, template, posterImages, highlightId, insetRegions) {
    if (highlightId === undefined) highlightId = state.activeId

    // 离岛合并包围盒（归一化坐标）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    insetRegions.forEach(r => {
      const b = r.bbox
      minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1])
      maxX = Math.max(maxX, b[0] + b[2]); maxY = Math.max(maxY, b[1] + b[3])
    })
    if (!isFinite(minX)) return
    const bw = maxX - minX, bh = maxY - minY
    if (bw <= 0 || bh <= 0) return

    // 卡片尺寸（屏幕/area 坐标，右下角悬浮）
    const margin = 12
    const frameW = Math.min(area.w * 0.32, 240)
    const frameH = frameW * 0.80
    const fx = area.x + area.w - frameW - margin
    const fy = area.y + area.h - frameH - margin

    // 内区（标题下方）
    const pad = 14
    const titleH = 26
    const innerX = fx + pad
    const innerTop = fy + titleH
    const innerW = frameW - pad * 2
    const innerH = frameH - titleH - pad

    const s = Math.min(innerW / bw, innerH / bh) * 0.96
    const cw = bw * s, ch = bh * s
    const ox = innerX + (innerW - cw) / 2 - minX * s
    const oy = innerTop + (innerH - ch) / 2 - minY * s

    // 记录命中信息供 hitTest 使用
    this._provinceInset = {
      frame: { x: fx, y: fy, w: frameW, h: frameH },
      inner: { ox, oy, s },
      regions: insetRegions
    }

    ctx.save()
    // 悬浮卡片阴影
    ctx.shadowColor = 'rgba(54, 45, 30, 0.22)'
    ctx.shadowBlur = 20
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 8
    roundRect(ctx, fx, fy, frameW, frameH, 16)
    ctx.fillStyle = 'rgba(255, 250, 241, 0.95)'
    ctx.fill()
    // 关闭阴影再描边，避免阴影被边框叠加
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.strokeStyle = 'rgba(135, 119, 93, 0.42)'
    ctx.lineWidth = 1.4
    ctx.stroke()

    // 标题
    ctx.fillStyle = '#5d675f'
    ctx.font = `800 17px ${TEXT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(insetRegions.map(r => r.name).join('·'), fx + 14, fy + 19)

    // 离岛路径
    insetRegions.forEach(region => {
      const key = state.scope.level === 'province' ? state.scope.provinceId + ':' + region.id : region.id
      const img = getPhotoImage(key, posterImages)

      if (img) {
        ctx.save()
        ctx.translate(ox, oy)
        ctx.scale(s, s)
        ctx.beginPath()
        tracePath(ctx, region.d)
        ctx.clip()
        ctx.translate(-ox, -oy)
        ctx.scale(1 / s, 1 / s)
        drawCoverImage(ctx, img, innerX, innerTop, innerW, innerH)
        ctx.restore()
      }

      ctx.save()
      ctx.translate(ox, oy)
      ctx.scale(s, s)
      ctx.beginPath()
      tracePath(ctx, region.d)
      ctx.fillStyle = img ? 'transparent' : template.empty
      ctx.fill()
      ctx.strokeStyle = region.id === highlightId ? template.active : '#d8cdb9'
      ctx.lineWidth = 1.8 / s
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()
    })

    ctx.restore()
  },

  /* ===== 点击省份（命中检测） ===== */
  onMapTap(e) {
    if (!mapCtx) return
    const tapX = e.detail.x
    const tapY = e.detail.y

    const query = wx.createSelectorQuery()
    query.select('#mapCanvas').boundingClientRect()
    query.exec((res) => {
      const rect = res[0]
      if (!rect) return
      const cssX = tapX - rect.left
      const cssY = tapY - rect.top
      const region = this.hitTest(cssX, cssY)
      if (!region) return
      // 顶层导航栏是唯一进省入口（点地图/下拉只做"选中高亮"，不自动进省）
      this.selectRegion(region.id)
    })
  },

  hitTest(cssX, cssY) {
    const ctx = mapCtx
    const sx = mapDispW / MAP_VIEWBOX
    const sy = mapDispH / MAP_VIEWBOX

    // ① 省内离岛补充图优先命中（屏幕坐标）
    const inset = this._provinceInset
    if (inset && state.scope.level === 'province') {
      const f = inset.frame
      if (cssX >= f.x && cssX <= f.x + f.w && cssY >= f.y && cssY <= f.y + f.h) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(mapDpr, mapDpr)
        ctx.translate(inset.inner.ox, inset.inner.oy)
        ctx.scale(inset.inner.s, inset.inner.s)
        let hit = null
        for (const region of inset.regions) {
          ctx.beginPath()
          tracePath(ctx, region.d)
          if (ctx.isPointInPath(cssX * mapDpr, cssY * mapDpr)) { hit = region; break }
        }
        ctx.restore()
        return hit || inset.regions[0]
      }
    }

    // ② 全国层放大图（南海诸岛 / 港澳）命中
    if (this.getMapContext().showInsets) {
      const ssData = getSouthSeaInsetData()
      if (ssData) {
        const frame = { x: 828, y: 842, w: 286, h: 250 }
        if (cssX >= frame.x * sx && cssX <= (frame.x + frame.w) * sx &&
            cssY >= frame.y * sy && cssY <= (frame.y + frame.h) * sy) {
          return ssData.province
        }
      }
      const hkData = getHKMacauInsetData()
      if (hkData) {
        const frame = { x: 932, y: 664, w: 182, h: 152 }
        if (cssX >= frame.x * sx && cssX <= (frame.x + frame.w) * sx &&
            cssY >= frame.y * sy && cssY <= (frame.y + frame.h) * sy) {
          const mid = (frame.x + frame.w / 2) * sx
          return cssX < mid ? hkData.regions[0] : hkData.regions[hkData.regions.length - 1]
        }
      }
    }

    // ③ 主区域命中（使用 drawMap 记录的真实变换，支持省内 fit 居中）
    const xf = this._mapXF
    if (!xf) return null

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(mapDpr, mapDpr)
    ctx.translate(xf.tx, xf.ty)
    ctx.scale(xf.scale, xf.scale)

    const mc = this.getMapContext()
    const regions = state.scope.level === 'province'
      ? mc.regions.filter(r => !inset || inset.regions.indexOf(r) < 0)
      : mc.regions

    const nx = (cssX - xf.tx) / xf.scale
    const ny = (cssY - xf.ty) / xf.scale

    for (let i = regions.length - 1; i >= 0; i--) {
      const province = regions[i]
      const [bx, by, bw, bh] = province.bbox
      if (nx < bx - 5 || nx > bx + bw + 5 || ny < by - 5 || ny > by + bh + 5) continue
      ctx.beginPath()
      tracePath(ctx, province.d)
      try {
        if (ctx.isPointInPath(cssX * mapDpr, cssY * mapDpr)) {
          ctx.restore()
          return province
        }
      } catch (err) {
        ctx.restore()
        return province
      }
    }
    ctx.restore()
    return null
  },

  /* ===== 选择区域（省 / 市通用） ===== */
  selectRegion(id) {
    state.activeId = id
    const mc = this.getMapContext()
    const idx = mc.regions.findIndex(r => r.id === id)
    if (idx >= 0) this.setData({ regionIndex: idx })
    this.renderMap()
    this.syncPanel()
  },

  /* ===== 进入省内（显示该省地级市地图） ===== */
  enterProvince(provinceId) {
    const regs = geo.getProvinceRegions(provinceId, state.provinceRegionsCache)
    if (!regs || regs.length === 0) {
      this.selectRegion(provinceId)
      return
    }
    state.scope = { level: 'province', provinceId }
    const prov = state.provinces.find(p => p.id === provinceId)
    state.activeId = regs[0] ? regs[0].id : ''
    this.setData({
      scopeLevel: 'province',
      scopeProvinceName: prov ? prov.name : '',
      regionNames: regs.map(r => r.name),
      regionIndex: 0,
      activeNavId: provinceId,
    })
    this.renderMap()
    this.syncPanel()
  },

  /* ===== 返回全国层 ===== */
  exitProvince() {
    const backId = state.scope.provinceId
    state.scope = { level: 'country', provinceId: '' }
    state.activeId = backId || (state.provinces[0] ? state.provinces[0].id : '')
    const idx = state.provinces.findIndex(p => p.id === state.activeId)
    this.setData({
      scopeLevel: 'country',
      scopeProvinceName: '',
      regionNames: state.provinces.map(p => p.name),
      regionIndex: Math.max(0, idx),
      activeNavId: 'country',
    })
    this.renderMap()
    this.syncPanel()
  },

  /* ===== 顶层导航栏（横向滚动标签条：全国 / 各省） ===== */
  buildNavItems() {
    const provinces = state.provinces
    const fujian = provinces.find(p => p.id === '350000')
    const others = provinces.filter(p => p.id !== '350000')
    const items = [{ id: 'country', name: '全国', type: 'country' }]
    if (fujian) items.push({ id: fujian.id, name: fujian.name, type: 'province' })
    others.forEach(p => items.push({ id: p.id, name: p.name, type: 'province' }))
    this.setData({
      navItems: items,
      activeNavId: state.scope.level === 'province' ? state.scope.provinceId : 'country'
    })
  },

  onNavTap(e) {
    const type = e.currentTarget.dataset.type
    const id = e.currentTarget.dataset.id
    if (type === 'country') {
      if (state.scope.level === 'province') this.exitProvince()
    } else {
      this.enterProvince(id)
    }
  },

  /* ===== 下拉选择（省 / 市）：仅选中/高亮，不进省（入口在顶部标签条） ===== */
  onRegionPickerChange(e) {
    const idx = Number(e.detail.value)
    const mc = this.getMapContext()
    const region = mc.regions[idx]
    if (!region) return
    this.selectRegion(region.id)
  },

  syncPanel() {
    const mc = this.getMapContext()
    const region = mc.regions.find(r => r.id === state.activeId)
    const photo = region ? state.photos.get(this.photoKeyOf(region)) : null
    const patch = {
      activeName: region ? region.name : '待加载',
      uploadLabel: photo ? '更换照片' : '上传照片',
      canUpload: !!region,
      hasActivePhoto: !!photo,
      templateName: templates[state.template].name,
    }
    if (state.scope.level === 'province') {
      const prov = state.provinces.find(p => p.id === state.scope.provinceId)
      patch.activeName = (prov ? prov.name : '') + ' · ' + (region ? region.name : '')
    }
    if (photo) {
      patch.scaleValue = Math.round(photo.scale * 100)
      patch.xValue = photo.x
      patch.yValue = photo.y
    } else {
      patch.scaleValue = 112
      patch.xValue = 0
      patch.yValue = 0
    }
    this.setData(patch)
  },

  /* ===== 删除当前区域照片 ===== */
  onDeleteCurrentPhoto() {
    const key = this.currentPhotoKey()
    if (!key) return
    if (!state.photos.has(key)) return
    const mc = this.getMapContext()
    const region = mc.regions.find(r => r.id === state.activeId)
    const name = region ? region.name : '该地区'
    wx.showModal({
      title: '删除照片',
      content: `确定删除「${name}」的照片吗？`,
      success: (res) => {
        if (res.confirm) {
          const photo = state.photos.get(key)
          if (photo && isPersistPath(photo.src)) removeFileSafe(photo.src)
          state.photos.delete(key)
          this.renderMap()
          this.syncPanel()
          this.saveState()
        }
      }
    })
  },

  /* ===== 去过的地方（海报展示） ===== */
  getVisitedText() {
    const mc = this.getMapContext()
    const names = []
    mc.regions.forEach(r => { if (state.photos.has(this.photoKeyOf(r))) names.push(r.name) })
    const n = names.length
    const prefix = state.scope.level === 'province'
      ? ((state.provinces.find(p => p.id === state.scope.provinceId) || {}).name || '') + '的 '
      : ''
    if (n === 0) return '还没有点亮' + prefix + '任何地方'
    if (n <= 6) return '去过 ' + prefix + names.join(' · ')
    return '去过 ' + prefix + names.slice(0, 6).join(' · ') + ' …'
  },

  /* ===== 照片上传 ===== */
  onUploadPhoto() {
    if (!state.activeId) {
      wx.showToast({ title: '请先选择地区', icon: 'none' })
      return
    }
    if (!mapCanvas) {
      wx.showToast({ title: '地图加载中，请稍候', icon: 'none' })
      return
    }
    // 直接调用选图；未授权时微信会通过 onNeedPrivacyAuthorize 弹出隐私弹窗，
    // 用户同意后 resolve() 会让本调用自动恢复，无需手动重调
    this.doChoosePhoto()
  },

  doChoosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: this.data.useOriginal ? ['original'] : ['compressed'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath
        const key = this.currentPhotoKey()
        const old = state.photos.get(key)
        const oldSrc = old ? old.src : ''
        persistTempFile(tempPath, key).then((persistPath) => {
          if (isPersistPath(oldSrc)) removeFileSafe(oldSrc)  // 替换旧图，清理原文件
          const img = mapCanvas.createImage()
          img.onload = () => {
            state.photos.set(key, {
              src: persistPath,
              image: img,
              scale: 1.16,
              x: 0,
              y: 0
            })
            this.renderMap()
            this.syncPanel()
            this.saveState()
          }
          img.onerror = () => {
            wx.showToast({ title: '图片加载失败', icon: 'none' })
          }
          img.src = persistPath
        })
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') >= 0) return // 用户主动取消相册，不提示
        console.error('chooseMedia fail:', err)
        wx.showToast({ title: msg || '选择失败', icon: 'none' })
      }
    })
  },

  /* ===== 原图开关 ===== */
  onToggleOriginal(e) {
    this.setData({ useOriginal: e.detail.value })
    this.saveState()
  },

  /* ===== 头像上传 ===== */
  onUploadAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: this.data.useOriginal ? ['original'] : ['compressed'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath
        const oldAvatar = state.profile.avatar
        persistTempFile(tempPath, 'avatar').then((persistPath) => {
          if (isPersistPath(oldAvatar)) removeFileSafe(oldAvatar)
          state.profile.avatar = persistPath
          this.setData({ avatarUrl: persistPath, hasAvatar: true })
          this.saveState()
        })
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') >= 0) return // 用户主动取消相册，不提示
        console.error('chooseMedia fail:', err)
        wx.showToast({ title: msg || '选择失败', icon: 'none' })
      }
    })
  },

  /* ===== 微信头像（chooseAvatar） ===== */
  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return
    const oldAvatar = state.profile.avatar
    persistTempFile(tempPath, 'avatar').then((persistPath) => {
      if (isPersistPath(oldAvatar)) removeFileSafe(oldAvatar)
      state.profile.avatar = persistPath
      this.setData({ avatarUrl: persistPath, hasAvatar: true })
      this.saveState()
      wx.showToast({ title: '已使用微信头像', icon: 'success' })
    })
  },

  /* ===== 删除头像 ===== */
  onDeleteAvatar() {
    const oldAvatar = state.profile.avatar
    if (isPersistPath(oldAvatar)) removeFileSafe(oldAvatar)
    state.profile.avatar = ''
    this.setData({ avatarUrl: '', hasAvatar: false })
    this.saveState()
  },

  /* ===== 照片调整 ===== */
  setActivePhotoValue(key, value) {
    const photo = state.photos.get(this.currentPhotoKey())
    if (!photo) return
    photo[key] = value
    this.renderMap()
  },

  onScaleChanging(e) {
    this.setActivePhotoValue('scale', e.detail.value / 100)
  },
  onScaleChange(e) {
    this.setData({ scaleValue: e.detail.value })
    this.setActivePhotoValue('scale', e.detail.value / 100)
    this.saveState()
  },
  onXChanging(e) {
    this.setActivePhotoValue('x', e.detail.value)
  },
  onXChange(e) {
    this.setData({ xValue: e.detail.value })
    this.saveState()
  },
  onYChanging(e) {
    this.setActivePhotoValue('y', e.detail.value)
  },
  onYChange(e) {
    this.setData({ yValue: e.detail.value })
    this.saveState()
  },

  /* ===== 模板切换 ===== */
  onTemplateChange(e) {
    const tpl = e.currentTarget.dataset.template
    if (!tpl || tpl === state.template) return
    state.template = tpl
    this.setData({ currentTemplate: tpl, templateName: templates[tpl].name })
    this.renderMap()
    this.saveState()
  },

  /* ===== 昵称 ===== */
  onNicknameInput(e) {
    const v = (e.detail.value || '').trim()
    state.profile.nickname = v
    this.setData({ nickname: v })
    this.saveState()
  },

  onNicknameReview(e) {
    // 微信昵称联想回填：点键盘上方「使用微信昵称」时触发，detail.nickname 携带微信昵称
    const nick = (e.detail && e.detail.nickname ? e.detail.nickname : '').trim()
    if (!nick) return
    state.profile.nickname = nick
    this.setData({ nickname: nick })
    this.saveState()
  },

  /* ===== 清空 ===== */
  onClear() {
    const mc = this.getMapContext()
    const keys = []
    mc.regions.forEach(r => { const k = this.photoKeyOf(r); if (state.photos.has(k)) keys.push(k) })
    if (keys.length === 0) {
      wx.showToast({ title: '暂无照片可清空', icon: 'none' })
      return
    }
    const clearAll = state.scope.level !== 'province'
    wx.showModal({
      title: '确认清空',
      content: clearAll
        ? '将清空所有已上传的省份照片，确定继续吗？'
        : `将清空「${(state.provinces.find(p => p.id === state.scope.provinceId) || {}).name || ''}」下所有已上传的照片，确定继续吗？`,
      success: (res) => {
        if (res.confirm) {
          keys.forEach(k => {
            const photo = state.photos.get(k)
            if (photo && photo.src && isPersistPath(photo.src)) removeFileSafe(photo.src)
            state.photos.delete(k)
          })
          this.renderMap()
          this.syncPanel()
          this.setData({ hasPoster: false, posterUrl: '' })
          this.saveState()
        }
      }
    })
  },

  /* ===== 海报生成 ===== */
  onGeneratePoster() {
    if (state.provinces.length === 0 || !posterCanvas) {
      wx.showToast({ title: '海报生成失败', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成海报中…', mask: true })

    posterCanvas.width = POSTER_W
    posterCanvas.height = POSTER_H

    // 异步加载所有照片到海报画布
    const loadTasks = []
    const posterImages = new Map()

    state.photos.forEach((photo, id) => {
      if (!photo.src) return
      const task = new Promise((resolve) => {
        const img = posterCanvas.createImage()
        img.onload = () => {
          posterImages.set(id, img)
          resolve()
        }
        img.onerror = () => resolve()
        img.src = photo.src
      })
      loadTasks.push(task)
    })

    // 加载头像
    let avatarImg = null
    if (state.profile.avatar) {
      const avatarTask = new Promise((resolve) => {
        avatarImg = posterCanvas.createImage()
        avatarImg.onload = resolve
        avatarImg.onerror = resolve
        avatarImg.src = state.profile.avatar
      })
      loadTasks.push(avatarTask)
    }

    Promise.all(loadTasks).then(() => {
      this.drawPoster(posterImages, avatarImg)
    })
  },

  drawPoster(posterImages, avatarImg) {
    const ctx = posterCtx
    const template = templates[state.template]
    const mc = this.getMapContext()

    // 纸张底色
    ctx.fillStyle = template.paper
    ctx.fillRect(0, 0, POSTER_W, POSTER_H)
    ctx.globalAlpha = 0.08
    for (let y = 0; y < POSTER_H; y += 16) {
      ctx.fillStyle = y % 32 === 0 ? template.accent : '#a8794b'
      ctx.fillRect(0, y, POSTER_W, 1)
    }
    ctx.globalAlpha = 1

    // 标题
    ctx.fillStyle = template.title
    ctx.font = `700 98px ${DISPLAY_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const titleText = state.scope.level === 'province'
      ? ((state.provinces.find(p => p.id === state.scope.provinceId) || {}).name || '浙江') + '打卡'
      : '我的旅行地图'
    ctx.fillText(titleText, 130, 180)

    // 去过的地方（仅列出地名，不含计数）
    ctx.fillStyle = template.accent
    ctx.font = `700 35px ${TEXT_FONT}`
    ctx.fillText(this.getVisitedText(), 134, 244)

    // 头像 + 昵称
    const nickname = state.profile.nickname
    if (avatarImg || nickname) {
      const avatarSize = 78
      const avatarX = 1232
      const avatarY = 112
      const textRight = avatarImg ? avatarX - 24 : 1310
      const textBaseline = avatarImg ? avatarY + 49 : 158

      if (nickname) {
        ctx.save()
        ctx.textAlign = 'right'
        ctx.fillStyle = template.title
        ctx.globalAlpha = 0.82
        ctx.font = `700 34px ${TEXT_FONT}`
        ctx.fillText(trimTextToWidth(ctx, nickname, avatarImg ? 300 : 420), textRight, textBaseline)
        ctx.restore()
      }

      if (avatarImg) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
        ctx.clip()
        drawCoverImage(ctx, avatarImg, avatarX, avatarY, avatarSize, avatarSize)
        ctx.restore()

        ctx.save()
        ctx.strokeStyle = 'rgba(255, 250, 241, 0.92)'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 - 1, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(80, 67, 48, 0.18)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()
      }
    }

    // 地图轮廓投影：沿中国地图整体轮廓生成柔和悬浮阴影（非方框）
    ctx.save()
    ctx.translate(0, 250)
    ctx.scale(POSTER_W / mc.viewbox, POSTER_W / mc.viewbox)
    ctx.shadowColor = 'rgba(54, 45, 30, 0.22)'
    ctx.shadowBlur = 30
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 16
    ctx.beginPath()
    mc.regions.forEach(r => tracePath(ctx, r.d))
    ctx.fillStyle = template.paper
    ctx.fill()
    ctx.restore()

    // 地图（海报模式下不显示选中省份绿框）—— 满幅绘制，使海报上的地图与上方交互地图等大
    this.drawMap(ctx, { x: 0, y: 250, w: POSTER_W, h: POSTER_W }, posterImages, null)

    // 去过的地方展示
    ctx.fillStyle = 'rgba(30, 43, 37, 0.68)'
    ctx.font = `500 34px ${TEXT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const visitedText = this.getVisitedText()
    drawWrappedText(ctx, visitedText, 130, 1750, 960, 50, 2)

    // 日期
    const now = new Date()
    const dateText = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
    ctx.fillStyle = template.title
    ctx.font = `700 34px ${TEXT_FONT}`
    ctx.fillText(dateText, 130, 1840)

    // 导出
    wx.canvasToTempFilePath({
      canvas: posterCanvas,
      success: (res) => {
        this.setData({ posterUrl: res.tempFilePath, hasPoster: true })
        wx.hideLoading()
        wx.showToast({ title: '海报已生成', icon: 'success' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '海报导出失败', icon: 'none' })
      }
    })
  },

  /* ===== 海报预览弹窗 ===== */
  onPosterTap() {
    if (!this.data.hasPoster) return
    this.setData({ posterModalOpen: true })
  },
  onCloseModal() {
    this.setData({ posterModalOpen: false })
  },

  /* ===== 分享（转发好友 / 朋友圈） ===== */
  onShareAppMessage() {
    const scopeName = state.scope.level === 'province'
      ? ((state.provinces.find(p => p.id === state.scope.provinceId) || {}).name || '')
      : ''
    const hasPoster = !!this.data.posterUrl
    const title = scopeName ? scopeName + '打卡地图' : '我的旅行地图'
    return {
      title: hasPoster ? title : '快来看看我的旅行地图',
      path: '/pages/index/index',
      imageUrl: this.data.posterUrl || ''
    }
  },

  onShareTimeline() {
    const scopeName = state.scope.level === 'province'
      ? ((state.provinces.find(p => p.id === state.scope.provinceId) || {}).name || '')
      : ''
    const title = scopeName ? scopeName + '打卡地图' : '我的旅行地图'
    return {
      title,
      query: '',
      imageUrl: this.data.posterUrl || ''
    }
  },

  /* ===== 保存海报到相册 ===== */
  onSavePoster() {
    if (!this.data.posterUrl) {
      wx.showToast({ title: '请先生成海报', icon: 'none' })
      return
    }
    this.doSavePoster()
  },

  doSavePoster() {
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterUrl,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({
            title: '提示',
            content: '需要相册权限才能保存图片，请在设置中开启',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting()
            }
          })
        } else if (err.errMsg && err.errMsg.includes('privacy')) {
          this.setData({ privacyVisible: true })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },
})
