import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMjpegParser } from '../src/utils/mjpeg.js'

test('네트워크 조각 경계와 무관하게 MJPEG 프레임을 분리한다', () => {
  const frames = []
  const parser = createMjpegParser(frame => frames.push([...frame]))
  const bytes = new TextEncoder().encode('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 3\r\n\r\nabc\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 2\r\n\r\nde\r\n--frame--\r\n')
  for (const byte of bytes) parser.push(Uint8Array.of(byte))
  assert.deepEqual(frames, [[97, 98, 99], [100, 101]])
})

test('크기가 없는 프레임은 거부한다', () => {
  const parser = createMjpegParser(() => {})
  assert.throws(() => parser.push(new TextEncoder().encode('--frame\r\nContent-Type: image/jpeg\r\n\r\nabc')), /Content-Length/)
})
