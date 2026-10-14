import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Extract the actual app shader, so icon geometry, lensing, beaming and streaks
// follow Glass.tsx instead of maintaining a second hand-drawn approximation.
const source = await readFile(new URL('../src/scene/Glass.tsx', import.meta.url), 'utf8')
const between = (start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a)
  if (a < 0 || b < 0) throw new Error(`Shader extraction failed: ${start}`)
  return source.slice(a, b)
}
const noise = between('float hash(vec2 p)', '// rotate a colour')
let hole = between('float show = smoothstep', '\n          }\n          if (uHole > 0.001 && uEdge')
// The icon's opening is black; no next-world texture is needed.
hole = hole.replace(/if \(uPortal > 0\.5\) \{[\s\S]*?\n            \}/, '')
const shader = `precision highp float;
varying vec2 vUv;
const float uTime = 38.0;
const float uHole = 0.5;
const float uEdge = 0.0;
const vec3 uRing = vec3(0.82, 0.78, 1.0);
${noise}
void main() {
  vec2 hc = vUv - vec2(0.5);
  float hr = length(hc);
  float rs = 0.135;
  vec3 col = vec3(0.0);
  ${hole}
  gl_FragColor = vec4(max(col * 1.5, 0.0), 1.0);
}`
const browser = await chromium.launch({
  headless: true,
  ...(process.env.ICON_BROWSER_CHANNEL ? { channel: process.env.ICON_BROWSER_CHANNEL } : {}),
})
try {
  const page = await browser.newPage()
  for (const compact of [false, true]) {
  const iconShader = compact ? shader.replace('float rs = 0.135;', 'float rs = 0.18;').replace('gl_FragColor = vec4(max(col * 1.5, 0.0), 1.0);', 'vec3 c = clamp(col * 1.5, 0.0, 1.0); float a = hr < rs ? 1.0 : max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c / max(a, 0.001), a);') : shader
  const outputs = await page.evaluate(({ shader, compact }) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1536
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: compact, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL is required to render icons')
    const compile = (type, code) => {
      const s = gl.createShader(type)
      gl.shaderSource(s, code); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
      return s
    }
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 vUv; void main(){vUv=position*.5+.5;gl_Position=vec4(position,0.,1.);}'))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, shader))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.viewport(0,0,1536,1536); gl.drawArrays(gl.TRIANGLES,0,6)
    const result = {}
    const sizes = compact ? [16,32,48,64,128].map(size => ['app-'+size+'.png',size]) : [['pwa-192.png',192],['pwa-512.png',512],['pwa-maskable-512.png',512],['apple-touch-icon.png',180]]
    for (const [name,size] of sizes) {
      const out = document.createElement('canvas'); out.width=out.height=size
      const ctx=out.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(canvas,0,0,size,size)
      // Sparse, very faint stars outside the central artwork.
      if (!compact) for (const [x,y] of [[.12,.18],[.27,.09],[.72,.14],[.88,.3],[.15,.76],[.36,.9],[.8,.83]]) {
        ctx.fillStyle='rgba(190,190,220,0.12)';ctx.beginPath();ctx.arc(x*size,y*size,size*.0018,0,Math.PI*2);ctx.fill()
      }
      result[name]=out.toDataURL('image/png').split(',')[1]
    }
    return result
  }, { shader: iconShader, compact })
  for (const [filename, data] of Object.entries(outputs)) {
    await writeFile(new URL(`../public/${filename}`, import.meta.url), Buffer.from(data, 'base64'))
  }
  }
} finally { await browser.close() }
