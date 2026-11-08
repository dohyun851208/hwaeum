const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

function load(initial, unavailable) {
  const saved = new Map([['hwaeum.language', initial]])
  const context = vm.createContext({})
  context.window = context
  context.localStorage = { getItem: key => { if (unavailable) throw Error('blocked'); return saved.get(key) } }
  for (const name of ['locale-pt-BR.js', 'i18n.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), context)
  return context.HwaeumI18n
}
test('Portuguese UI labels, timing and counts leave unknown content intact', () => {
  const i18n = load('pt-BR')
  assert.equal(i18n.t('산들바람'), 'Brisa suave')
  assert.equal(i18n.t('2.5초'), '2.5 s')
  assert.equal(i18n.t('3개 선'), '3 traços')
  assert.equal(i18n.t('배경음악 없음 · 플루트'), 'Sem música de fundo · Flauta')
  assert.equal(i18n.t('내가 지은 제목'), '내가 지은 제목')
})
test('Korean remains the default when storage is unavailable or invalid', () => {
  for (const i18n of [load('bad'), load('pt-BR', true)]) {
    assert.equal(i18n.getLanguage(), 'ko')
    assert.equal(i18n.t('산들바람'), '산들바람')
  }
})

test('switching languages preserves whitespace and all static step labels', async () => {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<body>\n  <button><span>1</span> <strong data-i18n="그림 선택하기">그림 선택하기</strong></button>\n  <p translate="no">숲</p>\n</body>', { url: 'https://example.test', runScripts: 'outside-only' })
  const { window } = dom
  try {
    window.localStorage.setItem('hwaeum.language', 'pt-BR')
    for (const name of ['locale-pt-BR.js', 'i18n.js']) window.eval(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'))
    await new Promise(resolve => setImmediate(resolve))
    const whitespace = window.document.body.firstChild.nodeValue
    assert.equal(whitespace, '\n  ')
    assert.equal(window.document.querySelector('strong').textContent, 'Escolher imagem')
    window.HwaeumI18n.setLanguage('ko')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(window.document.body.firstChild.nodeValue, whitespace)
    assert.equal(window.document.querySelector('strong').textContent, '그림 선택하기')
    assert.equal(window.document.querySelector('p').textContent, '숲')
    assert.equal(window.document.body.textContent, '\n  1 그림 선택하기\n  숲\n')
  } finally { window.close() }
})
