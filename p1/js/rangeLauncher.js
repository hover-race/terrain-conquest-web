import { assetPath } from './util.js'

const link = document.createElement('a')
link.href = assetPath('/p1/range.html')
link.textContent = 'G · Firing range'
Object.assign(link.style, {
  position: 'fixed', right: '16px', bottom: '16px', zIndex: '1000',
  padding: '9px 13px', background: '#172421e8', border: '1px solid #ad9565',
  color: '#edce98', font: '12px monospace', textDecoration: 'none', borderRadius: '3px',
})
document.body.appendChild(link)
document.addEventListener('keydown', event => {
  if (event.code !== 'KeyG' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
  event.preventDefault()
  location.assign(link.href)
})
