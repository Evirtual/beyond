import { readFile, writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'

// Phone artwork follows the in-app black hole. The browser favicon is independent.
const source = await readFile(new URL('./phone-logo.svg', import.meta.url), 'utf8')
const artwork = source.replace(/<svg[^>]*>/, '').replace('</svg>', '')
// Desktop title bars need the stronger, unpadded mark rather than a shrunken phone tile.
const compact = await readFile(new URL('../public/favicon-black-hole.svg', import.meta.url), 'utf8')
for (const size of [16, 32, 48, 64, 128]) {
  await writeFile(new URL(`../public/app-${size}.png`, import.meta.url),
    new Resvg(compact, { fitTo: { mode: 'width', value: size } }).render().asPng())
}
// Fixed positions keep regenerated icons identical. Stars stay quiet behind the mark.
const stars = [
  [10, 12, .12], [23, 7, .09], [40, 10, .14], [52, 16, .11],
  [7, 27, .08], [56, 31, .12], [12, 43, .14], [49, 46, .10],
  [20, 54, .11], [37, 57, .08], [56, 53, .13], [32, 16, .07],
].map(([x, y, opacity]) => `<circle cx="${x}" cy="${y}" r=".7" fill="#a8aed3" opacity="${opacity * .2}"/><circle cx="${x}" cy="${y}" r=".18" fill="#c7cbea" opacity="${opacity}"/>`).join('')
const background = `<defs><radialGradient id="space" cx="48%" cy="42%" r="70%"><stop stop-color="#030208"/><stop offset=".65" stop-color="#010103"/><stop offset="1" stop-color="#000000"/></radialGradient></defs><rect width="64" height="64" fill="url(#space)"/>${stars}`
for (const [filename, size, inset] of [
  ['pwa-192.png', 192, 4],
  ['pwa-512.png', 512, 4],
  ['pwa-maskable-512.png', 512, 7],
  ['apple-touch-icon.png', 180, 4],
]) {
  const scale = (64 - inset * 2) / 64
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${background}<g transform="translate(${inset} ${inset}) scale(${scale})">${artwork}</g></svg>`
  await writeFile(new URL(`../public/${filename}`, import.meta.url), new Resvg(svg).render().asPng())
}
