'use strict'

const { z } = require('zod')
const clinicPackage = require('../package.json')
const PROFILER_PACKAGES = Object.keys(clinicPackage.dependencies).filter(name => name.startsWith('@clinic/'))
const { TOOLS } = require('./profile-mcp-sdk')

function loadPluginMcpTools () {
  const names = new Set(TOOLS)
  const tools = []
  for (const packageName of PROFILER_PACKAGES) {
    const plugin = require(packageName)
    if (typeof plugin.getMcpTools !== 'function') continue
    const contributions = plugin.getMcpTools({ z })
    if (!Array.isArray(contributions)) throw new TypeError(`${packageName}.getMcpTools must return an array`)
    for (const tool of contributions) {
      if (!tool || typeof tool.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) throw new TypeError(`${packageName} contributed an invalid MCP tool name`)
      if (names.has(tool.name)) throw new Error(`duplicate MCP tool name: ${tool.name}`)
      if (!tool.config || typeof tool.config !== 'object' || typeof tool.handler !== 'function') {
        throw new TypeError(`${packageName} contributed an incomplete MCP tool: ${tool.name}`)
      }
      names.add(tool.name)
      tools.push({ ...tool, packageName })
    }
  }
  return tools
}

module.exports = { loadPluginMcpTools }
