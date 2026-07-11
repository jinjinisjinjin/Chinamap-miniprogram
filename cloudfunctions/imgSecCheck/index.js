const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 图片内容安全检测
 *
 * 入参 event:
 *   - value:     图片内容（base64 编码字符串，由客户端从 tempFilePath 读取后传入）
 *   - contentType: 图片 MIME 类型（如 'image/jpeg'、'image/png'）
 *
 * 返回:
 *   { code: 0, msg: 'ok' }          —— 检测通过，图片安全
 *   { code: 87009, msg: '...' }     —— 检测不通过，含违规内容（errCode 87009）
 *   { code: -1, msg: '...' }        —— 其他异常
 */
exports.main = async (event, context) => {
  const value = event.value
  const contentType = event.contentType || 'image/jpeg'

  if (!value) {
    return { code: -1, msg: '缺少图片数据' }
  }

  try {
    // base64 → Buffer，传给微信 imgSecCheck 接口
    const buf = typeof value === 'string'
      ? Buffer.from(value, 'base64')
      : value

    const res = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType,
        value: buf
      }
    })

    // 调用成功且无违规 → 通过
    return { code: 0, msg: 'ok', data: res }
  } catch (err) {
    const errCode = err.errCode || -1
    return {
      code: errCode,
      msg: err.errMsg || '检测服务异常',
      errCode
    }
  }
}
