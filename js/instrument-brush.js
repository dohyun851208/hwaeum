/*
 * instrument-brush.js — 선율 붓의 악기 그림과 붓끝 표현 (window.InstrumentBrush)
 *
 * - 2단계 악기 카드와 같은 생김새로 13개 악기를 작은 벡터 그림으로 그린다.
 * - 그리는 동안의 연주 몸짓(활 긋기·숨결·줄 떨림·나팔 울림)은 SVG 안의 ib-* 클래스로 표시하고,
 *   움직임은 styles.css가 맡는다.
 * - 붓끝 효과(TRAITS)는 악기가 소리를 내는 방식과 소리의 성격을 모양·움직임으로 옮긴다.
 * - 장식 전용이다. 도화지·레시피·내보내기에는 들어가지 않는다.
 */
;(function (root) {
  "use strict"

  // === § 1  SVG 조각 도우미 ===

  function n(v) {
    return Math.round(v * 100) / 100
  }

  function stops(list) {
    return list.map(function (s) {
      return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : "") + "/>"
    }).join("")
  }

  // 관·대나무·목은 왼쪽 위에서 빛이 드는 가로 그러데이션으로 둥글게 보인다. (x1, y1)을 주면 그 점에서 시작한다.
  function linear(id, list, x2, y2, x1, y1) {
    return '<linearGradient id="' + id + '" x1="' + (x1 || 0) + '" y1="' + (y1 || 0) + '" x2="' + (x2 == null ? 1 : x2) + '" y2="' + (y2 || 0) + '">' + stops(list) + "</linearGradient>"
  }

  // 반시계로 돌려 드는 관악기(연주자가 붓 쪽, 소리가 앞쪽)는 그림의 오른쪽 면이 위를 향한다.
  // 그래서 그러데이션을 좌우로 뒤집어 빛을 오른쪽에서 비추면, 돌린 뒤에도 빛이 위에서 내려온다.
  function mirrored(list) {
    return list.map(function (s) {
      return [n(1 - s[0]), s[1], s[2]]
    }).reverse()
  }

  function radial(id, list, cx, cy, r) {
    return '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' + stops(list) + "</radialGradient>"
  }

  function svg(defs, body) {
    return '<svg viewBox="0 0 48 88" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
      + (defs ? "<defs>" + defs + "</defs>" : "") + body + "</svg>"
  }

  const EBONY = [[0, "#0e0c0b"], [0.42, "#3d3733"], [1, "#0f0d0c"]]
  const SILVER = [[0, "#74818a"], [0.32, "#f8fbfb"], [0.62, "#c2ccd0"], [1, "#69767c"]]
  const BRASS = [[0, "#86590f"], [0.32, "#fadf8f"], [0.62, "#d8a03a"], [1, "#78500e"]]
  const BLACKWOOD = [[0, "#09090a"], [0.3, "#585b5d"], [0.56, "#1c1e1f"], [1, "#080809"]]
  const CUP = [[0, "#ffffff"], [0.55, "#d9e1e3"], [1, "#8d999e"]]
  // 가는 막대·고리는 단색으로 그린다(폭이 0인 선에는 그러데이션이 칠해지지 않는다).
  const METAL = "#cdd5d8"

  // 숨결 세 가닥 — 그리는 동안만 보인다. 취구·리드의 오른쪽(돌려 들면 바깥쪽)으로 흩어져,
  // 방금 그린 선이 아니라 앞으로 그릴 쪽을 향한다.
  function breath(x, y) {
    let out = ""
    for (let i = 0; i < 3; i++) {
      const dy = (i - 1) * 2.2
      out += '<path class="ib-play ib-puff" style="--puff-x:' + n(6 + i) + "px;--puff-y:" + n(dy - 1.5) + "px;animation-delay:" + n(-i * 0.3) + 's"'
        + ' d="M ' + n(x) + " " + n(y + dy) + ' q 1.6 -1.3 3.2 -.2 t 3 .1" fill="none" stroke="#8fb3bd" stroke-width=".8" stroke-linecap="round"/>'
    }
    return out
  }

  // 은빛 키 덮개. open이면 가운데 음공이 뚫린 키(플루트 오픈 키). lightRight면 반사광을 오른쪽 위에 둔다(가로로 눕힐 때).
  function keyCup(x, y, r, fill, open, lightRight) {
    const s = lightRight ? -1 : 1
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" stroke="#68757a" stroke-width=".3"/>'
      + (open ? '<circle cx="' + x + '" cy="' + y + '" r="' + n(r * 0.34) + '" fill="#2b3134"/>' : "")
      + '<path d="M ' + n(x - s * r * 0.62) + " " + n(y - r * 0.3) + " A " + n(r * 0.7) + " " + n(r * 0.7) + " 0 0 " + (lightRight ? 0 : 1) + " " + n(x + s * r * 0.25) + " " + n(y - r * 0.66)
      + '" fill="none" stroke="#fff" stroke-width=".35" opacity=".85"/>'
  }

  // 클라리넷 고리 키: 은 고리 안에 어두운 음공
  function ringKey(x, y) {
    return '<circle cx="' + x + '" cy="' + y + '" r=".8" fill="#0b0b0c"/>'
      + '<circle cx="' + x + '" cy="' + y + '" r="1.45" fill="none" stroke="' + METAL + '" stroke-width=".55"/>'
  }

  // 대나무 마디: 밝은 턱과 그 아래 그림자
  function bambooNode(x1, x2, y, light) {
    return '<path d="M ' + x1 + " " + y + " H " + x2 + '" stroke="' + light + '" stroke-width=".5" opacity=".9"/>'
      + '<path d="M ' + x1 + " " + n(y + 0.6) + " H " + x2 + '" stroke="#000" stroke-width=".45" opacity=".28"/>'
  }

  // 실을 촘촘히 감은 띠(소금의 감기·대금의 동여맴)
  function threadBand(x, y, w, h, color, line) {
    let out = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx=".3" fill="' + color + '"/>'
    for (let yy = y + 0.6; yy < y + h - 0.2; yy += 0.7) {
      out += '<path d="M ' + x + " " + n(yy) + " H " + n(x + w) + '" stroke="' + line + '" stroke-width=".2"/>'
    }
    return out
  }

  // 대나무 관에 뚫린 손가락 구멍
  function fingerHole(y, rx, ry, rim) {
    return '<ellipse cx="24" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="#2a1a0b" stroke="' + rim + '" stroke-width=".28"/>'
  }

  // === § 2  악기 그림 ===

  // --- 서양 현악기: 크기 순서(바이올린 < 비올라 < 첼로 < 더블베이스)를 비율로 보여 준다 ---
  const VIOLIN_BODY = "M 24 28 C 31 28 37.5 31 37.5 37.5 C 37.5 41.5 35.5 43.5 35.8 45.5 C 32.5 46.2 31.2 48.5 31.3 51.5 C 31.4 54.5 32.6 56.8 36.3 57.5 C 39.4 59.6 40.5 63.5 40.5 68 C 40.5 77.5 33 83 24 83 C 15 83 7.5 77.5 7.5 68 C 7.5 63.5 8.6 59.6 11.7 57.5 C 15.4 56.8 16.6 54.5 16.7 51.5 C 16.8 48.5 15.5 46.2 12.2 45.5 C 12.5 43.5 10.5 41.5 10.5 37.5 C 10.5 31 17 28 24 28 Z"
  // 더블베이스는 어깨가 목 쪽으로 비스듬히 처진다.
  const BASS_BODY = "M 24 25 C 27.5 25 31 32 34.8 36.2 C 38.2 39.8 38.2 44 36.2 47.5 C 33 48.3 31.5 50.2 31.6 53 C 31.7 56 33.5 58.2 37.2 59 C 40.6 61.4 41.8 66 41.8 71 C 41.8 80.5 33.5 86 24 86 C 14.5 86 6.2 80.5 6.2 71 C 6.2 66 7.4 61.4 10.8 59 C 14.5 58.2 16.3 56 16.4 53 C 16.5 50.2 15 48.3 11.8 47.5 C 9.8 44 9.8 39.8 13.2 36.2 C 17 32 20.5 25 24 25 Z"

  const VIOLIN_GEOM = {
    body: VIOLIN_BODY,
    nutY: 15.7,
    fingerboard: "M 22.3 15.6 L 25.7 15.6 L 26.9 51 Q 24 52 21.1 51 Z",
    fHoles: "M 18.9 48.6 C 16.4 51.6 19.9 58.2 16.9 62.4 M 29.1 48.6 C 31.6 51.6 28.1 58.2 31.1 62.4",
    eyes: [[19.1, 48.4], [16.7, 62.6], [28.9, 48.4], [31.3, 62.6]],
    bridge: "M 19.6 58.4 Q 24 55.8 28.4 58.4 L 28 59.6 L 26 59.6 Q 24 58.7 22 59.6 L 20 59.6 Z",
    tailpiece: "M 20.9 64.5 Q 24 63 27.1 64.5 L 25.9 78.2 Q 24 79.2 22.1 78.2 Z",
    tailTop: 63.9,
    tailBottom: 78.8,
    bowY: 53.8,
    sheen: [[16.5, 40, -18], [14.8, 68, -8]],
    endpin: '<path d="M 22.6 82.7 H 25.4 L 25 85.2 H 23 Z" fill="#1d1916"/>',
    spike: "M 23.5 85.2 L 24.5 85.2 L 24 92.5 Z",
    spikeTip: 92.5,
  }

  const BASS_GEOM = {
    body: BASS_BODY,
    nutY: 16.1,
    fingerboard: "M 22.2 16 L 25.8 16 L 27 52 Q 24 53 21 52 Z",
    fHoles: "M 18.4 49.5 C 15.4 53.5 19.8 60.5 16.4 65.5 M 29.6 49.5 C 32.6 53.5 28.2 60.5 31.6 65.5",
    eyes: [[18.6, 49.3], [16.2, 65.7], [29.4, 49.3], [31.8, 65.7]],
    bridge: "M 19.2 61.4 Q 24 58.4 28.8 61.4 L 28.4 62.8 L 26.2 62.8 Q 24 61.7 21.8 62.8 L 19.6 62.8 Z",
    tailpiece: "M 20.8 67 Q 24 65.4 27.2 67 L 25.9 80.6 Q 24 81.6 22.1 80.6 Z",
    tailTop: 66.4,
    tailBottom: 81.2,
    bowY: 55.6,
    sheen: [[16, 41, -24], [14.2, 72, -8]],
    endpin: '<path d="M 22.6 85.7 H 25.4 L 25 88 H 23 Z" fill="#1d1916"/>',
    spike: "M 23.5 88 L 24.5 88 L 24 93.4 Z",
    spikeTip: 93.4,
  }

  const BOWED = {
    violin: { light: "#f7b65c", mid: "#d67d26", dark: "#8c4211", line: "#6a300c", scale: 0.78, chinrest: true, tuners: true },
    viola: { light: "#de7a4a", mid: "#a5401b", dark: "#5c1e0a", line: "#4c1807", scale: 0.86, chinrest: true },
    cello: { light: "#eda753", mid: "#b8682a", dark: "#723611", line: "#5a290b", scale: 0.9, endpin: true },
    doubleBass: { light: "#cf8a4a", mid: "#8c4b1f", dark: "#48220b", line: "#3a1b08", scale: 0.94, endpin: true, bass: true },
  }

  // 서양 활: 붓을 대는 동안 나타나 줄 위를 오간다.
  function westernBow(y) {
    return '<g transform="rotate(-11 24 ' + y + ')"><g class="ib-play"><g class="ib-bow">'
      + '<path d="M 3.4 ' + n(y + 1) + ' H 44.4" stroke="#f6efdc" stroke-width=".9"/>'
      + '<path d="M 2.3 ' + n(y - 0.6) + " Q 24 " + n(y - 2) + " 45.4 " + n(y - 0.8) + '" fill="none" stroke="#6b3518" stroke-width="1.1" stroke-linecap="round"/>'
      + '<path d="M 1.6 ' + n(y - 1.2) + " L 3.5 " + n(y - 1.1) + " L 3.4 " + n(y + 1.4) + ' Z" fill="#f2ead8" stroke="#8a6a44" stroke-width=".2"/>'
      + '<rect x="40.4" y="' + n(y - 1.2) + '" width="4.5" height="2.9" rx=".6" fill="#1a1613"/>'
      + '<circle cx="42.6" cy="' + n(y + 0.25) + '" r=".62" fill="#e6eef1"/>'
      + '<path d="M 40.4 ' + n(y + 1.3) + ' H 44.9" stroke="' + METAL + '" stroke-width=".45"/>'
      + '<rect x="44.9" y="' + n(y - 1.4) + '" width="1.6" height="1.5" rx=".35" fill="' + METAL + '"/>'
      + "</g></g></g>"
  }

  function pegs(ebony) {
    return [[8.8, -1], [12.8, -1], [10.6, 1], [14.4, 1]].map(function (pg) {
      const y = pg[0]
      const side = pg[1]
      const edge = side < 0 ? 22.25 : 25.75
      const head = side < 0 ? 18.6 : 29.4
      return '<path d="M ' + edge + " " + y + " H " + n(head - side * 1.2) + '" stroke="#1e1a17" stroke-width=".9"/>'
        + '<ellipse cx="' + head + '" cy="' + y + '" rx="1.6" ry="1.15" fill="' + ebony + '"/>'
        + '<circle cx="' + head + '" cy="' + y + '" r=".33" fill="#efe3c6"/>'
    }).join("")
  }

  // 더블베이스는 나무 줄감개 대신 금속 톱니 줄감개를 쓴다.
  function machineHeads(brass) {
    return '<rect x="20.3" y="6.9" width="1.9" height="8.6" rx=".4" fill="' + brass + '"/>'
      + '<rect x="25.8" y="6.9" width="1.9" height="8.6" rx=".4" fill="' + brass + '"/>'
      + [9, 13.3].map(function (y) {
        return '<path d="M 20.3 ' + y + " H 18.6 M 27.7 " + y + ' H 29.4" stroke="#b58a2c" stroke-width=".7"/>'
          + '<ellipse cx="17.9" cy="' + y + '" rx="1.25" ry="1.05" fill="#e2bd5e" stroke="#8a6418" stroke-width=".25"/>'
          + '<ellipse cx="30.1" cy="' + y + '" rx="1.25" ry="1.05" fill="#e2bd5e" stroke="#8a6418" stroke-width=".25"/>'
          + '<circle cx="21.25" cy="' + y + '" r=".62" fill="#f5da8c" stroke="#8a6418" stroke-width=".2"/>'
          + '<circle cx="26.75" cy="' + y + '" r=".62" fill="#f5da8c" stroke="#8a6418" stroke-width=".2"/>'
      }).join("")
  }

  function bowedWestern(id) {
    const w = BOWED[id]
    const G = w.bass ? BASS_GEOM : VIOLIN_GEOM
    const p = "ib-" + id
    const wood = "url(#" + p + "-wood)"
    const ebony = "url(#" + p + "-ebony)"
    const defs = radial(p + "-wood", [[0, w.light], [0.58, w.mid], [1, w.dark]], 0.4, 0.3, 0.8)
      + linear(p + "-ebony", EBONY)
      + linear(p + "-metal", SILVER)
      + (w.bass ? linear(p + "-brass", BRASS) : "")
    const lowest = w.endpin ? G.spikeTip : 84.4
    let b = '<g transform="translate(24 87.4) scale(' + w.scale + ") translate(-24 -" + lowest + ')">'
    // 니스 칠한 앞판, 가장자리 장식선(퍼플링), 윤기
    b += '<path d="' + G.body + '" fill="' + wood + '" stroke="' + w.line + '" stroke-width=".7"/>'
    b += '<path d="' + G.body + '" transform="translate(24 55.5) scale(.91) translate(-24 -55.5)" fill="none" stroke="' + w.line + '" stroke-width=".55" opacity=".6"/>'
    b += G.sheen.map(function (s) {
      return '<ellipse cx="' + s[0] + '" cy="' + s[1] + '" rx="3.1" ry="6.8" transform="rotate(' + s[2] + " " + s[0] + " " + s[1] + ')" fill="#fff" opacity=".17"/>'
    }).join("")
    // f자 울림구멍
    b += '<path d="' + G.fHoles + '" fill="none" stroke="#260f04" stroke-width="1" stroke-linecap="round"/>'
    b += G.eyes.map(function (e) {
      return '<circle cx="' + e[0] + '" cy="' + e[1] + '" r=".8" fill="#260f04"/>'
    }).join("")
    // 흑단 지판과 줄받침
    b += '<path d="' + G.fingerboard + '" fill="' + ebony + '"/>'
    b += '<path d="M 22.15 ' + G.nutY + ' H 25.85" stroke="#efe3c6" stroke-width=".8"/>'
    // 줄감개 통과 소용돌이 머리
    b += '<path d="M 22.2 6.6 L 25.8 6.6 L 25.6 ' + G.nutY + " L 22.4 " + G.nutY + ' Z" fill="' + wood + '" stroke="' + w.line + '" stroke-width=".45"/>'
    b += '<path d="M 23.05 8 L 24.95 8 L 24.8 ' + n(G.nutY - 0.9) + " L 23.2 " + n(G.nutY - 0.9) + ' Z" fill="#2a1408"/>'
    b += '<circle cx="24.3" cy="4.3" r="2.75" fill="' + wood + '" stroke="' + w.line + '" stroke-width=".45"/>'
    b += '<path d="M 25.15 4.3 A .85 .85 0 1 1 24.3 3.45 A 1.75 1.75 0 1 1 22.6 5" fill="none" stroke="' + w.line + '" stroke-width=".45"/>'
    b += w.bass ? machineHeads("url(#" + p + "-brass)") : pegs(ebony)
    // 브리지·꼬리판(바이올린은 미세 조율기)·꼬리줄
    b += '<path d="' + G.bridge + '" fill="#f2d9a6" stroke="#b08550" stroke-width=".3"/>'
    b += '<path d="' + G.tailpiece + '" fill="' + ebony + '"/>'
    if (w.tuners) {
      b += [22.15, 23.38, 24.62, 25.85].map(function (x) {
        return '<circle cx="' + x + '" cy="' + n(G.tailTop + 1.3) + '" r=".42" fill="#e3c16c"/>'
      }).join("")
    }
    b += '<path d="M 24 ' + G.tailBottom + " V " + n(G.tailBottom + 2.8) + '" stroke="#2a2420" stroke-width=".8"/>'
    // 바이올린·비올라는 턱받침을 댄다.
    if (w.chinrest) {
      b += '<path d="M 13.4 75.6 C 13.5 72 17.4 71.5 19.8 73 C 21.2 74.1 21 77.2 19.5 78.4 C 17.3 80 13.3 79.2 13.4 75.6 Z" fill="' + ebony + '"/>'
      b += '<path d="M 14.9 75.3 C 15.4 73.4 17.7 73.2 18.9 74.1" fill="none" stroke="#fff" stroke-width=".5" opacity=".28"/>'
    }
    // 네 줄
    const nut = w.bass ? [22.75, 23.58, 24.42, 25.25] : [22.85, 23.62, 24.38, 25.15]
    const tail = [22.15, 23.38, 24.62, 25.85]
    b += '<path d="' + nut.map(function (x, i) {
      return "M " + x + " " + G.nutY + " L " + tail[i] + " " + G.tailTop
    }).join(" ") + '" stroke="#f6eed8" stroke-width="' + (w.bass ? ".42" : ".32") + '"/>'
    // 첼로·더블베이스는 바닥을 짚는 엔드핀, 작은 악기는 끝단추
    b += w.endpin
      ? G.endpin + '<path d="' + G.spike + '" fill="url(#' + p + '-metal)" stroke="#5f6b70" stroke-width=".2"/>'
      : '<circle cx="24" cy="83.4" r=".95" fill="#1e1a17"/>'
    b += westernBow(G.bowY)
    b += "</g>"
    return svg(defs, b)
  }

  // --- 서양 관악기 ---

  function flute() {
    const p = "ib-flute"
    const tube = "url(#" + p + "-tube)"
    const cup = "url(#" + p + "-cup)"
    const defs = linear(p + "-tube", mirrored(SILVER)) + radial(p + "-cup", CUP, 0.62, 0.32, 0.75)
    let b = ""
    // 은관과 머리 마개, 이음새 고리
    b += '<rect x="21.7" y="4.4" width="4.6" height="81.9" rx="1.2" fill="' + tube + '" stroke="#68757b" stroke-width=".35"/>'
    b += '<path d="M 21.85 4.8 Q 22 1.4 24 1.4 Q 26 1.4 26.15 4.8 Z" fill="' + tube + '" stroke="#68757b" stroke-width=".35"/>'
    b += '<path d="M 21.7 6.3 H 26.3 M 21.7 23.7 H 26.3 M 21.7 25.5 H 26.3 M 21.7 69.7 H 26.3 M 21.7 71.5 H 26.3 M 21.7 85.6 H 26.3" stroke="#7b878c" stroke-width=".5"/>'
    // 입술판과 취구
    b += '<path d="M 20.5 13.3 C 20.5 10.8 21.8 9.9 24 9.9 C 26.2 9.9 27.5 10.8 27.5 13.3 C 27.5 15.8 26.2 16.8 24 16.8 C 21.8 16.8 20.5 15.8 20.5 13.3 Z" fill="' + tube + '" stroke="#68757b" stroke-width=".4"/>'
    b += '<ellipse cx="24" cy="13.35" rx="1.1" ry="1.6" fill="#202527"/>'
    // 왼쪽 키 축
    b += '<path d="M 21 28.6 V 67" stroke="#a7b2b6" stroke-width=".65"/>'
    b += [28.6, 47.8, 67].map(function (y) {
      return '<circle cx="21" cy="' + y + '" r=".6" fill="#e5ebec" stroke="#7b878c" stroke-width=".2"/>'
    }).join("")
    // 가운데가 뚫린 오픈 키와 트릴 키
    b += [31, 35.6, 40.2, 44.8, 49.4, 54, 58.6, 63.2].map(function (y, i) {
      return keyCup(24, y, 1.85, cup, i % 4 !== 3, true)
    }).join("")
    b += '<ellipse cx="26.9" cy="38" rx=".9" ry=".72" fill="' + cup + '" stroke="#68757a" stroke-width=".25"/>'
    b += '<ellipse cx="26.9" cy="51.8" rx=".9" ry=".72" fill="' + cup + '" stroke="#68757a" stroke-width=".25"/>'
    // 발관 키와 롤러
    b += [74.8, 78.8, 82.6].map(function (y) {
      return keyCup(23.6, y, 1.6, cup, false, true)
    }).join("")
    b += '<rect x="25.3" y="76.2" width="2.8" height="1.05" rx=".5" fill="#e9eff0" stroke="#7b878c" stroke-width=".2"/>'
    b += '<rect x="25.3" y="80.3" width="2.8" height="1.05" rx=".5" fill="#e9eff0" stroke="#7b878c" stroke-width=".2"/>'
    b += breath(28.1, 12.6)
    return svg(defs, b)
  }

  function oboe() {
    const p = "ib-oboe"
    const wood = "url(#" + p + "-wood)"
    const metal = "url(#" + p + "-metal)"
    const cup = "url(#" + p + "-cup)"
    const defs = linear(p + "-wood", mirrored(BLACKWOOD)) + linear(p + "-metal", mirrored(SILVER)) + radial(p + "-cup", CUP, 0.62, 0.32, 0.75)
    let b = ""
    // 겹리드: 갈대 날(그리는 동안 떤다), 붉은 실, 코르크
    b += '<g class="ib-reed"><path d="M 23.15 .7 L 24.85 .7 L 24.6 4.7 L 23.4 4.7 Z" fill="#e6b468" stroke="#a7783a" stroke-width=".22"/>'
      + '<path d="M 23.2 .85 H 24.8" stroke="#8a5a26" stroke-width=".4"/></g>'
    b += threadBand(23.15, 4.6, 1.7, 2.7, "#b4402b", "#7b2416")
    b += '<rect x="23.25" y="7.2" width="1.5" height="2.1" fill="#d2ab7a"/>'
    // 점점 넓어지는 원뿔꼴 몸통과 작은 나팔
    b += '<path d="M 22.45 9.6 L 25.55 9.6 L 26.1 44.2 L 21.9 44.2 Z" fill="' + wood + '"/>'
    b += '<path d="M 21.85 45.6 L 26.15 45.6 L 26.55 70.6 L 21.45 70.6 Z" fill="' + wood + '"/>'
    b += '<path d="M 21.5 72 C 21.25 78 20.2 82.4 18.1 85.7 L 29.9 85.7 C 27.8 82.4 26.75 78 26.5 72 Z" fill="' + wood + '"/>'
    b += '<rect x="22.1" y="9.2" width="3.8" height="1.3" rx=".35" fill="' + metal + '"/>'
    b += '<rect x="21.6" y="44" width="4.8" height="1.6" rx=".35" fill="' + metal + '"/>'
    b += '<rect x="21.2" y="70.4" width="5.6" height="1.6" rx=".35" fill="' + metal + '"/>'
    b += '<path d="M 17.9 85.8 H 30.1" stroke="' + METAL + '" stroke-width="1.1" stroke-linecap="round"/>'
    // 옥타브 키, 양옆 막대와 레버
    b += '<path d="M 22.5 11.4 C 21.1 12.4 20.9 15 21.5 16.8" fill="none" stroke="' + METAL + '" stroke-width=".5"/>'
    b += '<path d="M 21.75 18.5 V 42.6 M 21.45 48 V 68.4" stroke="' + METAL + '" stroke-width=".5"/>'
    b += '<path d="M 26.05 17.6 C 27.6 19.6 27.6 26.2 26.2 28.8 M 26.4 51.6 C 27.9 53.6 27.9 60.4 26.5 63" fill="none" stroke="' + METAL + '" stroke-width=".55"/>'
    // 위 세 음공은 고리, 나머지는 덮개(플래토) 키
    b += [15.6, 20, 24.4].map(function (y) {
      return '<circle cx="24" cy="' + y + '" r="1.05" fill="#141516" stroke="' + METAL + '" stroke-width=".45"/>'
    }).join("")
    b += [31.4, 35.8, 40.2, 50.6, 55, 59.4, 63.8].map(function (y) {
      return keyCup(24, y, 1.15, cup, false, true)
    }).join("")
    b += breath(25.4, 1.8)
    return svg(defs, b)
  }

  function clarinet() {
    const p = "ib-clarinet"
    const wood = "url(#" + p + "-wood)"
    const metal = "url(#" + p + "-metal)"
    const cup = "url(#" + p + "-cup)"
    const defs = linear(p + "-wood", mirrored(BLACKWOOD)) + linear(p + "-metal", mirrored(SILVER)) + radial(p + "-cup", CUP, 0.62, 0.32, 0.75)
    let b = ""
    // 마우스피스와 홑리드(그리는 동안 떤다), 은 리가처
    b += '<path d="M 22.55 1.1 Q 24 .2 25.45 1.1 L 26.35 8.9 L 21.65 8.9 Z" fill="' + wood + '"/>'
    b += '<g class="ib-reed"><path d="M 22.15 7.8 L 22.7 1.4" stroke="#e2bd79" stroke-width=".8" stroke-linecap="round"/></g>'
    b += '<rect x="21.5" y="5" width="5" height="2.3" rx=".4" fill="' + metal + '"/>'
    b += '<circle cx="21.25" cy="6.15" r=".5" fill="#e3e9ea" stroke="#7b878c" stroke-width=".2"/>'
    b += '<circle cx="26.75" cy="6.15" r=".5" fill="#e3e9ea" stroke="#7b878c" stroke-width=".2"/>'
    // 배럴, 곧은 몸통, 넓게 벌어지는 벨
    b += '<path d="M 21.45 8.9 Q 21 12.15 21.45 15.4 L 26.55 15.4 Q 27 12.15 26.55 8.9 Z" fill="' + wood + '"/>'
    b += '<rect x="21.55" y="15.4" width="4.9" height="29.1" fill="' + wood + '"/>'
    b += '<rect x="21.55" y="44.5" width="4.9" height="27" fill="' + wood + '"/>'
    b += '<path d="M 21.65 71.5 C 21.45 78.4 19.5 83 16.7 86 L 31.3 86 C 28.5 83 26.55 78.4 26.35 71.5 Z" fill="' + wood + '"/>'
    b += '<path d="M 18.6 85.3 Q 24 83.7 29.4 85.3" fill="none" stroke="#000" stroke-width=".6" opacity=".45"/>'
    b += '<path d="M 21.3 9 H 26.7 M 21.3 15.4 H 26.7 M 21.4 44.5 H 26.6 M 21.4 71.5 H 26.6" stroke="' + METAL + '" stroke-width=".9"/>'
    b += '<path d="M 16.4 86.15 H 31.6" stroke="' + METAL + '" stroke-width="1.15" stroke-linecap="round"/>'
    // 레지스터 키, 막대와 레버
    b += '<path d="M 22.3 17.4 C 21 18.4 20.9 21 21.5 22.6" fill="none" stroke="' + METAL + '" stroke-width=".45"/>'
    b += '<path d="M 21.5 24.2 V 41.4 M 21.5 48.6 V 66.6" stroke="' + METAL + '" stroke-width=".45"/>'
    b += '<path d="M 26.45 19.6 C 28.1 21.6 28.1 30 26.6 33.4 M 26.45 48 C 28.1 50 28.1 58.6 26.6 62" fill="none" stroke="' + METAL + '" stroke-width=".55"/>'
    // 고리 키(링 키)와 덮개 키
    b += [23.2, 27.8, 32.4, 51.2, 55.8, 60.4].map(function (y) {
      return ringKey(24, y)
    }).join("")
    b += [19.4, 37.2, 65.8].map(function (y) {
      return keyCup(24, y, 0.95, cup, false, true)
    }).join("")
    b += '<ellipse cx="26.75" cy="35.6" rx=".8" ry=".65" fill="' + cup + '"/>'
    b += '<ellipse cx="26.75" cy="64" rx=".8" ry=".65" fill="' + cup + '"/>'
    b += breath(26, 1.6)
    return svg(defs, b)
  }

  function frenchHorn() {
    const p = "ib-frenchHorn"
    const brass = "url(#" + p + "-brass)"
    const coil = "url(#" + p + "-coil)"
    // 나팔을 앞(오른쪽)으로 들기 위해 반시계로 돌리므로, 빛은 그림 오른쪽 위에서 비춘다.
    const defs = linear(p + "-brass", mirrored(BRASS))
      + linear(p + "-coil", [[0, "#fbe39b"], [0.45, "#d49b35"], [1, "#7a5110"]], 0, 1, 1, 0)
      + radial(p + "-valve", [[0, "#fff1bf"], [0.5, "#dcaa45"], [1, "#835a12"]], 0.65, 0.3, 0.8)
      + radial(p + "-throat", [[0, "#4a2f08"], [0.55, "#a77420"], [1, "#f4cf72"]], 0.5, 0.42, 0.62)
      + radial(p + "-glow", [[0, "#fff2b8", 0.95], [0.45, "#f6cf5c", 0.55], [1, "#f6cf5c", 0]], 0.5, 0.5, 0.5)
      + linear(p + "-metal", mirrored(SILVER))
    let b = ""
    // 앞(바깥쪽)으로 넓게 열리는 나팔(벨)
    b += '<path d="M 15.3 43.5 C 15.6 58 14.4 70 5.8 82.4 L 36.2 82.4 C 26 72.5 19.6 60 18.9 44.6 Z" fill="' + brass + '" stroke="#7a5210" stroke-width=".35"/>'
    b += '<path d="M 18 47.5 C 18.6 60 23.4 71.4 31.4 79.6" fill="none" stroke="#fff3c6" stroke-width=".85" opacity=".7"/>'
    b += '<ellipse cx="21" cy="82.5" rx="15.3" ry="3.9" fill="url(#' + p + '-throat)" stroke="#f8de90" stroke-width=".75"/>'
    // 둥글게 감긴 관
    b += '<circle cx="25" cy="31" r="14.2" fill="none" stroke="' + coil + '" stroke-width="3.3"/>'
    b += '<circle cx="25" cy="31" r="15.85" fill="none" stroke="#7a5210" stroke-width=".35"/>'
    b += '<circle cx="25" cy="31" r="12.55" fill="none" stroke="#7a5210" stroke-width=".3"/>'
    b += '<path d="M 36.6 23.2 A 14.2 14.2 0 0 0 28.2 17.2" fill="none" stroke="#fff3c6" stroke-width=".9" opacity=".85"/>'
    b += '<circle cx="24.4" cy="31.4" r="10.2" fill="none" stroke="' + coil + '" stroke-width="2"/>'
    // 밸브 슬라이드(U자 관), 로터리 밸브, 손가락 레버
    const valves = [26.5, 31, 35.5]
    b += valves.map(function (y) {
      return '<path d="M 25 ' + n(y - 1.3) + " H 19.2 Q 17.6 " + n(y - 1.3) + " 17.6 " + y + " Q 17.6 " + n(y + 1.3) + " 19.2 " + n(y + 1.3) + ' H 25" fill="none" stroke="' + brass + '" stroke-width="1.05"/>'
    }).join("")
    b += valves.map(function (y) {
      return '<circle cx="27.3" cy="' + y + '" r="2.15" fill="url(#' + p + '-valve)" stroke="#7a5210" stroke-width=".4"/>'
        + '<circle cx="27.3" cy="' + y + '" r=".95" fill="#fbe7a6" stroke="#a0761e" stroke-width=".25"/>'
        + '<path d="M 29.3 ' + y + " L 35.6 " + n(y - 1.6) + '" stroke="#c49434" stroke-width=".75"/>'
        + '<rect x="35" y="' + n(y - 2.5) + '" width="3.2" height="1.7" rx=".7" fill="#ecc96e" stroke="#8a6418" stroke-width=".25"/>'
    }).join("")
    // 리드파이프와 은 마우스피스
    b += '<path d="M 36.6 22.6 C 38.6 16.8 40 11 41 5.8" fill="none" stroke="' + brass + '" stroke-width="1.55" stroke-linecap="round"/>'
    b += '<path d="M 40.3 6.3 L 41.9 6.3 L 42.5 2.3 L 39.7 2.3 Z" fill="url(#' + p + '-metal)"/>'
    b += '<ellipse cx="41.1" cy="2.2" rx="1.7" ry=".62" fill="#eef3f4" stroke="#7b878c" stroke-width=".25"/>'
    // 그리는 동안 나팔에서 번지는 금빛
    b += '<ellipse class="ib-play ib-pulse" cx="21" cy="81.6" rx="17.5" ry="7" fill="url(#' + p + '-glow)"/>'
    return svg(defs, b)
  }

  // --- 국악 관악기: 대나무 ---

  function sogeum() {
    const p = "ib-sogeum"
    const bamboo = "url(#" + p + "-bamboo)"
    const defs = linear(p + "-bamboo", mirrored([[0, "#8a6526"], [0.3, "#f7df9f"], [0.62, "#d8ae5e"], [1, "#82601f"]]))
    let b = ""
    // 짧고 가는 노란 대나무(높고 맑은 소리)
    b += '<rect x="21.9" y="19.6" width="4.2" height="66.6" rx="1.1" fill="' + bamboo + '" stroke="#7a5a22" stroke-width=".3"/>'
    b += '<ellipse cx="24" cy="19.85" rx="2.1" ry=".6" fill="#caa25a" stroke="#7a5a22" stroke-width=".25"/>'
    b += threadBand(21.8, 21.4, 4.4, 3, "#4a2f1b", "#80603f")
    b += threadBand(21.8, 79.8, 4.4, 2.8, "#4a2f1b", "#80603f")
    b += '<ellipse cx="24" cy="29.2" rx="1.2" ry="1.55" fill="#3a2410" stroke="#f6dc98" stroke-width=".3"/>'
    b += bambooNode(21.9, 26.1, 40, "#fbe6b0") + bambooNode(21.9, 26.1, 60.4, "#fbe6b0")
    b += [44.8, 49.9, 55, 65.2, 70.3, 75.4].map(function (y) {
      return fingerHole(y, 0.95, 1.05, "#f1d48e")
    }).join("")
    b += '<ellipse cx="24" cy="86.15" rx="2.1" ry=".6" fill="#5a3c18"/>'
    b += breath(26.6, 28.8)
    return svg(defs, b)
  }

  function daegeum() {
    const p = "ib-daegeum"
    const bamboo = "url(#" + p + "-bamboo)"
    const defs = linear(p + "-bamboo", mirrored([[0, "#5d5826"], [0.3, "#dbd391"], [0.62, "#aaa35a"], [1, "#54501e"]]))
      + linear(p + "-brass", mirrored(BRASS))
      + linear(p + "-skin", [[0, "#f7f1da"], [0.5, "#e9dfbf"], [1, "#d5c79c"]])
    let b = ""
    // 길고 굵은 쌍골죽 몸통
    b += '<rect x="21.4" y="2" width="5.2" height="84.4" rx="1.3" fill="' + bamboo + '" stroke="#4c4818" stroke-width=".3"/>'
    b += '<rect x="21.2" y="1.6" width="5.6" height="2.1" rx=".8" fill="#6d3a1f"/>'
    b += [5.4, 6.6, 26.8, 34.8, 47.6, 59.6, 82.2, 83.4].map(function (y) {
      return '<rect x="21.25" y="' + n(y - 0.4) + '" width="5.5" height=".8" rx=".3" fill="#8a4826"/>'
    }).join("")
    // 취구
    b += '<ellipse cx="24" cy="11.2" rx="1.35" ry="1.75" fill="#2a2810" stroke="#e8e0a6" stroke-width=".3"/>'
    // 청공: 갈대 속청을 붙인 창 — 그리는 동안 청이 떨린다
    b += '<rect x="21.8" y="17.3" width="4.4" height="7.2" rx="1" fill="#c99f4c" stroke="#7a5a22" stroke-width=".35"/>'
    b += '<g class="ib-shimmer"><rect x="22.55" y="18.1" width="2.9" height="5.6" rx=".5" fill="url(#' + p + '-skin)"/>'
      + '<path d="M 22.6 19.3 H 25.4 M 22.6 20.4 H 25.4 M 22.6 21.5 H 25.4 M 22.6 22.6 H 25.4" stroke="#cbbb8a" stroke-width=".22"/></g>'
    // 무늬 새긴 놋쇠 띠
    b += '<rect x="21.2" y="28" width="5.6" height="5.6" rx=".5" fill="url(#' + p + '-brass)" stroke="#7a5a22" stroke-width=".3"/>'
    b += '<path d="M 21.8 30.8 q .7 -1.5 1.4 0 t 1.4 0 t 1.4 0" fill="none" stroke="#7a5212" stroke-width=".35"/>'
    // 지공 여섯과 칠성공
    b += [39, 44.2, 51.4, 56.6, 63.8, 69].map(function (y) {
      return fingerHole(y, 1.1, 1.15, "#e8e0a6")
    }).join("")
    b += '<circle cx="24" cy="75.8" r=".55" fill="#2a2810"/><circle cx="24" cy="78.2" r=".55" fill="#2a2810"/>'
    b += '<ellipse cx="24" cy="86.3" rx="2.6" ry=".7" fill="#3a3812"/>'
    b += breath(27.1, 10.6)
    return svg(defs, b)
  }

  function danso() {
    const p = "ib-danso"
    const bamboo = "url(#" + p + "-bamboo)"
    const defs = linear(p + "-bamboo", mirrored([[0, "#1d1109"], [0.3, "#77543c"], [0.6, "#3f2a1a"], [1, "#160c06"]]))
    let b = ""
    // 짧고 굵은 검은 대나무
    b += '<rect x="21" y="22.4" width="6" height="63.8" rx="1.2" fill="' + bamboo + '" stroke="#120a04" stroke-width=".3"/>'
    b += '<path d="M 22.4 25 V 84 M 25.9 25 V 84" stroke="#000" stroke-width=".25" opacity=".25"/>'
    // 위 끝에 U자로 판 취구
    b += '<ellipse cx="24" cy="22.5" rx="3" ry=".85" fill="#9a7550" stroke="#3a2416" stroke-width=".25"/>'
    b += '<ellipse cx="24" cy="22.55" rx="1.9" ry=".5" fill="#140b05"/>'
    b += '<path d="M 21.9 22.6 Q 24 31 26.1 22.6 Z" fill="#e9cc96" stroke="#6b4a2a" stroke-width=".3"/>'
    b += '<path d="M 22.7 23 Q 24 28.4 25.3 23" fill="none" stroke="#a37a4a" stroke-width=".35"/>'
    b += bambooNode(21, 27, 35.2, "#a07a55") + bambooNode(21, 27, 64.6, "#a07a55")
    // 앞 지공 넷
    b += [42.6, 49.6, 56.6, 72.4].map(function (y) {
      return fingerHole(y, 1.25, 1.3, "#a07a55")
    }).join("")
    b += '<ellipse cx="24" cy="86.2" rx="3" ry=".8" fill="#0f0804" stroke="#5a3a24" stroke-width=".3"/>'
    b += breath(26.6, 22.6)
    return svg(defs, b)
  }

  // --- 국악 현악기 ---

  function haegeum() {
    const p = "ib-haegeum"
    const wood = "url(#" + p + "-wood)"
    const woodV = "url(#" + p + "-woodv)"
    const defs = linear(p + "-wood", [[0, "#1f1108"], [0.35, "#70492c"], [0.66, "#3b2313"], [1, "#1a0e06"]])
      + linear(p + "-woodv", [[0, "#6d472b"], [0.5, "#3a2212"], [1, "#1a0e06"]], 0, 1)
      + radial(p + "-knob", [[0, "#94663f"], [0.6, "#40261a"], [1, "#180c05"]], 0.36, 0.3, 0.75)
      + radial(p + "-face", [[0, "#fbf1da"], [0.7, "#ead6ab"], [1, "#c8ac78"]], 0.42, 0.38, 0.7)
    let b = ""
    // 받침과 입죽(세로대) — 머리는 갈고리처럼 꺾인다
    b += '<path d="M 19.2 81 H 33.4 L 32.4 84.8 H 20.2 Z" fill="' + woodV + '"/>'
    b += '<path d="M 24.7 9 L 27.3 9 L 27.75 63.4 L 24.25 63.4 Z" fill="' + wood + '"/>'
    b += '<path d="M 27.3 9.6 C 27.3 4.4 26.3 1.5 24 1.4 C 21.8 1.3 21.2 3.2 22.5 4.2 C 23.6 5 24.7 6 24.7 9.6 Z" fill="' + wood + '"/>'
    b += '<path d="M 24.65 10.8 H 27.35 M 24.65 11.6 H 27.35 M 24.6 21.6 H 27.4 M 24.6 22.4 H 27.4" stroke="#d9b45c" stroke-width=".42"/>'
    // 주아(줄감개) 둘
    b += [15.6, 27].map(function (y) {
      return '<rect x="19.4" y="' + n(y - 0.75) + '" width="13.4" height="1.5" rx=".55" fill="' + woodV + '"/>'
        + '<rect x="32.4" y="' + n(y - 0.95) + '" width="1.5" height="1.9" rx=".45" fill="#1e1109"/>'
        + '<circle cx="18.6" cy="' + y + '" r="2.75" fill="url(#' + p + '-knob)" stroke="#170b04" stroke-width=".3"/>'
        + '<path d="M 21.5 ' + n(y - 1.35) + " V " + n(y + 1.35) + '" stroke="#d9b45c" stroke-width=".6"/>'
        + '<circle cx="18.6" cy="' + y + '" r=".7" fill="#d9b45c" opacity=".9"/>'
    }).join("")
    // 울림통(대나무 뿌리 통)과 오동나무 복판
    b += '<path d="M 22.6 62.6 H 31.2 C 35.5 62.6 35.5 81.6 31.2 81.6 H 22.6 Z" fill="' + wood + '" stroke="#120904" stroke-width=".4"/>'
    b += '<path d="M 28.5 63 C 30.6 66 30.6 78.2 28.5 81.2" fill="none" stroke="#000" stroke-width=".35" opacity=".35"/>'
    b += '<ellipse cx="22.6" cy="72.1" rx="8.1" ry="9.6" fill="url(#' + p + '-face)" stroke="#2a170b" stroke-width="1.1"/>'
    b += '<path d="M 18.2 65.4 Q 19.2 72 18.2 78.8 M 21.4 63.6 Q 22.4 72 21.4 80.6 M 25.2 63.8 Q 26.2 72 25.2 80.4" fill="none" stroke="#c8ad80" stroke-width=".3" opacity=".7"/>'
    // 원산(복판 위 받침), 두 줄(중현·유현), 산성(줄을 입죽에 당겨 묶는 고리)
    b += '<path d="M 24.3 72.8 Q 26 69.6 27.75 72.8 Z" fill="#f6e7c0" stroke="#9a7444" stroke-width=".3"/>'
    b += '<path d="M 25.45 15.6 V 80.4 M 26.6 27 V 80.4" stroke="#f3e8cc" stroke-width=".38"/>'
    b += '<path d="M 24.05 43.4 H 27.95 M 24.05 44.3 H 27.95" stroke="#caa25a" stroke-width=".75"/>'
    b += '<path d="M 25.2 80.3 H 26.85 L 26.45 82.5 H 25.6 Z" fill="#2a170b"/>'
    b += '<path d="M 26 82.5 C 25.2 84.3 26.9 85.4 26 87.4" fill="none" stroke="#8d2b2b" stroke-width=".9" stroke-linecap="round"/>'
    // 활: 두 줄 사이에 끼워져 늘 붙어 있고, 그리는 동안 좌우로 긋는다
    b += '<g transform="rotate(-6 24 58.8)"><g class="ib-bow">'
      + '<path d="M 4.2 60 H 43.6" stroke="#efe5ca" stroke-width=".85"/>'
      + '<path d="M 3.2 58.6 Q 24 56.8 45 58.4" fill="none" stroke="#5a3418" stroke-width="1.05" stroke-linecap="round"/>'
      + '<path d="M 36.6 57.9 H 41.2" stroke="#2f4b3c" stroke-width="1.7"/>'
      + '<path d="M 41.2 58.1 H 43" stroke="#a8743c" stroke-width="1.45"/>'
      + "</g></g>"
    return svg(defs, b)
  }

  function gayageum() {
    const p = "ib-gayageum"
    const defs = linear(p + "-wood", [[0, "#5a2810"], [0.16, "#a05c2e"], [0.45, "#b9753f"], [0.78, "#92532a"], [1, "#56260e"]])
      + linear(p + "-anjok", [[0, "#2c1508"], [0.5, "#74411f"], [1, "#2a1307"]])
    const xs = []
    for (let i = 0; i < 12; i++) xs.push(n(15 + (i * 18) / 11))
    let b = ""
    // 오동나무 몸통과 옆면, 나뭇결
    b += '<path d="M 35.4 6.4 Q 36.8 6.8 36.8 8.2 V 82.8 Q 36.8 85.8 34.4 86.3 L 31 86.4 L 35.4 82 Z" fill="#3c1b08"/>'
    b += '<path d="M 12.6 6.2 Q 12.6 1.8 17 1.8 H 31 Q 35.4 1.8 35.4 6.2 V 82 Q 35.4 86.4 31 86.4 H 17 Q 12.6 86.4 12.6 82 Z" fill="url(#' + p + '-wood)" stroke="#3a1a08" stroke-width=".55"/>'
    b += '<path d="M 16.6 12 C 17.6 30 15.8 52 17 80 M 21.8 10 C 20.8 34 22.8 56 21.4 80 M 30.6 11 C 31.6 30 29.6 58 31 82" fill="none" stroke="#4a210b" stroke-width=".35" opacity=".35"/>'
    // 머리 쪽 상감 테두리와 현침(줄을 받치는 턱)
    b += '<path d="M 14.3 7.6 Q 14.3 3.6 17.4 3.6 H 30.6 Q 33.7 3.6 33.7 7.6" fill="none" stroke="#f3e5c3" stroke-width=".45"/>'
    b += '<circle cx="24" cy="5" r=".7" fill="#f3e5c3"/>'
    b += '<rect x="13.6" y="8.1" width="20.8" height="1.6" rx=".5" fill="#efe1bf" stroke="#9c7a4e" stroke-width=".3"/>'
    // 안족(기러기발): 열두 줄을 하나씩 받치며 비스듬히 늘어선다
    b += xs.map(function (x, i) {
      const y = 21 + i * 3.6
      return '<path d="M ' + n(x - 1.2) + " " + n(y + 1.8) + " L " + n(x - 0.42) + " " + n(y - 1.9) + " H " + n(x + 0.42) + " L " + n(x + 1.2) + " " + n(y + 1.8)
        + ' Z" fill="url(#' + p + '-anjok)" stroke="#1b0c04" stroke-width=".2"/>'
    }).join("")
    // 명주실 열두 줄 — 뜯는 동안 떨린다
    b += '<g class="ib-shimmer"><path d="' + xs.map(function (x) {
      return "M " + x + " 9.4 V 75"
    }).join(" ") + '" stroke="#f7eed6" stroke-width=".32"/></g>'
    // 꼬리 쪽 꾸밈 턱, 부들, 술
    b += '<rect x="13.6" y="74.6" width="20.8" height="2.6" rx=".6" fill="#efe2c0" stroke="#9c7a4e" stroke-width=".3"/>'
    b += xs.map(function (x, i) {
      return '<circle cx="' + x + '" cy="75.9" r=".38" fill="' + (i % 2 ? "#3f7a4a" : "#b5482c") + '"/>'
    }).join("")
    b += '<path d="' + xs.map(function (x, i) {
      return "M " + x + " 77.2 L " + n(22.4 + i * 0.3) + " 80.8"
    }).join(" ") + '" stroke="#6e1f2a" stroke-width=".45"/>'
    b += '<path d="M 20.3 80.4 Q 24 78.3 27.7 80.4 Q 29.1 84.6 24 85.7 Q 18.9 84.6 20.3 80.4 Z" fill="#6a1d29"/>'
    b += '<path d="M 21.6 81 L 21 84.3 M 23 80.9 L 22.8 85.1 M 24.6 80.9 L 24.8 85.3 M 26.2 81 L 26.9 84.5" stroke="#93354a" stroke-width=".35"/>'
    return svg(defs, b)
  }

  // 악기를 알 수 없을 때 쓰는 기본 붓
  function plainBrush() {
    const p = "ib-brush"
    const defs = linear(p + "-wood", [[0, "#6b3d1d"], [0.35, "#c98a4f"], [1, "#5a3014"]]) + linear(p + "-metal", SILVER)
    return svg(defs, '<path d="M 22.6 2 Q 24 1 25.4 2 L 26.2 58 H 21.8 Z" fill="url(#' + p + '-wood)"/>'
      + '<rect x="21.4" y="58" width="5.2" height="9" rx=".8" fill="url(#' + p + '-metal)"/>'
      + '<path d="M 21.6 67 C 21 74 22.4 81 24 87 C 25.6 81 27 74 26.4 67 Z" fill="#3a2a1e"/>')
  }

  const DRAWERS = {
    violin: bowedWestern,
    viola: bowedWestern,
    cello: bowedWestern,
    doubleBass: bowedWestern,
    flute: flute,
    oboe: oboe,
    clarinet: clarinet,
    frenchHorn: frenchHorn,
    sogeum: sogeum,
    daegeum: daegeum,
    danso: danso,
    haegeum: haegeum,
    gayageum: gayageum,
  }
  const iconCache = {}

  function icon(id) {
    const key = DRAWERS[id] ? id : ""
    if (!iconCache[key]) iconCache[key] = key ? DRAWERS[key](key) : plainBrush()
    return iconCache[key]
  }

  // === § 3  연주 자세 ===
  // 붓끝(포인터)에서 악기 그림 중심까지의 거리 [x, y](px)와 기울기(도, 시계 방향). rest는 붓을 띄운 자세, play는 그리는 동안의 자세다.
  // 현악기·해금은 세워 든다. 관악기와 가야금은 실제로 연주할 때의 방향을 따르되,
  // 연주자는 붓 쪽(방금 그린 선 쪽)에 있고 소리는 앞으로 그릴 쪽(바깥쪽)을 향한다.
  // - 가로 피리(플루트·소금·대금)는 몸통이 연주자 오른쪽으로 뻗는 수평 자세다(대금도 취구 쪽 끝을 왼쪽 어깨에 얹고 오른쪽으로 수평).
  //   입 쪽 끝이 붓끝 위에 오고, 그 점을 축으로 들어 올린다.
  // - 리드 악기·단소는 마우스피스를 문 채 비스듬히 들어 나팔이 앞쪽 아래로 열리고, 호른도 마우스피스는 붓 쪽, 나팔은 앞쪽이다.
  //   두 자세 모두 입 쪽을 축으로 들어 올린다.
  // - 가야금은 무릎에 눕혀 뜯는다(머리 쪽 현침이 앞쪽).
  const POSES = {
    upright: { rest: [43.8, -36.4, 24], play: [37.8, -39.4, 15] },
    flute: { rest: [48.5, -13, -74], play: [49.9, -21.2, -86] },
    sogeum: { rest: [33, -19.1, -78], play: [33.5, -24, -90] },
    daegeum: { rest: [50.1, -15.5, -78], play: [51, -24, -90] },
    reed: { rest: [24.8, -35.4, -26], play: [33.6, -41.1, -40] },
    frenchHorn: { rest: [32.9, -15.3, -62], play: [42.2, -25.9, -80] },
    gayageum: { rest: [47.4, -23.3, 80], play: [47.9, -18.9, 86] },
  }
  const POSE_OF = { flute: "flute", sogeum: "sogeum", daegeum: "daegeum", oboe: "reed", clarinet: "reed", danso: "reed", frenchHorn: "frenchHorn", gayageum: "gayageum" }

  function pose(id) {
    return POSES[POSE_OF[id]] || POSES.upright
  }

  // 커서에 그대로 붙일 CSS 변수(styles.css의 .instrument-brush-icon이 읽는다)
  function poseStyle(id) {
    const p = pose(id)
    return {
      "--pose-x": p.rest[0] + "px",
      "--pose-y": p.rest[1] + "px",
      "--pose-angle": p.rest[2] + "deg",
      "--pose-play-x": p.play[0] + "px",
      "--pose-play-y": p.play[1] + "px",
      "--pose-play-angle": p.play[2] + "deg",
    }
  }

  // === § 4  붓끝 표현 ===
  // family: 소리 내는 방식 — bow(활로 긋는 현)·breath(입김으로 부는 관)·reed(리드를 떠는 관)·brass(입술을 떠는 금관)·pluck(손으로 뜯는 현)
  // spark: 소리 성격을 옮긴 붓끝 효과 모양(styles.css의 .instrument-brush-spark.is-*)
  // every: 효과 사이 최소 간격(ms) · size: 크기(px) · dx: 옆으로 흐르는 거리(px) · rise: 떠오르는 높이(px, 음수면 가라앉음)
  // rot: 회전(deg) · life: 수명(ms) · accent: 세 번에 한 번 섞는 빛깔(나머지는 악기 줄 색)
  const TRAITS = {
    // 선명하고 화려한 소리 → 금빛 별이 반짝이며 튀어 오른다
    violin: { family: "bow", spark: "star", every: 40, size: [9, 14], dx: [-18, 18], rise: [14, 38], rot: [40, 120], life: 750, accent: "#e0a81e" },
    // 차분하고 은은한 소리 → 부드러운 빛무리가 천천히 번진다
    viola: { family: "bow", spark: "glow", every: 70, size: [12, 19], dx: [-12, 12], rise: [6, 18], rot: [0, 0], life: 1000, accent: "#d9894a" },
    // 깊고 풍부한 소리 → 따뜻한 울림 고리가 부풀어 오른다
    cello: { family: "bow", spark: "ring", every: 90, size: [14, 22], dx: [-4, 4], rise: [-2, 6], rot: [0, 0], life: 1050, accent: "#cf7d2c" },
    // 낮고 묵직한 소리 → 납작한 물결이 아래로 가라앉으며 넓게 퍼진다
    doubleBass: { family: "bow", spark: "ripple", every: 120, size: [24, 34], dx: [-3, 3], rise: [-10, -4], rot: [0, 0], life: 1200, accent: "#8a6a45" },
    // 가볍고 투명한 소리 → 바람결이 뒤로 가볍게 흩날린다
    flute: { family: "breath", spark: "wisp", every: 55, size: [10, 16], dx: [-24, -8], rise: [8, 22], rot: [-50, 30], life: 900, accent: "#3fbcb2" },
    // 애잔하고 맑은 소리 → 맑은 물방울이 톡톡 떨어진다
    oboe: { family: "reed", spark: "drop", every: 75, size: [6, 9], dx: [-6, 6], rise: [-28, -14], rot: [0, 0], life: 950, accent: "#5f9fd6" },
    // 둥글고 부드러운 소리 → 동그란 방울이 둥실 떠오른다
    clarinet: { family: "reed", spark: "bubble", every: 65, size: [7, 12], dx: [-10, 10], rise: [16, 34], rot: [0, 0], life: 1050, accent: "#7f8fd6" },
    // 웅장하고 포근한 소리 → 금빛 후광이 크게 감싼다
    frenchHorn: { family: "brass", spark: "halo", every: 120, size: [18, 28], dx: [-2, 2], rise: [0, 6], rot: [0, 0], life: 1150, accent: "#e5a91c" },
    // 청아한 소리 → 맑은 빛이 반짝 스친다
    sogeum: { family: "breath", spark: "twinkle", every: 45, size: [10, 15], dx: [-14, 14], rise: [16, 34], rot: [0, 45], life: 650, accent: "#26a9b8" },
    // 깊게 울리는 소리 → 긴 바람결이 깊게 휘돈다
    daegeum: { family: "breath", spark: "wisp", every: 80, size: [15, 24], dx: [-32, -12], rise: [4, 14], rot: [-30, 20], life: 1150, accent: "#9e9a3e" },
    // 고요한 소리 → 작은 빛이 드문드문 고요하게 떠오른다
    danso: { family: "breath", spark: "glow", every: 120, size: [9, 13], dx: [-6, 6], rise: [10, 22], rot: [0, 0], life: 1300, accent: "#8fb07f" },
    // 애절한 소리 → 떨리는 물결선(농현)이 뒤로 흐른다
    haegeum: { family: "bow", spark: "wave", every: 85, size: [12, 17], dx: [-22, -6], rise: [4, 16], rot: [-12, 12], life: 1000, accent: "#c76f93" },
    // 맑게 뜯는 소리 → 뜯을 때마다 겹물결이 퍼진다
    gayageum: { family: "pluck", spark: "pluck", every: 150, size: [16, 24], dx: [0, 0], rise: [0, 0], rot: [0, 0], life: 850, accent: "#c9974a" },
  }

  function trait(id) {
    return TRAITS[id] || TRAITS.violin
  }

  function between(range, t) {
    return range[0] + (range[1] - range[0]) * t
  }

  // 효과 하나의 크기·방향·수명. random은 테스트에서 고정값을 넣을 수 있게 주입한다.
  function spark(t, index, random) {
    const r = typeof random === "function" ? random : Math.random
    return {
      kind: t.spark,
      size: n(between(t.size, r())),
      x: n(between(t.dx, r())),
      y: n(-between(t.rise, r())),
      rot: n(between(t.rot, r())),
      life: t.life,
      accent: index % 3 === 0,
    }
  }

  // 붓끝 효과를 이번 포인터 움직임에서 피울지 정한다.
  // m.sinceLast: 지난 효과 뒤 흐른 시간(ms) · m.moved: 지난 효과 뒤 움직인 거리(px)
  // m.newNote: 붓끝이 방금 새 음 칸으로 들어왔는지(처음 대는 순간 포함)
  function shouldSparkle(t, m) {
    // TODO(학습): 소리 내는 방식(t.family)에 따라 효과가 피는 순간을 정해 주세요.
    // 지금은 모든 악기가 같은 규칙(간격과 움직임)으로 핀다.
    return m.sinceLast >= t.every && m.moved >= 5
  }

  root.InstrumentBrush = {
    icon: icon,
    pose: pose,
    poseStyle: poseStyle,
    trait: trait,
    spark: spark,
    shouldSparkle: shouldSparkle,
    ids: Object.keys(DRAWERS),
  }
})(typeof self !== "undefined" ? self : this)
