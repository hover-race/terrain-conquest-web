export const ROOT_PATH = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')

export function assetPath(path) {
  return `${ROOT_PATH}/${String(path).replace(/^\//, '')}`
}

export function snapYToTerrainInPlace(mainScene, position) {
  if (mainScene.terrain2 && mainScene.terrain2.getHeightAtPosition) {
    const terrainHeight = mainScene.terrain2.getHeightAtPosition(position.x, position.z)
    position.y = terrainHeight + 0.5
    return position
  }
  console.error('terrain2 not found')
}

export function findNodesByPrefix(root, prefix) {
  const foundNodes = []
  root.traverse(node => {
    if (node.name && node.name.startsWith(prefix)) {
      foundNodes.push(node)
    }
  })
  return foundNodes
}

export function findSingleNode(root, name) {
  const foundNodes = []
  root.traverse(node => {
    if (node.name === name) {
      foundNodes.push(node)
    }
  })
  if (foundNodes.length !== 1) {
    console.error(`Expected exactly one node with name "${name}", but found ${foundNodes.length}`)
    console.log('Scene hierarchy:')
    root.traverse(node => {
      const indent = '  '.repeat(node.name.split('/').length - 1)
      console.log(`${indent}${node.name || '(unnamed)'} [${node.type}]`)
    })
    throw new Error(`Expected exactly one node with name "${name}", but found ${foundNodes.length}`)
  }
  return foundNodes[0]
}
