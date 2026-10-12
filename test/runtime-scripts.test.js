const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const { scriptPaths, scriptFiles } = require("../tools/runtime-scripts.cjs")
const projectDir = path.resolve(__dirname, "..")

for (const page of ["studio.html", "channel.html"]) {
  test(page + " loads existing classic scripts exactly once with valid syntax", () => {
    const scripts = scriptPaths(page)
    assert.ok(scripts.length)
    assert.equal(new Set(scripts).size, scripts.length)
    for (const file of scripts) new vm.Script(fs.readFileSync(path.join(projectDir, file), "utf8"), { filename: file })
  })
}

test("runtime modules precede their consumers on both pages", () => {
  const pairs = [
    ["audio-plan.js", "audio-engine.js"], ["audio-samples.js", "audio-engine.js"],
    ["audio-node-scope.js", "audio-engine.js"], ["audio-pad-graph.js", "audio-engine.js"],
    ["drawing-renderer.js", "drawing.js"], ["share-local-store.js", "share-store.js"],
    ["studio-utils.js", "studio.js"], ["studio-recipe.js", "studio.js"], ["studio-reflection.js", "studio.js"],
    ["share-store.js", "channel.js"],
  ]
  for (const page of ["studio.html", "channel.html"]) {
    const scripts = scriptFiles({ page })
    for (const [dependency, consumer] of pairs) {
      if (!scripts.includes(consumer)) continue
      assert.ok(scripts.includes(dependency), dependency + " required by " + page)
      assert.ok(scripts.indexOf(dependency) < scripts.indexOf(consumer), dependency + " before " + consumer)
    }
  }
})

test("verification rejects missing or reversed script boundaries", () => {
  assert.throws(() => scriptFiles({ from: "missing.js" }), /missing/)
  assert.throws(() => scriptFiles({ from: "studio.js", through: "audio-engine.js" }), /reversed/)
})
