/**
 * 行政区划地理数据工具
 * 将 DataV GeoAtlas 的 GeoJSON（经纬度坐标）转换为与全国省份（map-data.js）
 * 完全同构的 region 结构：{ id, name, d(SVG path), bbox, label }，
 * 这样 drawMap / hitTest 等现有逻辑无需区分"全国"还是"省内"。
 *
 * 坐标归一化到 NORM_VIEWBOX 正方形：保持长宽比、居中、y 轴翻转（经纬度纬度越大越北，
 * 而 SVG y 轴向下，故翻转使北方在上）。
 */

const NORM_VIEWBOX = 1000

// 省级行政区数据源（按需添加，初期仅浙江）。key = 全国 provinces 的 id（即 adcode）
const GEO_SOURCES = {
  '330000': require('./geo/zhejiang.js'), // 浙江（须用 .js 模块；小程序 require 不支持加载 .json）
}

// 将单个 [lon, lat] 归一化到 NORM_VIEWBOX
function normPoint(pt, b, viewbox) {
  const wLon = (b.maxLon - b.minLon) || 1
  const hLat = (b.maxLat - b.minLat) || 1
  const s = Math.min(viewbox / wLon, viewbox / hLat) * 0.94
  const offX = (viewbox - wLon * s) / 2
  const offY = (viewbox - hLat * s) / 2
  const x = offX + (pt[0] - b.minLon) * s
  const y = offY + (b.maxLat - pt[1]) * s
  return [x, y]
}

/**
 * 将 GeoJSON FeatureCollection 转为 region 数组。
 * @param {object} geojson
 * @param {number} viewbox
 * @returns {Array<{id,name,d,bbox,label}>}
 */
function geojsonToRegions(geojson, viewbox) {
  if (!geojson || !geojson.features) return []
  // 1) 先算【全省】统一经纬度包围盒（关键：所有市必须共用同一归一化基准，
  //    否则各自占满 1000x1000 会导致各市在地图上完全重叠）
  const gb = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity }
  for (const f of geojson.features) {
    const geom = f.geometry
    if (!geom || !geom.coordinates) continue
    const polygons = geom.type === 'MultiPolygon'
      ? geom.coordinates
      : [geom.coordinates]
    polygons.forEach((poly) => poly.forEach((ring) => ring.forEach(([lon, lat]) => {
      if (lon < gb.minLon) gb.minLon = lon
      if (lat < gb.minLat) gb.minLat = lat
      if (lon > gb.maxLon) gb.maxLon = lon
      if (lat > gb.maxLat) gb.maxLat = lat
    })))
  }
  if (gb.minLon === Infinity) return []

  const out = []
  for (const f of geojson.features) {
    const props = f.properties || {}
    const name = props.name || props.fullName || ''
    const id = String(props.adcode != null ? props.adcode : props.id || name)
    const geom = f.geometry
    if (!geom || !geom.coordinates) continue

    const polygons = geom.type === 'MultiPolygon'
      ? geom.coordinates
      : [geom.coordinates] // 兼容单个 Polygon

    // 2) 用全省统一 bbox 生成 path（每个多边形：外环 + 内环，均用 M..L..Z）
    let d = ''
    polygons.forEach((poly) => {
      poly.forEach((ring) => {
        ring.forEach((pt, i) => {
          const [x, y] = normPoint(pt, gb, viewbox)
          d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' '
        })
        d += 'Z '
      })
    })

    // 3) 计算归一化后的 bbox 与标签中心（仍用全省基准 gb）
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
    polygons.forEach((poly) => poly.forEach((ring) => ring.forEach((pt) => {
      const [x, y] = normPoint(pt, gb, viewbox)
      if (x < bx0) bx0 = x
      if (y < by0) by0 = y
      if (x > bx1) bx1 = x
      if (y > by1) by1 = y
    })))
    const bbox = [bx0, by0, bx1 - bx0, by1 - by0]
    const label = [(bx0 + bx1) / 2, (by0 + by1) / 2]

    out.push({ id, name, d, bbox, label })
  }
  return out
}

/**
 * 取某省的市内 region 数组（带缓存）。
 * @param {string} provinceId 省级 adcode（与全国 provinces.id 一致）
 * @param {object} [cache] 缓存对象（state.provinceRegionsCache）
 * @returns {Array|null}
 */
function getProvinceRegions(provinceId, cache) {
  if (cache && cache[provinceId]) return cache[provinceId]
  const src = GEO_SOURCES[provinceId]
  if (!src) return null
  const regs = geojsonToRegions(src, NORM_VIEWBOX)
  if (cache) cache[provinceId] = regs
  return regs
}

/** 该省是否有市内地理数据 */
function hasProvinceGeo(provinceId) {
  return !!GEO_SOURCES[provinceId]
}

/** 取省内某市的归一化坐标范围（用于地图视图定位，预留） */
function getProvinceViewbox() {
  return NORM_VIEWBOX
}

module.exports = {
  NORM_VIEWBOX,
  geojsonToRegions,
  getProvinceRegions,
  hasProvinceGeo,
  getProvinceViewbox,
}
