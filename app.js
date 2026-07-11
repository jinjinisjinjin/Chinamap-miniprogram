App({
  onLaunch() {
    // 初始化云开发（用于图片内容安全检测）
    if (wx.cloud) {
      wx.cloud.init({ env: 'your-env-id' })
    }
  },
  globalData: {
    provinces: [],
    boundaryPath: ""
  }
});
