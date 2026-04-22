/**
 * Feedback after scan: vibration (Android where supported), beeps, visual pulse.
 * iOS Safari: لا يدعم navigator.vibrate للمواقع — نستخدم HTMLAudio + إبقاء WebAudio نشطاً مع الكاميرا.
 * استدعِ unlockScanAudio() من لمس «تشغيل الكاميرا»؛ و setScanningAudioActive(true) أثناء المعاينة.
 */
(function (w) {
  var audioCtx = null;
  var ua = (w.navigator && w.navigator.userAgent) || "";
  var isLikelyIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (w.navigator.platform === "MacIntel" && w.navigator.maxTouchPoints > 1);

  var SR = 24000;
  var iosAudios = { ok: null, warn: null, bad: null, primed: false };
  var keepAliveId = null;

  function getCtx() {
    if (!audioCtx) {
      var Ctx = w.AudioContext || w.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function writeString(dv, offset, s) {
    for (var i = 0; i < s.length; i++) {
      dv.setUint8(offset + i, s.charCodeAt(i));
    }
  }

  function sineFloat(freq, seconds, amp) {
    var n = Math.floor(SR * seconds);
    var a = amp != null ? amp : 0.42;
    var out = new Float32Array(n);
    var i;
    for (i = 0; i < n; i++) {
      var t = i / SR;
      var env = Math.min(1, i / 90) * Math.min(1, (n - 1 - i) / 700);
      out[i] = Math.sin(2 * Math.PI * freq * t) * a * env;
    }
    return out;
  }

  function concatFloat(parts) {
    var len = 0;
    var i;
    for (i = 0; i < parts.length; i++) {
      len += parts[i].length;
    }
    var out = new Float32Array(len);
    var o = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], o);
      o += parts[i].length;
    }
    return out;
  }

  function floatToWavBuffer(floatSamples) {
    var n = floatSamples.length;
    var nb = 44 + n * 2;
    var ab = new ArrayBuffer(nb);
    var dv = new DataView(ab);
    writeString(dv, 0, "RIFF");
    dv.setUint32(4, 36 + n * 2, true);
    writeString(dv, 8, "WAVE");
    writeString(dv, 12, "fmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, SR, true);
    dv.setUint32(28, SR * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    writeString(dv, 36, "data");
    dv.setUint32(40, n * 2, true);
    var off = 44;
    var j;
    for (j = 0; j < n; j++) {
      var s = Math.max(-1, Math.min(1, floatSamples[j]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return ab;
  }

  function wavUrlFromFloats(parts) {
    var buf = floatToWavBuffer(concatFloat(parts));
    var blob = new Blob([buf], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  }

  function ensureIosHtml5Audio() {
    if (!isLikelyIOS || iosAudios.ok) return;
    try {
      var okF = concatFloat([
        sineFloat(784, 0.14, 0.44),
        new Float32Array(Math.floor(SR * 0.04)),
        sineFloat(1047, 0.16, 0.46),
      ]);
      var warnF = concatFloat([
        sineFloat(415, 0.13, 0.4),
        new Float32Array(Math.floor(SR * 0.05)),
        sineFloat(349, 0.15, 0.42),
      ]);
      var badF = concatFloat([sineFloat(196, 0.2, 0.45), sineFloat(165, 0.18, 0.38)]);
      iosAudios.ok = new Audio(wavUrlFromFloats([okF]));
      iosAudios.warn = new Audio(wavUrlFromFloats([warnF]));
      iosAudios.bad = new Audio(wavUrlFromFloats([badF]));
      iosAudios.ok.preload = "auto";
      iosAudios.warn.preload = "auto";
      iosAudios.bad.preload = "auto";
      iosAudios.ok.setAttribute("playsinline", "");
      iosAudios.warn.setAttribute("playsinline", "");
      iosAudios.bad.setAttribute("playsinline", "");
    } catch (e) {
      /* ignore */
    }
  }

  function playIosHtml5(kind) {
    ensureIosHtml5Audio();
    var a = kind === "ok" ? iosAudios.ok : kind === "warn" ? iosAudios.warn : iosAudios.bad;
    if (!a) return Promise.reject(new Error("no-audio"));
    try {
      a.volume = 0.95;
      a.currentTime = 0;
      var p = a.play();
      return p && typeof p.then === "function" ? p : Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /**
   * أثناء فتح الكاميرا على iOS: حاول إبقاء AudioContext في حالة running (نتيجة المسح غالباً غير «gesture»).
   */
  w.setScanningAudioActive = function (active) {
    if (keepAliveId) {
      w.clearInterval(keepAliveId);
      keepAliveId = null;
    }
    if (!active || !isLikelyIOS) return;
    keepAliveId = w.setInterval(function () {
      var c = getCtx();
      if (c && c.state === "suspended") {
        c.resume().catch(function () {});
      }
    }, 280);
  };

  /**
   * Must run synchronously inside a user gesture (tap) on iOS Safari — async
   * continuations after getUserMedia / video.play do not unlock audio.
   */
  w.unlockScanAudio = function () {
    var ctx = getCtx();
    if (!ctx) return Promise.resolve();
    try {
      var buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {
      /* ignore */
    }
    if (isLikelyIOS) {
      ensureIosHtml5Audio();
      if (!iosAudios.primed && iosAudios.ok) {
        iosAudios.primed = true;
        try {
          iosAudios.ok.volume = 0.08;
          iosAudios.ok.currentTime = 0;
          var pr = iosAudios.ok.play();
          if (pr && pr.then) {
            pr.then(function () {
              w.setTimeout(function () {
                try {
                  iosAudios.ok.pause();
                  iosAudios.ok.currentTime = 0;
                  iosAudios.ok.volume = 0.95;
                } catch (e2) {
                  /* ignore */
                }
              }, 45);
            }).catch(function () {
              iosAudios.ok.volume = 0.95;
            });
          }
        } catch (e3) {
          iosAudios.primed = false;
        }
      }
    }
    return ctx.resume().catch(function () {});
  };

  function playTone(freqHz, durationSec, startOffsetSec, peakGain) {
    var ctx = getCtx();
    if (!ctx) return;
    var peak = peakGain != null ? peakGain : 0.68;
    try {
      var t0 = ctx.currentTime + (startOffsetSec || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = "sine";
      osc.connect(g);
      g.connect(ctx.destination);
      osc.frequency.setValueAtTime(freqHz, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.024);
      var endT = t0 + Math.max(durationSec, 0.14);
      g.gain.exponentialRampToValueAtTime(0.0001, endT);
      osc.start(t0);
      osc.stop(endT + 0.05);
    } catch (e) {
      /* ignore */
    }
  }

  var VIB_OK = [200, 130, 200, 130, 320];
  var VIB_WARN = [90, 110, 90, 110, 90, 110, 90];
  var VIB_BAD = [100, 90, 100];

  function vibrateSumMs(arr) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += arr[i];
    return t;
  }

  function buzzPattern(arr) {
    if (typeof w.navigator.vibrate !== "function") return;
    function fire() {
      try {
        w.navigator.vibrate(arr);
      } catch (e) {
        /* ignore */
      }
    }
    fire();
    var pause = vibrateSumMs(arr) + 180;
    w.setTimeout(fire, pause);
  }

  function beep(kind) {
    var ctx = getCtx();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(function () {});
    }
    if (kind === "ok") {
      playTone(784, 0.16, 0, 0.72);
      playTone(1047, 0.2, 0.15, 0.75);
      playTone(1319, 0.14, 0.32, 0.55);
    } else if (kind === "warn") {
      playTone(415, 0.14, 0, 0.65);
      playTone(349, 0.18, 0.12, 0.68);
      playTone(311, 0.14, 0.26, 0.55);
    } else {
      playTone(196, 0.22, 0, 0.7);
      playTone(165, 0.18, 0.16, 0.62);
    }
  }

  function visualPulse(kind) {
    var el = document.querySelector("main.card");
    if (!el) return;
    var cls = kind === "ok" ? "pulse-ok" : kind === "warn" ? "pulse-warn" : "pulse-bad";
    el.classList.remove("pulse-ok", "pulse-warn", "pulse-bad");
    void el.offsetWidth;
    el.classList.add(cls);
    w.setTimeout(function () {
      el.classList.remove("pulse-ok", "pulse-warn", "pulse-bad");
    }, 950);
  }

  function speakFallback(kind) {
    if (!w.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return;
    try {
      var t =
        kind === "ok" ? "تم التسجيل" : kind === "warn" ? "مسجّل مسبقاً" : "تنبيه";
      var u = new SpeechSynthesisUtterance(t);
      u.lang = "ar-SA";
      u.rate = 1.15;
      u.volume = 0.85;
      w.speechSynthesis.cancel();
      w.speechSynthesis.speak(u);
    } catch (e) {
      /* ignore */
    }
  }

  w.feedbackScanResult = function (kind) {
    var ctx = getCtx();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(function () {});
    }

    if (!isLikelyIOS) {
      if (kind === "ok") {
        buzzPattern(VIB_OK);
      } else if (kind === "warn") {
        buzzPattern(VIB_WARN);
      } else {
        buzzPattern(VIB_BAD);
      }
      beep(kind);
    } else {
      playIosHtml5(kind).catch(function () {
        speakFallback(kind);
      });
      w.setTimeout(function () {
        var c = getCtx();
        if (c && c.state === "running") {
          beep(kind);
        }
      }, 0);
    }

    visualPulse(kind);
    if (isLikelyIOS) {
      w.setTimeout(function () {
        visualPulse(kind);
      }, 400);
    }
  };
})(window);
