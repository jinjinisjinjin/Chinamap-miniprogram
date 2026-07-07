/**
 * 行政区划地理数据工具
 *
 * 每个省级行政区对应 utils/geo/{adcode}.js，内容是一个「紧凑 region 数组」：
 *   [{ id, name, d(SVG path), bbox, label }, ...]
 * 字段与全国省份（map-data.js）完全同构，drawMap / hitTest 等逻辑无需区分。
 *
 * 为何是预计算的紧凑数组（而非原始 GeoJSON）？
 *   - 控制主包体积：原始 GeoJSON（6 位小数坐标）34 省合计 ~3.7MB，超过小程序 2MB 主包上限。
 *   - 已在生成阶段做 Douglas-Peucker 简化（容差 0.015°≈1.6km，手机尺度下视觉无损）+ 2 位小数取整，
 *     并预处理成最终 region 数组，运行时不再解析 GeoJSON，体积降到 ~0.75MB，主包总计 ~1.23MB。
 *
 * 数据来源：
 *   - 大陆 33 省 + 香港/澳门：阿里云 DataV GeoAtlas 的 {adcode}_full.json（地级市/直辖市辖区/特区分区边界）
 *   - 台湾省(710000)：click_that_hood 开源数据集（22 个县市）；map.worldmap.pro 仅为地图查看器，无矢量下载
 * 重新生成见技能 province-geo-data（或外部归档 geo-sources/ 下的原始 GeoJSON）。
 *
 * 注意：这里用「显式静态 require」而非 `require('./geo/'+id+'.js')` 动态拼接——
 * 微信打包器无法静态解析动态路径，会导致模块不被打包、运行时找不到。
 */

const NORM_VIEWBOX = 1000

// 已接入省内（地级市/区县）数据的 34 个省级行政区。
// 新增省份：把对应的 {adcode}.js 放进 utils/geo/、在此追加一行 require 即可。
const GEO_SOURCES = {
  '110000': require('./geo/110000.js'), // 北京
  '120000': require('./geo/120000.js'), // 天津
  '130000': require('./geo/130000.js'), // 河北
  '140000': require('./geo/140000.js'), // 山西
  '150000': require('./geo/150000.js'), // 内蒙古
  '210000': require('./geo/210000.js'), // 辽宁
  '220000': require('./geo/220000.js'), // 吉林
  '230000': require('./geo/230000.js'), // 黑龙江
  '310000': require('./geo/310000.js'), // 上海
  '320000': require('./geo/320000.js'), // 江苏
  '330000': require('./geo/330000.js'), // 浙江
  '340000': require('./geo/340000.js'), // 安徽
  '350000': require('./geo/350000.js'), // 福建
  '360000': require('./geo/360000.js'), // 江西
  '370000': require('./geo/370000.js'), // 山东
  '410000': require('./geo/410000.js'), // 河南
  '420000': require('./geo/420000.js'), // 湖北
  '430000': require('./geo/430000.js'), // 湖南
  '440000': require('./geo/440000.js'), // 广东
  '450000': require('./geo/450000.js'), // 广西
  '460000': require('./geo/460000.js'), // 海南
  '500000': require('./geo/500000.js'), // 重庆
  '510000': require('./geo/510000.js'), // 四川
  '520000': require('./geo/520000.js'), // 贵州
  '530000': require('./geo/530000.js'), // 云南
  '540000': require('./geo/540000.js'), // 西藏
  '610000': require('./geo/610000.js'), // 陕西
  '620000': require('./geo/620000.js'), // 甘肃
  '630000': require('./geo/630000.js'), // 青海
  '640000': require('./geo/640000.js'), // 宁夏
  '650000': require('./geo/650000.js'), // 新疆
  '710000': require('./geo/710000.js'), // 台湾（22 县市，click_that_hood 开源数据）
  '810000': require('./geo/810000.js'), // 香港
  '820000': require('./geo/820000.js')  // 澳门
}

/**
 * 取某省的市内 region 数组（带缓存）。
 * @param {string} provinceId 省级 adcode
 * @param {object} [cache] 缓存对象（state.provinceRegionsCache）
 * @returns {Array|null}
 */
function getProvinceRegions(provinceId, cache) {
  if (cache && cache[provinceId]) return cache[provinceId]
  const src = GEO_SOURCES[provinceId]
  if (!src) return null
  if (cache) cache[provinceId] = src
  return src
}

/** 该省是否有市内地理数据 */
function hasProvinceGeo(provinceId) {
  return !!GEO_SOURCES[provinceId]
}

/** 省内归一化坐标范围（正方形 viewbox 边长） */
function getProvinceViewbox() {
  return NORM_VIEWBOX
}

module.exports = {
  NORM_VIEWBOX,
  getProvinceRegions,
  hasProvinceGeo,
  getProvinceViewbox,
  GEO_SOURCES
}
