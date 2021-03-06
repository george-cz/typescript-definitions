'use strict'

const _ = require('lodash')
const debug = require('debug')('utils')
require('colors')

const extendArray = (arr1, arr2) => Array.prototype.push.apply(arr1, arr2) && arr1

const wrapComment = (comment) => {
  if (!comment) return []
  comment = comment.replace(/^\(optional\)(?: - )?/gi, '').trim()
  if (!comment) return []
  const result = ['/**']
  while (comment.trim().length > 0) {
    let index = 0
    for (let i = 0; i <= 80; i++) {
      if (comment[i] === ' ') index = i
    }
    if (comment.length <= 80) {
      index = 80
    }
    result.push(` * ${comment.substring(0, index)}`)
    comment = comment.substring(index + 1)
  }
  return result.concat(' */')
}

const prefixTypeForSafety = (type) => {
  if (type !== 'Object' && typeof type === 'string' && !isPrimitive(type) && !isBuiltIn(type)) {
    return `Electron.${type}`
  }
  return type
}

const typify = (type) => {
  // Capture some weird edge cases
  const originalType = type
  if (type.type && typeof type.type === 'object') {
    type = type.type
  }

  if (Array.isArray(type)) {
    const arrayType = Array.from(new Set(type.map(t => `(${typify(t)})`))).join(' | ')
    if (originalType.collection) {
      return `Array<${arrayType}>`
    }
    return arrayType
  }

  if (!type) return 'any'

  let innerType

  if (typeof type === 'object') {
    let newType = type.typeName || type.type || 'any'

    if (newType.toLowerCase() === 'string' && type.possibleValues && type.collection) {
      // Array<foo | bar> syntax instead of (foo | bar)[]
      newType = `Array<${type.possibleValues.map(value => `'${value.value}'`).join(' | ')}>`
    } else {
      if (newType.toLowerCase() === 'string' && type.possibleValues) {
        newType = `(${type.possibleValues.map(value => `'${value.value}'`).join(' | ')})`
      }
      if (type.collection) newType += '[]'
    }

    if (type.innerType) {
      innerType = type.innerType
    }

    type = newType
  }

  switch (type.toLowerCase()) {
    case 'double':
    case 'integer':
    case 'float':
      return 'number'
    case 'double[]':
    case 'integer[]':
    case 'float[]':
      return 'number[]'
    case 'array': {
      if (innerType) return `Array<${typify(innerType[0])}>`
      debug('Untyped "Array" as return type'.yellow)
      return 'any[]'
    }
    case 'true':
    case 'false':
      debug('"true" or "false" provided as return value, inferring "Boolean" type'.info)
      return 'boolean'
    case '[objects]':
      debug('[Objects] is not a valid array definition, please conform to the styleguide'.red)
      return 'any[]'
    case 'object':
      debug('Unstructured "Object" type specified'.yellow)
      return 'any'
    case 'any':
      return 'any'
    case 'string':
    case 'boolean':
    case 'number':
    case 'string[]':
    case 'boolean[]':
    case 'number[]':
      return type.toLowerCase()
    case 'buffer':
      return 'Buffer'
    case 'buffer[]':
      return 'Buffer[]'
    case 'voidfunction':
      return '(() => void)'
    case 'promise':
      if (innerType) {
        return `Promise<${prefixTypeForSafety(typify(innerType[0]))}>`
      }
      debug('Promise with missing inner type, defaulting to any')
      return 'Promise<any>'
    case 'record':
      if (innerType && innerType.length === 2) {
        return `Record<${typify(innerType[0])}, ${typify(innerType[1])}>`
      }
      debug('Record with missing inner types, default to any')
      return 'Record<any, any>'
    case 'url':
      return 'string'
    case 'touchbaritem':
      return '(TouchBarButton | TouchBarColorPicker | TouchBarGroup | TouchBarLabel | TouchBarPopover | TouchBarScrubber | TouchBarSegmentedControl | TouchBarSlider | TouchBarSpacer | null)'
    case 'readablestream':
      // See StreamProtocolResponse.data which accepts a Node.js readable stream.
      // The ReadableStream type unfortunately conflicts with the ReadableStream interface
      // defined in the Streams standard (https://streams.spec.whatwg.org/#rs-class) so
      // we'll have to qualify it with the Node.js namespace.
      return 'NodeJS.ReadableStream'
  }
  // if (type.substr(0, 8) === 'TouchBar' && type !== 'TouchBar') {
  //   return `Electron.${type}`
  // }
  return type
}
const paramify = (paramName) => {
  switch (paramName.toLowerCase()) {
    case 'switch':
      return 'the_switch'
  }
  return paramName
}
// TODO: Infer through electron-docs-linter/parser
const isEmitter = (module) => {
  switch (module.name.toLowerCase()) {
    case 'menu':
    case 'menuitem':
    case 'nativeimage':
    case 'shell':
    case 'crashreporter':
      return false
    default:
      return true
  }
}
const isPrimitive = (type) => {
  const primitives = [
    'boolean',
    'number',
    'any',
    'string',
    'void'
  ]
  return primitives.indexOf(type.toLowerCase().replace(/\[\]/g, '')) !== -1
}
const isBuiltIn = (type) => {
  const builtIns = [
    'promise',
    'buffer'
  ]
  return builtIns.indexOf(type.toLowerCase().replace(/\[\]/g, '')) !== -1
}
const isOptional = (param) => {
  // Did we pass a "required"?
  if (typeof param.required !== 'undefined') {
    return !param.required
  }

  // Assume that methods are never optional because electron-docs-linter
  // doesn't currently mark them as required.
  debug(`Could not determine optionality for ${param.name}`)
  return param.type !== 'Function'
}

