const encoder = new TextEncoder()
const boundary = encoder.encode('--frame\r\n')
const finalBoundary = encoder.encode('--frame--\r\n')
const headerEnd = encoder.encode('\r\n\r\n')
const decoder = new TextDecoder()

function startsWith(buffer, sequence) {
  return sequence.every((byte, index) => buffer[index] === byte)
}

function find(buffer, sequence) {
  for (let index = 0; index <= buffer.length - sequence.length; index++) {
    if (sequence.every((byte, offset) => buffer[index + offset] === byte)) return index
  }
  return -1
}

export function createMjpegParser(onFrame) {
  let buffer = new Uint8Array(0)
  let frameLength = null
  let finished = false

  return {
    push(chunk) {
      if (finished) return
      const next = new Uint8Array(buffer.length + chunk.length)
      next.set(buffer)
      next.set(chunk, buffer.length)
      buffer = next
      while (buffer.length) {
        if (frameLength !== null) {
          if (buffer.length < frameLength) break
          onFrame(buffer.slice(0, frameLength))
          buffer = buffer.slice(frameLength)
          frameLength = null
          continue
        }
        if (buffer.length >= 2 && buffer[0] === 13 && buffer[1] === 10) {
          buffer = buffer.slice(2)
          continue
        }
        if (buffer.length < boundary.length) break
        if (buffer.length < finalBoundary.length && buffer.every((byte, index) => byte === finalBoundary[index])) break
        if (startsWith(buffer, finalBoundary)) { finished = true; buffer = new Uint8Array(0); break }
        if (!startsWith(buffer, boundary)) throw new Error('MJPEG 영상 경계가 올바르지 않습니다.')
        const end = find(buffer, headerEnd)
        if (end < 0) {
          if (buffer.length > 8192) throw new Error('MJPEG 영상 헤더가 너무 깁니다.')
          break
        }
        const headers = decoder.decode(buffer.slice(boundary.length, end))
        const match = /^Content-Length:\s*(\d+)\s*$/im.exec(headers)
        frameLength = match ? Number(match[1]) : NaN
        if (!Number.isSafeInteger(frameLength) || frameLength < 1 || frameLength > 16 * 1024 * 1024) {
          throw new Error('MJPEG Content-Length가 올바르지 않습니다.')
        }
        buffer = buffer.slice(end + headerEnd.length)
      }
    },
  }
}
