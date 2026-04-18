/**
 * Feedback after scan: vibration (Android), short beeps (iOS / fallback), optional visual pulse.
 * Call unlockScanAudio() once after a user gesture (e.g. camera start) so iOS allows sound later.
 */
(function (w) {
  var audioCtx = null;

  function getCtx() {
    if (!audioCtx) {
      var Ctx = w.AudioContext || w.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  w.unlockScanAudio = function () {
    var ctx = getCtx();
    if (!ctx) return Promise.resolve();
    return ctx.resume().catch(function () {});
  };

  /** صوت أعلى: رفع الـ gain + مدة أوضح (مع تجنب clipping شديد) */
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

  /** نبضات أطول وأقوى — أندرويد/كروم يستفيد؛ آيفون سفاري: vibrate غالباً غير متاح */
  var VIB_OK = [200, 130, 200, 130, 320];
  var VIB_WARN = [90, 110, 90, 110, 90, 110, 90];
  var VIB_BAD = [100, 90, 100];

  function vibrateSumMs(arr) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += arr[i];
    return t;
  }

  function buzzPattern(arr) {
    function fire() {
      try {
        if (!w.navigator.vibrate) return;
        w.navigator.vibrate(arr);
      } catch (e) {
        /* ignore */
      }
    }
    fire();
    /* تكرار ثانٍ بعد ما يخلص النمط الأول (ما نستدعيش vibrate بسرعة عشان ما يلغيش بعض) */
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

  w.feedbackScanResult = function (kind) {
    var ctx = getCtx();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(function () {});
    }
    if (kind === "ok") {
      buzzPattern(VIB_OK);
    } else if (kind === "warn") {
      buzzPattern(VIB_WARN);
    } else {
      buzzPattern(VIB_BAD);
    }
    beep(kind);
    visualPulse(kind);
  };
})(window);