const genMethodString = (paramInterfaces, module, moduleMethod, parameters, returns, includeType, paramTypePrefix) => {
  paramTypePrefix = paramTypePrefix || ''
  if (typeof includeType === 'undefined') {
    includeType = true
  }

  return `${includeType ? '(' : ''}${(parameters || []).map((param) => {
    let paramType = param

    if (param.type === 'Object' && param.properties && param.properties.length) {
      // Check if we have the same structure for a different name
      if (param.name === 'options') {
        if (['show', 'hide', 'open', 'close', 'start', 'stop'].includes((moduleMethod._name || moduleMethod.name).toLowerCase())) {
          paramType = paramInterfaces.createParamInterface(param, _.upperFirst(module.name) + _.upperFirst(moduleMethod._name || moduleMethod.name))
        } else {
          paramType = paramInterfaces.createParamInterface(param, _.upperFirst(moduleMethod._name || moduleMethod.name))
        }
      } else {
        paramType = paramInterfaces.createParamInterface(param, _.upperFirst(moduleMethod._name) || '', _.upperFirst(moduleMethod.name))
      }
    }

    if (Array.isArray(param.type)) {
      param.type = param.type.map((paramType) => {
        if (paramType.typeName === 'Function' && param.parameters) {
          return Object.assign({}, paramType, { typeName: genMethodString(paramInterfaces, module, moduleMethod, param.parameters, param.returns || (paramType.innerType && paramType.innerType[0])) })
        }
        return paramType
      })
    }
    if (param.type === 'Function' && param.parameters) {
      paramType = genMethodString(paramInterfaces, module, moduleMethod, param.parameters, param.returns || param.innerType)
    }

    const name = paramify(param.name)
    const optional = isOptional(param, false) ? '?' : ''

    // Figure out this parameter's type
    let type
    if (param.possibleValues && param.possibleValues.length) {
      type = param.possibleValues.map(v => `'${v.value}'`).join(' | ')
    } else {
      type = `${typify(paramType)}${paramify(param.name).startsWith('...') && !typify(paramType).endsWith('[]') ? '[]' : ''}`
    }

    if (param.type !== 'Function' && type.substr(0, 1).toLowerCase() !== type.substr(0, 1)) {
      type = paramTypePrefix + type
    }

    return `${name}${optional}: ${type}`
  }).join(', ')}${includeType ? `) => ${returns ? typify(returns) : 'void'}` : ''}`
}

module.exports = { extendArray, isEmitter, isOptional, paramify, typify, wrapComment, genMethodString, isPrimitive, isBuiltIn }
