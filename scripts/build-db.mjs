import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve('public/data/questions.sqlite')

console.log(`题库构建脚本占位：后续将 JSON 题库构建为 ${output}`)
writeFileSync(resolve('public/data/version.json'), JSON.stringify({
  version: 'demo-local',
  questionCount: 2,
  hash: 'demo',
}, null, 2))
