/* tools/calibrate-sustain.py가 체크인된 MP3의 실제 루프에서 생성한다. */
;(function (root) {
  const data = root.SDStudioData
  if (!data || root.SD_DISABLE_SAMPLE_CALIBRATION) return
  const profiles = {
  "flute": {
    "commonCents": 12.571,
    "sources": {
      "sound/선율-서양(필하모니아)/관/flute/flute_G4.mp3": {
        "hz": 391.639428,
        "residualCents": -14.144
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_A4.mp3": {
        "hz": 439.343497,
        "residualCents": -15.156
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_B4.mp3": {
        "hz": 492.579489,
        "residualCents": -17.147
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_C5.mp3": {
        "hz": 531.775274,
        "residualCents": 15.405
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_D5.mp3": {
        "hz": 592.420881,
        "residualCents": 2.372
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_E5.mp3": {
        "hz": 664.059548,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_F5.mp3": {
        "hz": 703.868341,
        "residualCents": 0.792
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_G5.mp3": {
        "hz": 791.898094,
        "residualCents": 4.803
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_A5.mp3": {
        "hz": 887.664585,
        "residualCents": 2.442
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_Cs6.mp3": {
        "hz": 1117.608531,
        "residualCents": 1.236
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_D6.mp3": {
        "hz": 1180.903341,
        "residualCents": -3.392
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_E6.mp3": {
        "hz": 1313.234005,
        "residualCents": -19.513
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_Gs6.mp3": {
        "hz": 1670.051321,
        "residualCents": -3.391
      }
    }
  },
  "oboe": {
    "commonCents": 8.319,
    "sources": {
      "sound/선율-서양(필하모니아)/관/oboe/oboe_G4.mp3": {
        "hz": 393.883496,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_A4.mp3": {
        "hz": 439.075109,
        "residualCents": -11.961
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_B4.mp3": {
        "hz": 490.764982,
        "residualCents": -19.284
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_Cs5.mp3": {
        "hz": 556.638009,
        "residualCents": -1.235
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_D5.mp3": {
        "hz": 591.991315,
        "residualCents": 5.368
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_F5.mp3": {
        "hz": 698.031418,
        "residualCents": -9.372
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_G5.mp3": {
        "hz": 789.868857,
        "residualCents": 4.613
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_A5.mp3": {
        "hz": 875.576571,
        "residualCents": -17.043
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_C6.mp3": {
        "hz": 1045.607782,
        "residualCents": -9.799
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_D6.mp3": {
        "hz": 1188.330024,
        "residualCents": 11.714
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_E6.mp3": {
        "hz": 1339.331941,
        "residualCents": 18.807
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_F6.mp3": {
        "hz": 1415.664335,
        "residualCents": 14.766
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_G6.mp3": {
        "hz": 1601.729068,
        "residualCents": 28.547
      }
    }
  },
  "clarinet": {
    "commonCents": 2.911,
    "sources": {
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_G3.mp3": {
        "hz": 196.327518,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_A3.mp3": {
        "hz": 219.49992,
        "residualCents": -6.85
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_B3.mp3": {
        "hz": 246.26891,
        "residualCents": -7.633
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_C4.mp3": {
        "hz": 260.375344,
        "residualCents": -11.203
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_D4.mp3": {
        "hz": 292.596801,
        "residualCents": -9.218
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_E4.mp3": {
        "hz": 327.938687,
        "residualCents": -11.804
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_F4.mp3": {
        "hz": 346.663887,
        "residualCents": -15.67
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_G4.mp3": {
        "hz": 390.685127,
        "residualCents": -8.707
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_A4.mp3": {
        "hz": 440.864552,
        "residualCents": 0.488
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_B4.mp3": {
        "hz": 495.244539,
        "residualCents": 1.854
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_C5.mp3": {
        "hz": 526.222276,
        "residualCents": 6.892
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_D5.mp3": {
        "hz": 590.902543,
        "residualCents": 7.589
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_E5.mp3": {
        "hz": 662.860037,
        "residualCents": 6.53
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_F5.mp3": {
        "hz": 703.28608,
        "residualCents": 9.019
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_G5.mp3": {
        "hz": 788.645751,
        "residualCents": 7.338
      }
    }
  },
  "frenchHorn": {
    "commonCents": 10.637,
    "sources": {
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_G2.mp3": {
        "hz": 98.867487,
        "residualCents": 4.64
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_A2.mp3": {
        "hz": 110.94418,
        "residualCents": 4.16
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_B2.mp3": {
        "hz": 124.07203,
        "residualCents": -2.228
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_C3.mp3": {
        "hz": 131.378653,
        "residualCents": -3.164
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_D3.mp3": {
        "hz": 146.528429,
        "residualCents": -14.224
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_E3.mp3": {
        "hz": 166.94932,
        "residualCents": 11.651
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_F3.mp3": {
        "hz": 176.232125,
        "residualCents": 5.331
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_G3.mp3": {
        "hz": 196.46857,
        "residualCents": -6.483
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_A3.mp3": {
        "hz": 221.322811,
        "residualCents": -0.259
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_B3.mp3": {
        "hz": 248.026355,
        "residualCents": -3.049
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_Cs4.mp3": {
        "hz": 279.603697,
        "residualCents": 4.419
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_Ds4.mp3": {
        "hz": 313.722445,
        "residualCents": 3.745
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_E4.mp3": {
        "hz": 331.663083,
        "residualCents": 0.021
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_F4.mp3": {
        "hz": 351.380545,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_G4.mp3": {
        "hz": 392.797194,
        "residualCents": -7.1
      }
    }
  },
  "violin": {
    "commonCents": 3.684,
    "sources": {
      "sound/선율-서양(필하모니아)/현/violin/violin_G3.mp3": {
        "hz": 197.594829,
        "residualCents": 10.366
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_As3.mp3": {
        "hz": 235.348954,
        "residualCents": 13.073
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_B3.mp3": {
        "hz": 247.168351,
        "residualCents": -2.096
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_C4.mp3": {
        "hz": 263.390451,
        "residualCents": 7.955
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_D4.mp3": {
        "hz": 291.758806,
        "residualCents": -14.957
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_E4.mp3": {
        "hz": 329.159399,
        "residualCents": -6.145
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_F4.mp3": {
        "hz": 348.818542,
        "residualCents": -5.716
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_G4.mp3": {
        "hz": 392.096525,
        "residualCents": -3.238
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_A4.mp3": {
        "hz": 437.219196,
        "residualCents": -14.66
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_B4.mp3": {
        "hz": 495.153039,
        "residualCents": 0.761
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_Cs5.mp3": {
        "hz": 551.779963,
        "residualCents": -11.777
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_D5.mp3": {
        "hz": 589.680444,
        "residualCents": 3.232
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_Ds5.mp3": {
        "hz": 623.579596,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_F5.mp3": {
        "hz": 700.027536,
        "residualCents": 0.206
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_G5.mp3": {
        "hz": 786.323683,
        "residualCents": 1.46
      }
    }
  },
  "viola": {
    "commonCents": -3.269,
    "sources": {
      "sound/선율-서양(필하모니아)/현/viola/viola_G3.mp3": {
        "hz": 199.002749,
        "residualCents": 29.146,
        "reviewRequired": true,
        "reviewReason": "비브라토 중심 판정 불확실: 기존 후보값 유지, 자동 재보정 보류"
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_A3.mp3": {
        "hz": 219.447084,
        "residualCents": -1.087
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_B3.mp3": {
        "hz": 244.138115,
        "residualCents": -16.498
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_C4.mp3": {
        "hz": 259.236535,
        "residualCents": -12.612
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_D4.mp3": {
        "hz": 293.196126,
        "residualCents": 0.504
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_E4.mp3": {
        "hz": 328.909893,
        "residualCents": -0.504
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_Fs4.mp3": {
        "hz": 371.1289,
        "residualCents": 8.569
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_G4.mp3": {
        "hz": 393.978713,
        "residualCents": 12.006
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_Gs4.mp3": {
        "hz": 418.989672,
        "residualCents": 18.563
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_As4.mp3": {
        "hz": 465.93436,
        "residualCents": 2.417
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_C5.mp3": {
        "hz": 523.31427,
        "residualCents": 3.478
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_E5.mp3": {
        "hz": 656.649295,
        "residualCents": -3.587
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_F5.mp3": {
        "hz": 696.530687,
        "residualCents": -1.975,
        "reviewRequired": true,
        "reviewReason": "비브라토 중심 판정 불확실: 기존 후보값 유지, 자동 재보정 보류"
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_G5.mp3": {
        "hz": 780.870696,
        "residualCents": -3.635
      }
    }
  },
  "cello": {
    "commonCents": -5.45,
    "sources": {
      "sound/선율-서양(필하모니아)/현/cello/cello_Fs2.mp3": {
        "hz": 92.461522,
        "residualCents": 4.755
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_A2.mp3": {
        "hz": 109.551962,
        "residualCents": -1.616
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_B2.mp3": {
        "hz": 122.913325,
        "residualCents": -2.385
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_C3.mp3": {
        "hz": 130.410135,
        "residualCents": 0.113
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_Cs3.mp3": {
        "hz": 138.197606,
        "residualCents": 0.525
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_E3.mp3": {
        "hz": 163.594941,
        "residualCents": -7.401
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_F3.mp3": {
        "hz": 173.080937,
        "residualCents": -9.818
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_G3.mp3": {
        "hz": 195.930304,
        "residualCents": 4.854
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_Gs3.mp3": {
        "hz": 207.23887,
        "residualCents": 1.999
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_B3.mp3": {
        "hz": 244.141911,
        "residualCents": -14.291
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_C4.mp3": {
        "hz": 260.803311,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_D4.mp3": {
        "hz": 293.025225,
        "residualCents": 1.675
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_E4.mp3": {
        "hz": 328.743862,
        "residualCents": 0.802
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_F4.mp3": {
        "hz": 344.566758,
        "residualCents": -17.814
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_Fs4.mp3": {
        "hz": 368.375423,
        "residualCents": -2.142
      }
    }
  },
  "doubleBass": {
    "commonCents": 9.003,
    "sources": {
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_G1.mp3": {
        "hz": 49.60344,
        "residualCents": 12.208
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_A1.mp3": {
        "hz": 55.450604,
        "residualCents": 5.123
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_B1.mp3": {
        "hz": 62.110448,
        "residualCents": 1.483
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_C2.mp3": {
        "hz": 65.222877,
        "residualCents": -13.867
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_D2.mp3": {
        "hz": 72.83681,
        "residualCents": -22.719
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_E2.mp3": {
        "hz": 82.844343,
        "residualCents": 0.163
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_F2.mp3": {
        "hz": 87.549785,
        "residualCents": -4.196
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_G2.mp3": {
        "hz": 98.510404,
        "residualCents": 0.011
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_A2.mp3": {
        "hz": 110.638924,
        "residualCents": 1.024
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_B2.mp3": {
        "hz": 123.743791,
        "residualCents": -5.18
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_C3.mp3": {
        "hz": 130.027166,
        "residualCents": -19.431
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_D3.mp3": {
        "hz": 147.912584,
        "residualCents": 3.687
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_E3.mp3": {
        "hz": 165.229659,
        "residualCents": -4.64
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_F3.mp3": {
        "hz": 173.802498,
        "residualCents": -17.068
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_G3.mp3": {
        "hz": 197.019593,
        "residualCents": 0.0
      }
    }
  },
  "sogeum": {
    "commonCents": -6.535,
    "sources": {
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_B4.mp3": {
        "hz": 491.265382,
        "residualCents": -8.666
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_D5.mp3": {
        "hz": 587.740495,
        "residualCents": 2.746
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_E5.mp3": {
        "hz": 650.536439,
        "residualCents": 6.487
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_Fs5.mp3": {
        "hz": 736.469732,
        "residualCents": 10.282
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_B5.mp3": {
        "hz": 978.942587,
        "residualCents": 0.0
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_D6.mp3": {
        "hz": 1154.379232,
        "residualCents": -9.615
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_E6.mp3": {
        "hz": 1279.009464,
        "residualCents": -0.123
      }
    }
  },
  "daegeum": {
    "commonCents": -6.465,
    "sources": {
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_As3.mp3": {
        "hz": 237.892841,
        "residualCents": -8.165
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_Cs4.mp3": {
        "hz": 271.158276,
        "residualCents": -1.577
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_D4.mp3": {
        "hz": 293.598343,
        "residualCents": -1.926
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_E4.mp3": {
        "hz": 323.056933,
        "residualCents": -1.393
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_G4.mp3": {
        "hz": 401.77272,
        "residualCents": 1.117
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_A4.mp3": {
        "hz": 437.095656,
        "residualCents": 0.0
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_Cs5.mp3": {
        "hz": 543.672556,
        "residualCents": 2.747
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_D5.mp3": {
        "hz": 583.02202,
        "residualCents": 0.722
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_E5.mp3": {
        "hz": 645.988496,
        "residualCents": 5.271
      }
    }
  },
  "danso": {
    "commonCents": -4.129,
    "sources": {
      "sound/선율-국악(국립국악원)/관/단소.mp3@0.56": {
        "hz": 417.053161,
        "residualCents": 4.403
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@12.01": {
        "hz": 555.066749,
        "residualCents": -9.681
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@17.76": {
        "hz": 622.785351,
        "residualCents": -22.393
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@28.48": {
        "hz": 827.95225,
        "residualCents": 3.582
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@41.81": {
        "hz": 1085.913388,
        "residualCents": 21.13
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@48.28": {
        "hz": 1231.12937,
        "residualCents": -3.582
      }
    }
  },
  "haegeum": {
    "commonCents": -2.121,
    "sources": {
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Gs3.mp3": {
        "hz": 207.562012,
        "residualCents": 1.367
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_C4.mp3": {
        "hz": 261.114351,
        "residualCents": -1.266
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Cs4.mp3": {
        "hz": 276.181555,
        "residualCents": -4.143
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Ds4.mp3": {
        "hz": 308.545014,
        "residualCents": -12.307
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_G4.mp3": {
        "hz": 392.277053,
        "residualCents": 3.364
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Gs4.mp3": {
        "hz": 414.796322,
        "residualCents": 0.0
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_C5.mp3": {
        "hz": 525.065148,
        "residualCents": 8.112
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Cs5.mp3": {
        "hz": 556.391687,
        "residualCents": 8.437
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_F5.mp3": {
        "hz": 697.575363,
        "residualCents": -0.065
      }
    }
  },
  "gayageum": {
    "commonCents": 1.757,
    "sources": {
      "sound/선율-국악(국립국악원)/현/가야금.mp3@94.892": {
        "hz": 197.667891,
        "residualCents": -0.067
      },
      "sound/선율-국악(국립국악원)/현/가야금.mp3@105.601": {
        "hz": 209.936218,
        "residualCents": 2.18
      },
      "sound/선율-국악(국립국악원)/현/가야금.mp3@127.169": {
        "hz": 264.871424,
        "residualCents": 3.59
      },
      "sound/선율-국악(국립국악원)/현/가야금.mp3@138.817": {
        "hz": 296.180621,
        "residualCents": 5.012
      },
      "sound/선율-국악(국립국악원)/현/가야금.mp3@148.716": {
        "hz": 313.609121,
        "residualCents": 0.0
      },
      "sound/선율-국악(국립국악원)/현/가야금.mp3@170.988": {
        "hz": 396.565863,
        "residualCents": -1.688
      },
      "sound/선율-국악(국립국악원)/현/가야금.mp3@179.244": {
        "hz": 420.371662,
        "residualCents": -0.763
      },
      "sound/선율-국악(국립국악원)/현/가야금.mp3@195.393": {
        "hz": 526.999075,
        "residualCents": -1.401
      },
      "sound/선율-국악(국립국악원)/현/가야금.mp3@202.753": {
        "hz": 594.738698,
        "residualCents": 0.946
      }
    }
  }
}
  Object.keys(profiles).forEach(function (id) {
    const asset = data.melodies[id]
    if (!asset) return
    for (const segment of asset.sampleMap || []) {
      const key = asset.sampleMode === "multi" ? segment.src : asset.src + "@" + segment.offset
      const profile = profiles[id].sources[key]
      if (!profile) continue
      // cents에는 이웃 파일을 빌려 쓴 반음 차이도 들어 있으므로 덮어쓰지 않는다.
      const actualMidi = 69 + 12 * Math.log2(profile.hz / 440)
      segment.tuningCents = 100 * (actualMidi - segment.midi) - (segment.cents || 0)
    }
  })
  data.sampleCalibration = profiles
})(typeof self !== "undefined" ? self : this)
