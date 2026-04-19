const { DIMENSION_KEYS } = require('../../utils/types')
const { QUESTIONS } = require('../../utils/questions')
const { calculateResult } = require('../../utils/quiz')

Page({
  data: {
    currentQuestion: 0,
    totalQuestions: QUESTIONS.length,
    question: null,
    progress: 0,
    letters: ['A', 'B', 'C', 'D'],
    selectedIndex: -1,
    animating: false
  },

  dimensionScores: {},

  onLoad() {
    this.dimensionScores = {}
    DIMENSION_KEYS.forEach(k => { this.dimensionScores[k] = 0 })
    this.showQuestion(0)
  },

  showQuestion(index) {
    const q = QUESTIONS[index]
    this.setData({
      currentQuestion: index,
      question: q,
      progress: ((index + 1) / QUESTIONS.length) * 100,
      selectedIndex: -1,
      animating: false
    })
  },

  selectOption(e) {
    if (this.data.animating) return
    const { index, score } = e.currentTarget.dataset
    const q = QUESTIONS[this.data.currentQuestion]

    this.dimensionScores[q.dimension] = (this.dimensionScores[q.dimension] || 0) + score

    this.setData({ selectedIndex: index, animating: true })

    setTimeout(() => {
      const next = this.data.currentQuestion + 1
      if (next < QUESTIONS.length) {
        this.showQuestion(next)
      } else {
        this.showResult()
      }
    }, 400)
  },

  showResult() {
    const result = calculateResult(this.dimensionScores)
    const app = getApp()
    app.globalData.resultType = result.type
    app.globalData.resultLevels = result.levels
    app.globalData.dimensionScores = this.dimensionScores
    wx.redirectTo({ url: '/pages/result/result' })
  },

  goBack() {
    wx.navigateBack()
  }
})
