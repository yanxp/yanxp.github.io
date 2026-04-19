const { SBTI_TYPES } = require('../../utils/types')

Page({
  data: {
    types: [],
    stats: {
      questions: 30,
      models: 5,
      dimensions: 15,
      types: 25
    }
  },

  onLoad() {
    // Only pass minimal data needed for card display to avoid setData timeout
    const types = SBTI_TYPES.map(t => ({
      code: t.code,
      emoji: t.emoji,
      name: t.name
    }))
    this.setData({ types })
  },

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
