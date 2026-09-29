/* A drop-in replacement for three.js r134 + vanta.cells 0.5.24, for this one
   effect only. 616 KB of general-purpose 3D engine were being loaded to draw a
   single full-screen fragment shader; everything three.js contributed here was
   a context, a quad and four uniforms.

   The shader below is Vanta's own source, unchanged. The uniform plumbing,
   the time stepping and the resize arithmetic are reproduced exactly as
   vanta.cells drives them — including two quirks that would otherwise change
   the picture:

     - `speed: 0` becomes 1, because Vanta writes `(this.options.speed || 1)`
       and 0 is falsy. The field animates at full speed despite the setting.
     - `iResolution` is the CSS size divided by `scale`, NOT the drawing
       buffer size. On a 2x display gl_FragCoord therefore runs to 2.0 across
       the viewport rather than 1.0, and the cell pattern is correspondingly
       finer. That is Vanta's behaviour, so it is reproduced.

   The public surface is the part of VANTA.CELLS the page actually uses:
   the call itself, `.req` and `.animationLoop()`. */
(function () {
  'use strict';

  var FRAG = [
    'uniform vec2 iResolution;',
    'uniform vec2 iMouse;',
    'uniform float iTime;',
    '',
    'uniform float blurFactor;',
    'uniform vec3 color1;',
    'uniform vec3 color2;',
    'uniform vec3 backgroundColor;',
    'uniform float size;',
    'uniform float amplitudeFactor;',
    'uniform float ringFactor;',
    'uniform float rotationFactor;',
    '',
    'float length2(vec2 p) { return dot(p, p); }',
    '',
    'float noise(vec2 p){',
    '    return fract(sin(fract(sin(p.x) * (43.13311)) + p.y) * 31.0011);',
    '}',
    '',
    'float worley(vec2 p) {',
    '    float d = 1e30;',
    '    for (int xo = -1; xo <= 1; ++xo) {',
    '        for (int yo = -1; yo <= 1; ++yo) {',
    '            vec2 tp = floor(p) + vec2(xo, yo);',
    '            d = min(d, length2(p - tp - vec2(noise(tp))));',
    '        }',
    '    }',
    '    vec2 uv = gl_FragCoord.xy / iResolution.xy;',
    '    float timeOffset =  0.15 * sin(iTime * 2.0 + 10.0*(uv.x - uv.y));',
    '    return 3.0*exp(-4.0*abs(2.0*d - 1.0 + timeOffset));',
    '}',
    '',
    'float fworley(vec2 p) {',
    '    return sqrt(sqrt(sqrt(',
    '    1.1 * // light',
    '    worley(p*5. + .3 + iTime*.0525) *',
    '    sqrt(worley(p * 50. / size + 0.3 + iTime * -0.15)) *',
    '    sqrt(sqrt(worley(p * -10. + 9.3))))));',
    '}',
    '',
    'void main() {',
    '    vec2 uv = gl_FragCoord.xy / iResolution.xy;',
    '    float t = fworley(uv * iResolution.xy / 1500.0);',
    '    t *= exp(-length2(abs(0.7*uv - 1.0)));',
    '',
    '    float tExp = pow(t, 0.5 - t);',
    '    vec3 c1 = color1 * (1.0 - t);',
    '    vec3 c2 = color2 * tExp;',
    '',
    '    gl_FragColor = vec4(pow(t, 1.0 - t) * (c1 + c2), 1.0);',
    '}',
    ''
  ].join('\n');

  /* three.js prepends `precision highp float;` to every ShaderMaterial at its
     default precision, so the same qualifier has to be here or the arithmetic
     can land differently on mobile GPUs. */
  var FRAG_SRC = 'precision highp float;\nprecision highp int;\n' + FRAG;

  /* Vanta's vertex shader, with the `position` attribute three.js used to
     supply from the prologue now declared explicitly. */
  var VERT_SRC = [
    'attribute vec3 position;',
    'void main() {',
    '  gl_Position = vec4( position, 1.0 );',
    '}'
  ].join('\n');

  /* PlaneGeometry(2, 2): four corners of clip space. */
  var QUAD = new Float32Array([
    -1,  1, 0,
     1,  1, 0,
    -1, -1, 0,
     1, -1, 0
  ]);

  var DEFAULTS = {
    color1: 35980,
    color2: 15918901,
    backgroundColor: 14155663,
    amplitudeFactor: 1,
    ringFactor: 1,
    rotationFactor: 1,
    size: 1.5,
    speed: 1,
    scaleMobile: 3,
    minWidth: 200,
    minHeight: 200
  };

  /* THREE.Color(hex).toVector() — straight sRGB bytes over 255. r134 applies
     no colour management to setHex, so neither does this. */
  function toVec3(hex) {
    return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[cells] shader: ' + gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function CELLS(userOptions) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in userOptions) o[k] = userOptions[k];

    var el = o.el;
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return null;

    var canvas = document.createElement('canvas');
    canvas.className = 'vanta-canvas';
    /* WebGLRenderer sets this on a canvas it creates itself; absolute
       positioning blockifies it anyway, but match it rather than rely on that. */
    canvas.style.display = 'block';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '0';

    var attrs = { alpha: true, antialias: true, premultipliedAlpha: true };
    var gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return null;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[cells] link: ' + gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);

    var u = {};
    ['iResolution', 'iTime', 'iMouse', 'color1', 'color2', 'backgroundColor',
     'size', 'blurFactor', 'amplitudeFactor', 'ringFactor', 'rotationFactor']
      .forEach(function (n) { u[n] = gl.getUniformLocation(prog, n); });

    /* The unused ones are set anyway, to the values Vanta would have set, so
       that nothing depends on a compiler happening to strip them. */
    function setFloat(n, v) { if (u[n]) gl.uniform1f(u[n], v); }
    function setColor(n, hex) { if (u[n]) { var c = toVec3(hex); gl.uniform3f(u[n], c[0], c[1], c[2]); } }

    setColor('color1', o.color1);
    setColor('color2', o.color2);
    setColor('backgroundColor', o.backgroundColor);
    setFloat('size', o.size);
    setFloat('amplitudeFactor', o.amplitudeFactor);
    setFloat('ringFactor', o.ringFactor);
    setFloat('rotationFactor', o.rotationFactor);
    if (u.iMouse) gl.uniform2f(u.iMouse, 0, 0);
    /* Not 0: Vanta declares `iTime: {type:"f", value:1}`, and the first frame
       draws before any time step has run. Starting at 0 would make frame one
       a different picture. */
    setFloat('iTime', 1);

    el.appendChild(canvas);

    var self = {
      req: 0,
      t: 0,
      t2: 0,
      prevNow: 0,
      scale: 1,
      width: 0,
      height: 0,
      options: o
    };

    /* VantaBase.setSize(): the mobile branch wins over `scale`, which is why a
       narrow window renders the field at a third of the resolution. */
    function setSize() {
      var mobile = typeof navigator !== 'undefined' &&
        (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         window.innerWidth < 600);
      if (mobile && o.scaleMobile) self.scale = o.scaleMobile;
      else if (o.scale) self.scale = o.scale;
      self.width = Math.max(el.offsetWidth, o.minWidth);
      self.height = Math.max(el.offsetHeight, o.minHeight);
    }

    /* WebGLRenderer.setSize(w, h) + setPixelRatio(dpr / scale). */
    function resize() {
      setSize();
      var pr = (window.devicePixelRatio || 1) / self.scale;
      canvas.width = Math.floor(self.width * pr);
      canvas.height = Math.floor(self.height * pr);
      canvas.style.width = self.width + 'px';
      canvas.style.height = self.height + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (u.iResolution) {
        gl.uniform2f(u.iResolution, self.width / self.scale, self.height / self.scale);
      }
    }

    /* VantaBase.isOnScreen(). For a fixed, full-viewport host this is always
       true, but it is kept so the loop behaves the same in any placement. */
    function isOnScreen() {
      var h = el.offsetHeight;
      var r = el.getBoundingClientRect();
      var scrollTop = window.pageYOffset ||
        (document.documentElement || document.body.parentNode || document.body).scrollTop;
      var top = r.top + scrollTop;
      return top - window.innerHeight <= scrollTop && scrollTop <= top + h;
    }

    /* VantaBase.animationLoop(), step for step. Time keeps advancing while the
       element is off screen; only the draw is skipped. */
    function animationLoop() {
      var now = performance.now();
      if (self.prevNow) {
        var dt = (now - self.prevNow) / (1000 / 60);
        dt = Math.max(0.2, Math.min(dt, 5));
        self.t += dt;
        self.t2 += (o.speed || 1) * dt;
        if (u.iTime) gl.uniform1f(u.iTime, 0.016667 * self.t2);
      }
      self.prevNow = now;

      if (isOnScreen() || o.forceAnimate) {
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      self.req = window.requestAnimationFrame(animationLoop);
      return self.req;
    }

    self.animationLoop = animationLoop;
    self.resize = resize;
    self.destroy = function () {
      if (self.req) window.cancelAnimationFrame(self.req);
      window.removeEventListener('resize', resize);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };

    window.addEventListener('resize', resize);
    resize();
    animationLoop();
    return self;
  }

  window.VANTA = window.VANTA || {};
  window.VANTA.CELLS = CELLS;
})();
