App({
  onLaunch() {
    // 初始化云开发（用于图片内容安全检测）
    if (wx.cloud) {
      wx.cloud.init({ env: 'cloud1-d3gp4b4kz2be22e9a' })
    }
  },
  globalData: {
    provinces: [],
    boundaryPath: ""
  }
});
