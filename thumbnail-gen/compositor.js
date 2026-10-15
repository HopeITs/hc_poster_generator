/* Thumbnail compositor — replays the Photoshop effect stack of the HC YouTube
   thumbnail (assets/stack.json) on top of any picture.

   Works on a Float32Array RGB image in 0..1, gamma-encoded sRGB, which is the
   space Photoshop blends 8-bit RGB documents in. Pixel layers arrive as RGBA
   ImageData already aligned to the output canvas (layer masks are folded into
   their alpha at export time), so each step only says how to blend.

   Step types (as in stack.json):
     {type:"layer", img, blend, opacity}
     {type:"clip",  base:{img,blend,opacity}, clipped:[{img,blend,opacity}]}
     {type:"adjust", fn, opacity}
     {type:"group", opacity, steps:[...]}      pass-through group

   The Curves + Exposure + Brightness/Contrast trio is not re-derived from
   Photoshop's (unpublished) formulas: its combined tone curve was recovered
   from the PSD's own composite and ships as stack.json "tone" (256 entries).
   Verified against the PSD: mean error 1.56/255, no bias, 82% within ±2. */
(function (root) {
  "use strict";

  var BLEND = {
    "normal":     function (b, s) { return s; },
    "multiply":   function (b, s) { return b * s; },
    "screen":     function (b, s) { return b + s - b * s; },
    "lighten":    function (b, s) { return b > s ? b : s; },
    "exclusion":  function (b, s) { return b + s - 2 * b * s; },
    // Photoshop's soft light (differs from the W3C one in the light half).
    "soft light": function (b, s) {
      return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b)
                      : b + (2 * s - 1) * (Math.sqrt(b) - b);
    }
  };

  /* Blend If ("underlying layer" gray range, Photoshop's 4 slider values
     0..255: black lo/hi, white lo/hi): the layer fades in from black lo→hi and
     out from white lo→hi of the backdrop's gray value. */
  function blendIfFactor(range, r, g, b) {
    if (!range) return 1;
    var v = (0.3 * r + 0.59 * g + 0.11 * b) * 255;
    var b0 = range[0], b1 = range[1], w0 = range[2], w1 = range[3];
    if (v < b0) return 0;
    if (v < b1) return (v - b0) / (b1 - b0);
    if (v <= w0) return 1;
    if (v < w1) return (w1 - v) / (w1 - w0);
    return 0;
  }
  /* Color Overlay layer style: the layer's colour becomes blend(colour, overlay)
     (its alpha is kept). */
  function overlaid(d, j, ov, c) {
    var s = d[j + c] / 255;
    return s + (BLEND[ov.blend](s, ov.rgb[c] / 255) - s) * ov.opacity;
  }

  function blendLayer(dst, img, blend, opacity, blendIf, overlay) {
    var f = BLEND[blend], d = img.data, n = dst.length / 3;
    for (var p = 0, i = 0, j = 0; p < n; p++, i += 3, j += 4) {
      var a = d[j + 3] / 255 * opacity; if (a <= 0) continue;
      if (blendIf) { a *= blendIfFactor(blendIf, dst[i], dst[i + 1], dst[i + 2]); if (a <= 0) continue; }
      for (var c = 0; c < 3; c++) {
        var b = dst[i + c];
        dst[i + c] = b + (f(b, overlay ? overlaid(d, j, overlay, c) : d[j + c] / 255) - b) * a;
      }
    }
  }

  /* Clipping group: clipped layers are composited into the base layer's pixels
     (inside its alpha), then the result blends with the base's mode/opacity. */
  function blendClip(dst, base, clipped) {
    var f = BLEND[base.blend], bd = base.img.data, n = dst.length / 3;
    for (var p = 0, i = 0, j = 0; p < n; p++, i += 3, j += 4) {
      var a = bd[j + 3] / 255 * base.opacity; if (a <= 0) continue;
      var ov = base.overlay;
      var rgb = ov ? [overlaid(bd, j, ov, 0), overlaid(bd, j, ov, 1), overlaid(bd, j, ov, 2)]
                   : [bd[j] / 255, bd[j + 1] / 255, bd[j + 2] / 255];
      for (var k = 0; k < clipped.length; k++) {
        var cl = clipped[k], cd = cl.img.data, ca = cd[j + 3] / 255 * cl.opacity, cf = BLEND[cl.blend];
        if (ca <= 0) continue;
        for (var c = 0; c < 3; c++) rgb[c] += (cf(rgb[c], cd[j + c] / 255) - rgb[c]) * ca;
      }
      for (var c2 = 0; c2 < 3; c2++) dst[i + c2] += (f(dst[i + c2], rgb[c2]) - dst[i + c2]) * a;
    }
  }

  function adjust(dst, fn, opacity) {
    var out = [0, 0, 0];
    for (var i = 0; i < dst.length; i += 3) {
      fn(dst[i], dst[i + 1], dst[i + 2], out);
      for (var c = 0; c < 3; c++) dst[i + c] += (out[c] - dst[i + c]) * opacity;
    }
  }

  function run(dst, steps) {
    for (var k = 0; k < steps.length; k++) {
      var s = steps[k];
      if (s.type === "layer") blendLayer(dst, s.img, s.blend, s.opacity, s.blendIf, s.overlay);
      else if (s.type === "clip") blendClip(dst, s.base, s.clipped);
      else if (s.type === "adjust") adjust(dst, s.fn, s.opacity);
      else if (s.type === "group") {
        // Pass-through group with opacity: run the contents on the backdrop,
        // then mix the result back toward the untouched backdrop.
        if (s.opacity >= 1) { run(dst, s.steps); continue; }
        var before = dst.slice(); run(dst, s.steps);
        for (var i = 0; i < dst.length; i++) dst[i] = before[i] + (dst[i] - before[i]) * s.opacity;
      }
    }
    return dst;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* Hue/Saturation with only the master saturation set: scale each channel's
     distance from the HSL lightness. */
  function hueSat(sat) {
    var k = 1 + sat / 100;
    return function (r, g, b, o) {
      var l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
      o[0] = clamp01(l + (r - l) * k); o[1] = clamp01(l + (g - l) * k); o[2] = clamp01(l + (b - l) * k);
    };
  }

  /* Same curve on R, G and B, from a 256-entry table (linear interpolation). */
  function tone(table) {
    function m(v) { var t = clamp01(v) * 255, i = t | 0; if (i >= 255) return table[255]; return table[i] + (table[i + 1] - table[i]) * (t - i); }
    return function (r, g, b, o) { o[0] = m(r); o[1] = m(g); o[2] = m(b); };
  }

  var api = { run: run, hueSat: hueSat, tone: tone, blendIfFactor: blendIfFactor, BLEND: BLEND };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ThumbFX = api;
})(this);
