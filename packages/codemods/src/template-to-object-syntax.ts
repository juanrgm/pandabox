import MagicString from 'magic-string'
import postcss, { CssSyntaxError } from 'postcss'
import postcssJs from 'postcss-js'
import { Node, SourceFile, TaggedTemplateExpression, TemplateSpan } from 'ts-morph'

interface TemplateToObjectSyntaxOptions {
  sourceFile: SourceFile
  matchTag?: (tag: string) => boolean
  flags?: {
    withClassName?: boolean
  }
}

export const templateLiteralToObjectSyntax = (options: TemplateToObjectSyntaxOptions) => {
  const { sourceFile, matchTag } = options
  const withClassName = options.flags?.withClassName ?? true

  const sourceText = sourceFile.getText()
  const s = new MagicString(sourceText)

  sourceFile.forEachDescendant((node) => {
    if (!Node.isTaggedTemplateExpression(node)) return

    const tagName = node.getTag().getText()
    if (matchTag && !matchTag(tagName)) return

    const templateText = getTemplateText(node)

    try {
      const variableDecl = node.getParent()
      const obj = postcssJs.objectify(postcss.parse(templateText.slice(1, -1).trim()))
      const json = JSON.stringify(obj, null, 2)
      const [factory, tag] = tagName.split('.')

      let transform: string
      if (withClassName && Node.isVariableDeclaration(variableDecl)) {
        const identifier = variableDecl.getNameNode().getText()
        transform = `${factory}('${tag}', { base: ${json} }, { defaultProps: { className: '${identifier}' } })`
      } else {
        transform = `${factory}('${tag}', ${json})`
      }

      s.update(node.getStart(), node.getEnd(), transform)
    } catch (error) {
      if (error instanceof CssSyntaxError) {
        console.error(error.showSourceCode(true))
      }

      throw error
    }
  })

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  }
}

const getTemplateText = (node: TaggedTemplateExpression) => {
  const template = node.getTemplate()
  if (Node.isNoSubstitutionTemplateLiteral(template)) {
    return template.getText().slice(1, -1) // Remove the backticks
  }

  // Remove the first backtick
  let text = template.getHead().getText().slice(1)

  for (const span of template.getTemplateSpans()) {
    const transformed = transformTemplateSpan(span)

    // Remove the `${` from the `${identifier}`
    if (text.endsWith('${')) {
      text = text.slice(0, -2) + transformed
    } else {
      text += transformed
    }
  }

  // Remove the last backtick
  return text.slice(0, -1)
}

/**
 * Transform TemplateSpan Identifier to className reference
 * e.g. `${identifier}` -> `.identifier`
 */
function transformTemplateSpan(span: TemplateSpan) {
  const expr = span.getExpression()
  if (Node.isIdentifier(expr)) {
    const literal = span.getLiteral().getText()

    // Remove the `}` from the `${identifier}`
    return `.${expr.getText()}` + literal.slice(1)
  }

  throw new Error('Not implemented')
}
