/* tools/calibrate-sustain.py가 체크인된 MP3의 실제 루프에서 생성한다. */
;(function (root) {
  const data = root.SDStudioData
  if (!data || root.SD_DISABLE_SAMPLE_CALIBRATION) return
  const profiles = {
  "flute": {
    "commonCents": 12.325,
    "sources": {
      "sound/선율-서양(필하모니아)/관/flute/flute_G4.mp3": {
        "hz": 392.641565,
        "residualCents": -9.474
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_A4.mp3": {
        "hz": 442.222436,
        "residualCents": -3.603
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_B4.mp3": {
        "hz": 496.906473,
        "residualCents": -1.76
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_C5.mp3": {
        "hz": 524.324137,
        "residualCents": -8.779
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_D5.mp3": {
        "hz": 591.592521,
        "residualCents": 0.195
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_E5.mp3": {
        "hz": 663.880045,
        "residualCents": -0.222
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_F5.mp3": {
        "hz": 703.367553,
        "residualCents": -0.195
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_G5.mp3": {
        "hz": 791.973623,
        "residualCents": 5.213
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_A5.mp3": {
        "hz": 887.69738,
        "residualCents": 2.752
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_C6.mp3": {
        "hz": 1059.053596,
        "residualCents": 8.315
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_D6.mp3": {
        "hz": 1180.534467,
        "residualCents": -3.688
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_E6.mp3": {
        "hz": 1332.173422,
        "residualCents": 5.522
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_F6.mp3": {
        "hz": 1409.296516,
        "residualCents": 2.954
      },
      "sound/선율-서양(필하모니아)/관/flute/flute_G6.mp3": {
        "hz": 1605.830149,
        "residualCents": 28.967
      }
    }
  },
  "oboe": {
    "commonCents": 6.377,
    "sources": {
      "sound/선율-서양(필하모니아)/관/oboe/oboe_G4.mp3": {
        "hz": 393.411031,
        "residualCents": -0.137
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_A4.mp3": {
        "hz": 438.967491,
        "residualCents": -10.445
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_B4.mp3": {
        "hz": 493.191105,
        "residualCents": -8.805
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_C5.mp3": {
        "hz": 524.333302,
        "residualCents": -2.801
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_D5.mp3": {
        "hz": 591.776851,
        "residualCents": 6.682
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_E5.mp3": {
        "hz": 663.675473,
        "residualCents": 5.192
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_F5.mp3": {
        "hz": 697.856868,
        "residualCents": -7.864
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_G5.mp3": {
        "hz": 789.643791,
        "residualCents": 6.061
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_A5.mp3": {
        "hz": 881.51819,
        "residualCents": -3.393
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_B5.mp3": {
        "hz": 994.908591,
        "residualCents": 6.095
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_C6.mp3": {
        "hz": 1050.447371,
        "residualCents": 0.137
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_D6.mp3": {
        "hz": 1182.684528,
        "residualCents": 5.41
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_F6.mp3": {
        "hz": 1399.962728,
        "residualCents": -2.602
      },
      "sound/선율-서양(필하모니아)/관/oboe/oboe_G6.mp3": {
        "hz": 1601.546477,
        "residualCents": 30.291
      }
    }
  },
  "clarinet": {
    "commonCents": 2.91,
    "sources": {
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_G3.mp3": {
        "hz": 196.327472,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_A3.mp3": {
        "hz": 219.500164,
        "residualCents": -6.848
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_B3.mp3": {
        "hz": 246.268973,
        "residualCents": -7.633
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_C4.mp3": {
        "hz": 260.375355,
        "residualCents": -11.203
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_D4.mp3": {
        "hz": 292.598026,
        "residualCents": -9.21
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_E4.mp3": {
        "hz": 327.938535,
        "residualCents": -11.804
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_F4.mp3": {
        "hz": 346.669423,
        "residualCents": -15.642
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_G4.mp3": {
        "hz": 390.685108,
        "residualCents": -8.707
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_A4.mp3": {
        "hz": 440.864254,
        "residualCents": 0.487
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_B4.mp3": {
        "hz": 495.244595,
        "residualCents": 1.855
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_C5.mp3": {
        "hz": 526.222501,
        "residualCents": 6.893
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_D5.mp3": {
        "hz": 590.902798,
        "residualCents": 7.591
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_E5.mp3": {
        "hz": 662.858834,
        "residualCents": 6.528
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_F5.mp3": {
        "hz": 703.28829,
        "residualCents": 9.025
      },
      "sound/선율-서양(필하모니아)/관/clarinet/clarinet_G5.mp3": {
        "hz": 788.643167,
        "residualCents": 7.333
      }
    }
  },
  "frenchHorn": {
    "commonCents": 10.659,
    "sources": {
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_G2.mp3": {
        "hz": 99.834572,
        "residualCents": 21.47
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_A2.mp3": {
        "hz": 110.946145,
        "residualCents": 4.168
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_B2.mp3": {
        "hz": 124.071616,
        "residualCents": -2.256
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_C3.mp3": {
        "hz": 131.37873,
        "residualCents": -3.185
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_D3.mp3": {
        "hz": 146.529105,
        "residualCents": -14.239
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_E3.mp3": {
        "hz": 166.951913,
        "residualCents": 11.656
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_F3.mp3": {
        "hz": 176.232194,
        "residualCents": 5.31
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_G3.mp3": {
        "hz": 196.468306,
        "residualCents": -6.508
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_A3.mp3": {
        "hz": 221.329882,
        "residualCents": -0.226
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_B3.mp3": {
        "hz": 248.027063,
        "residualCents": -3.066
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_C4.mp3": {
        "hz": 263.28369,
        "residualCents": 0.278
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_D4.mp3": {
        "hz": 297.184617,
        "residualCents": 9.968
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_E4.mp3": {
        "hz": 331.663335,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_F4.mp3": {
        "hz": 351.382191,
        "residualCents": -0.014
      },
      "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_G4.mp3": {
        "hz": 395.224049,
        "residualCents": 3.541
      }
    }
  },
  "violin": {
    "commonCents": 1.972,
    "sources": {
      "sound/선율-서양(필하모니아)/현/violin/violin_G3.mp3": {
        "hz": 197.590781,
        "residualCents": 12.042
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_A3.mp3": {
        "hz": 220.535044,
        "residualCents": 2.233
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_B3.mp3": {
        "hz": 247.223147,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_C4.mp3": {
        "hz": 263.881499,
        "residualCents": 12.892
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_D4.mp3": {
        "hz": 292.08275,
        "residualCents": -11.324
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_E4.mp3": {
        "hz": 329.118363,
        "residualCents": -4.649
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_F4.mp3": {
        "hz": 348.997433,
        "residualCents": -3.117
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_G4.mp3": {
        "hz": 392.184767,
        "residualCents": -1.136
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_A4.mp3": {
        "hz": 437.564727,
        "residualCents": -11.581
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_B4.mp3": {
        "hz": 493.272425,
        "residualCents": -4.115
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_C5.mp3": {
        "hz": 523.937014,
        "residualCents": 0.295
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_D5.mp3": {
        "hz": 589.443272,
        "residualCents": 4.247
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_Ds5.mp3": {
        "hz": 623.525786,
        "residualCents": 1.562
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_F5.mp3": {
        "hz": 698.71677,
        "residualCents": -1.327
      },
      "sound/선율-서양(필하모니아)/현/violin/violin_G5.mp3": {
        "hz": 786.479599,
        "residualCents": 3.515
      }
    }
  },
  "viola": {
    "commonCents": -2.805,
    "sources": {
      "sound/선율-서양(필하모니아)/현/viola/viola_G3.mp3": {
        "hz": 199.002749,
        "residualCents": 29.146
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_A3.mp3": {
        "hz": 219.495515,
        "residualCents": -1.17
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_B3.mp3": {
        "hz": 244.275666,
        "residualCents": -15.987
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_C4.mp3": {
        "hz": 259.47845,
        "residualCents": -11.462
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_D4.mp3": {
        "hz": 293.540719,
        "residualCents": 2.073
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_E4.mp3": {
        "hz": 328.947836,
        "residualCents": -0.769
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_Fs4.mp3": {
        "hz": 370.63488,
        "residualCents": 5.799
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_G4.mp3": {
        "hz": 393.890571,
        "residualCents": 11.154
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_Gs4.mp3": {
        "hz": 419.175145,
        "residualCents": 18.864
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_As4.mp3": {
        "hz": 465.616002,
        "residualCents": 0.769
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_C5.mp3": {
        "hz": 523.217984,
        "residualCents": 2.695
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_E5.mp3": {
        "hz": 657.601313,
        "residualCents": -1.544
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_F5.mp3": {
        "hz": 696.530687,
        "residualCents": -1.975
      },
      "sound/선율-서양(필하모니아)/현/viola/viola_G5.mp3": {
        "hz": 781.741595,
        "residualCents": -2.17
      }
    }
  },
  "cello": {
    "commonCents": -5.736,
    "sources": {
      "sound/선율-서양(필하모니아)/현/cello/cello_G2.mp3": {
        "hz": 97.841441,
        "residualCents": 2.953
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_A2.mp3": {
        "hz": 109.550757,
        "residualCents": -1.348
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_B2.mp3": {
        "hz": 122.921758,
        "residualCents": -1.979
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_C3.mp3": {
        "hz": 130.39429,
        "residualCents": 0.189
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_D3.mp3": {
        "hz": 146.779844,
        "residualCents": 5.117
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_E3.mp3": {
        "hz": 163.589921,
        "residualCents": -7.167
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_F3.mp3": {
        "hz": 174.375839,
        "residualCents": 3.372
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_G3.mp3": {
        "hz": 195.983435,
        "residualCents": 5.61
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_Gs3.mp3": {
        "hz": 207.393212,
        "residualCents": 3.575
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_B3.mp3": {
        "hz": 244.299315,
        "residualCents": -12.888
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_C4.mp3": {
        "hz": 260.802997,
        "residualCents": 0.285
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_D4.mp3": {
        "hz": 292.642459,
        "residualCents": -0.301
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_E4.mp3": {
        "hz": 328.430849,
        "residualCents": -0.56
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_F4.mp3": {
        "hz": 344.326805,
        "residualCents": -18.734
      },
      "sound/선율-서양(필하모니아)/현/cello/cello_G4.mp3": {
        "hz": 390.6987,
        "residualCents": 0.0
      }
    }
  },
  "doubleBass": {
    "commonCents": 7.621,
    "sources": {
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_G1.mp3": {
        "hz": 49.610442,
        "residualCents": 13.834
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_A1.mp3": {
        "hz": 55.451215,
        "residualCents": 6.524
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_B1.mp3": {
        "hz": 62.108472,
        "residualCents": 2.809
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_C2.mp3": {
        "hz": 65.221528,
        "residualCents": -12.521
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_D2.mp3": {
        "hz": 72.838773,
        "residualCents": -21.291
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_E2.mp3": {
        "hz": 82.862071,
        "residualCents": 1.915
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_F2.mp3": {
        "hz": 87.553052,
        "residualCents": -2.75
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_G2.mp3": {
        "hz": 98.431208,
        "residualCents": 0.0
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_A2.mp3": {
        "hz": 110.627076,
        "residualCents": 2.22
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_B2.mp3": {
        "hz": 123.466566,
        "residualCents": -7.681
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_C3.mp3": {
        "hz": 130.022558,
        "residualCents": -18.111
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_D3.mp3": {
        "hz": 147.924169,
        "residualCents": 5.204
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_E3.mp3": {
        "hz": 164.896456,
        "residualCents": -6.753
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_F3.mp3": {
        "hz": 173.827227,
        "residualCents": -15.44
      },
      "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_G3.mp3": {
        "hz": 196.991111,
        "residualCents": 1.131
      }
    }
  },
  "sogeum": {
    "commonCents": -6.536,
    "sources": {
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_B4.mp3": {
        "hz": 491.268921,
        "residualCents": -8.653
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_D5.mp3": {
        "hz": 587.73813,
        "residualCents": 2.74
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_E5.mp3": {
        "hz": 650.535066,
        "residualCents": 6.484
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_Fs5.mp3": {
        "hz": 736.461892,
        "residualCents": 10.264
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_B5.mp3": {
        "hz": 978.942321,
        "residualCents": 0.0
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_D6.mp3": {
        "hz": 1154.36052,
        "residualCents": -9.642
      },
      "sound/선율-국악(국립국악원)/관/sogeum/sogeum_E6.mp3": {
        "hz": 1279.014675,
        "residualCents": -0.116
      }
    }
  },
  "daegeum": {
    "commonCents": -6.47,
    "sources": {
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_As3.mp3": {
        "hz": 237.906978,
        "residualCents": -8.057
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_Cs4.mp3": {
        "hz": 271.159201,
        "residualCents": -1.566
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_D4.mp3": {
        "hz": 293.588553,
        "residualCents": -1.98
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_E4.mp3": {
        "hz": 323.046319,
        "residualCents": -1.445
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_G4.mp3": {
        "hz": 401.77198,
        "residualCents": 1.118
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_A4.mp3": {
        "hz": 437.094541,
        "residualCents": 0.0
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_Cs5.mp3": {
        "hz": 543.668606,
        "residualCents": 2.739
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_D5.mp3": {
        "hz": 583.022122,
        "residualCents": 0.726
      },
      "sound/선율-국악(국립국악원)/관/daegeum/daegeum_E5.mp3": {
        "hz": 646.029712,
        "residualCents": 5.386
      }
    }
  },
  "danso": {
    "commonCents": -4.17,
    "sources": {
      "sound/선율-국악(국립국악원)/관/단소.mp3@0.56": {
        "hz": 417.035461,
        "residualCents": 4.37
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@12.01": {
        "hz": 555.073301,
        "residualCents": -9.62
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@17.76": {
        "hz": 622.789083,
        "residualCents": -22.342
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@28.48": {
        "hz": 827.931612,
        "residualCents": 3.58
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@41.81": {
        "hz": 1085.914248,
        "residualCents": 21.172
      },
      "sound/선율-국악(국립국악원)/관/단소.mp3@48.28": {
        "hz": 1231.102571,
        "residualCents": -3.58
      }
    }
  },
  "haegeum": {
    "commonCents": -2.118,
    "sources": {
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Gs3.mp3": {
        "hz": 207.560099,
        "residualCents": 1.349
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_C4.mp3": {
        "hz": 261.11708,
        "residualCents": -1.25
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Cs4.mp3": {
        "hz": 276.180308,
        "residualCents": -4.154
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Ds4.mp3": {
        "hz": 308.545378,
        "residualCents": -12.307
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_G4.mp3": {
        "hz": 392.277171,
        "residualCents": 3.362
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Gs4.mp3": {
        "hz": 414.796954,
        "residualCents": 0.0
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_C5.mp3": {
        "hz": 525.06163,
        "residualCents": 8.098
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Cs5.mp3": {
        "hz": 556.392995,
        "residualCents": 8.439
      },
      "sound/선율-국악(국립국악원)/현/haegeum/haegeum_F5.mp3": {
        "hz": 697.595661,
        "residualCents": -0.017
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
