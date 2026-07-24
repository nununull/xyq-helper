/**
 * 对 ImageData 做轻量采样 hash，用于跳过重复画面。
 */
export function createFrameHash(image: ImageData, sampleStep = 32): string {
  let hash = 0

  for (let index = 0; index < image.data.length; index += 4 * sampleStep) {
    hash = (hash * 31 + image.data[index] + image.data[index + 1] + image.data[index + 2]) >>> 0
  }

  return hash.toString(16)
}
