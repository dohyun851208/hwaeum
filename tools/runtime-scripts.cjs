// The HTML is the source of truth for classic-script order. Node verification only;
// browsers continue to load ordinary <script> tags without a build step.
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function scriptPaths(page = "studio.html") {
  const html = fs.readFileSync(path.join(projectDir, page), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  return Array.from(html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi), (match) => {
    const src = match[1].split(/[?#]/)[0].replace(/^\.\//, "")
    if (!/^js\/[\w-]+\.js$/.test(src)) throw new Error("Unsupported runtime script in " + page + ": " + src)
    return src
  })
}

function scriptFiles(options = {}) {
  const files = scriptPaths(options.page).map((file) => path.basename(file))
  const from = options.from == null ? 0 : files.indexOf(options.from)
  const through = options.through == null ? files.length - 1 : files.indexOf(options.through)
  if (from < 0 || through < from) throw new Error("Runtime script range is missing or reversed")
  return files.slice(from, through + 1)
}

function loadScripts(sandbox, options) {
  const context = vm.isContext(sandbox) ? sandbox : vm.createContext(sandbox)
  for (const file of scriptFiles(options)) {
    vm.runInContext(fs.readFileSync(path.join(projectDir, "js", file), "utf8"), context, { filename: file })
  }
  return sandbox
}

module.exports = { scriptPaths, scriptFiles, loadScripts }
