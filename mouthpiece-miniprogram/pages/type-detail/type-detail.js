const { SBTI_TYPES, TYPE_GROUPS, DIMENSION_LABELS } = require('../../utils/types')

Page({
  data: {
    type: null,
    groupName: '',
    groupDesc: '',
    patternItems: []
  },

  onLoad(options) {
    const code = options.code
    const type = SBTI_TYPES.find(t => t.code === code)
    if (!type) {
      wx.navigateBack()
      return
    }

    const group = TYPE_GROUPS[type.group] || {}
    const patternItems = Object.entries(type.pattern).map(([key, level]) => {
      let label, cls
      if (level === 'L') { label = '低'; cls = 'low' }
      else if (level === 'M') { label = '中'; cls = 'mid' }
      else { label = '高'; cls = 'high' }
      return { name: DIMENSION_LABELS[key] || key, level: label, cls }
    })

    this.setData({
      type,
      groupName: group.name || '',
      groupDesc: group.desc || '',
      patternItems
    })

    wx.setNavigationBarTitle({ title: `${type.emoji} ${type.name}` })
  },

  onShareAppMessage() {
    const t = this.data.type
    return {
      title: `${t.emoji} ${t.code} — ${t.name}：${t.tagline}`,
      path: '/pages/index/index'
    }
  },

  startQuiz() {
    wx.navigateTo({ url: '/pages/quiz/quiz' })
  }
})
