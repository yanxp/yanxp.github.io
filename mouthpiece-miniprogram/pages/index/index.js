const { SBTI_TYPES } = require('../../utils/types')

Page({
  data: {
    types: SBTI_TYPES,
    stats: {
      questions: 30,
      models: 5,
      dimensions: 15,
      types: 25
    }
  },

  onLoad() {},

  onShareAppMessage() {
    return {
      title: '互联网嘴替测试 — 测测你是哪种网络人格？',
      path: '/pages/index/index'
    }
  },

  startQuiz() {
    wx.navigateTo({ url: '/pages/quiz/quiz' })
  },

  viewType(e) {
    const code = e.currentTarget.dataset.code
    wx.navigateTo({ url: `/pages/type-detail/type-detail?code=${code}` })
  }
})
