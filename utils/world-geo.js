/**
 * 世界地图行政区划地理数据工具
 *
 * 每个一级区域（亚洲 / 欧洲 / 非洲 / 北美洲 / 南美洲 / 大洋洲 / 南极洲）
 * 各自对应 utils/geo/{id}.js，内容是一个「紧凑 region 数组」：
 *   [{ id, name, d(SVG path), bbox, label }, ...]
 * 字段与世界层 regions（world-data.js）完全同构，drawMap / hitTest 等逻辑无需区分。
 *
 * 为何是预计算的紧凑数组（而非原始 GeoJSON）？
 *   - 控制主包体积：世界 200+ 国家/地区的原始 GeoJSON 体积巨大，远超小程序 2MB 主包上限。
 *   - 已在生成阶段做 Douglas-Peucker 简化 + 小数位取整，并预处理成最终 region 数组，
 *     运行时不再解析 GeoJSON，主包体积控制在 ~1.3MB，远低于 2MB 上限。
 *
 * 数据来源：Natural Earth 1:110m countries，统一等距圆柱投影后预处理。
 * 严格按 7 大洲排布；美国/加拿大/澳大利亚作为国家并入对应大洲（北美/大洋洲），
 * 不再作为独立一级区域。台湾、香港、澳门作为中国地区处理（中国台湾 / 中国香港 / 中国澳门）。
 * 南极洲为占位大洲，无下级细分。
 *
 * 注意：这里用「显式静态 require」而非 `require('./geo/'+id+'.js')` 动态拼接——
 * 微信打包器无法静态解析动态路径，会导致模块不被打包、运行时找不到。
 */

const NORM_VIEWBOX = 1000

// 已接入下级地理数据的 7 个一级世界区域（南极洲无下级，数组为空）。
// 新增区域：把对应的 {id}.js 放进 utils/geo/、在此追加一行 require 即可。
const GEO_SOURCES = {
  'asia': require('./geo/asia.js'),            // 亚洲（含中国台湾/中国香港/中国澳门）
  'europe': require('./geo/europe.js'),        // 欧洲（36 国）
  'africa': require('./geo/africa.js'),        // 非洲（50 国）
  'north-america': require('./geo/north-america.js'), // 北美洲（18 国/地区，含美国/加拿大）
  'south-america': require('./geo/south-america.js'), // 南美洲（13 国）
  'oceania': require('./geo/oceania.js'),      // 大洋洲（7 国/地区，含澳大利亚）
  'antarctica': require('./geo/antarctica.js') // 南极洲（占位，无下级细分）
}

/**
 * 取某区域的下级 region 数组（带缓存）。
 * @param {string} regionId 一级区域 id
 * @param {object} [cache] 缓存对象（state.provinceRegionsCache）
 * @returns {Array|null}
 */
function getRegionRegions(regionId, cache) {
  if (cache && cache[regionId]) return cache[regionId]
  const src = GEO_SOURCES[regionId]
  if (!src) return null
  if (cache) cache[regionId] = src
  return src
}

/** 该区域是否有下级地理数据 */
function hasRegionGeo(regionId) {
  return !!GEO_SOURCES[regionId]
}

/** 下级归一化坐标范围（正方形 viewbox 边长） */
function getRegionViewbox() {
  return NORM_VIEWBOX
}

module.exports = {
  NORM_VIEWBOX,
  getRegionRegions,
  hasRegionGeo,
  getRegionViewbox,
  GEO_SOURCES
}
